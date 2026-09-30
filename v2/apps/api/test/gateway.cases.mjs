import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'
import { generateImage, StudioError } from '../src/images.mjs'
import { runAgent } from '../src/agent.mjs'

// Explicit local fixtures only. This suite never calls a real provider.
const chat = { id: 'chat', displayName: 'Fixture chat', kind: 'chat', upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified', vision: false }
const image = { id: 'image', displayName: 'Fixture image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', qualities: ['xhigh'], sizes: { '1:1': '1024x1024' }, operations: ['generate', 'edit'], responseFormat: 'b64_json' }
const config = () => ({ models: [chat, image], relayKey: 'fixture-relay-secret', allowGeneration: true, gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:' })
const headers = { authorization: 'Bearer fixture-user-7', 'idempotency-key': 'fixture-key-1234' }
const authFetch = async (_url, init) => new Response(JSON.stringify({ success: true, data: { id: init.headers.Authorization.endsWith('-8') ? 8 : 7 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const pixels = () => sharp({ create: { width: 32, height: 24, channels: 3, background: '#90aa70' } }).png().toBuffer()

test('catalog exposes only public capability data; anonymous/spoofed identity cannot generate', async () => {
  let calls = 0
  const app = createServer(config(), { fetch: authFetch, generateImage: async () => { calls++; return {} } })
  try {
    const catalog = await app.inject('/api/studio/models')
    assert.equal(catalog.statusCode, 200)
    assert.doesNotMatch(catalog.body, /fixture-relay-secret|fixture\.invalid|upstreamModelId/)
    const anonymous = await app.inject({ method: 'POST', url: '/api/studio/images', headers: { 'New-Api-User': '7' }, payload: { prompt: 'test' } })
    assert.equal(anonymous.statusCode, 401); assert.equal(calls, 0)
  } finally { await app.close() }
})

test('unverified/disabled configuration remains unavailable even with a relay key', async () => {
  const c = config(); c.models = c.models.map(m => ({ ...m, verification: 'contract-tested' }))
  let calls = 0
  const app = createServer(c, { fetch: authFetch, generateImage: async () => { calls++ } })
  try {
    assert.equal((await app.inject('/api/studio/models')).json().data.models.every(m => !m.accessible), true)
    const response = await app.inject({ method: 'POST', url: '/api/studio/images', headers, payload: { prompt: 'test', model: 'image' } })
    assert.equal(response.statusCode, 503); assert.equal(calls, 0)
  } finally { await app.close() }
})

test('idempotent image replay is owner scoped and changed parameters conflict', async () => {
  let calls = 0
  const app = createServer(config(), { fetch: authFetch, generateImage: async () => { calls++; return { url: 'fixture-only', width: 32, height: 24 } } })
  const make = (h = headers, prompt = 'test') => app.inject({ method: 'POST', url: '/api/studio/images', headers: h, payload: { prompt, model: 'image' } })
  try {
    const first = await make(); assert.equal(first.statusCode, 200)
    assert.deepEqual((await make()).json(), first.json()); assert.equal(calls, 1)
    assert.equal((await make(headers, 'changed')).statusCode, 409); assert.equal(calls, 1)
    assert.equal((await make({ ...headers, authorization: 'Bearer fixture-user-8' })).statusCode, 200); assert.equal(calls, 2)
  } finally { await app.close() }
})

test('ambiguous gateway failure stays blocked across a service restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-ledger-')); const c = { ...config(), ledgerPath: join(directory, 'requests.sqlite') }
  let calls = 0
  const overrides = { fetch: authFetch, generateImage: async () => { calls++; throw new StudioError('结果待确认', 502) } }
  const send = app => app.inject({ method: 'POST', url: '/api/studio/images', headers, payload: { prompt: 'test', model: 'image' } })
  let app = createServer(c, overrides)
  try {
    assert.equal((await send(app)).statusCode, 502); await app.close()
    app = createServer(c, overrides)
    assert.equal((await send(app)).statusCode, 409); assert.equal(calls, 1)
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('image JSON and multipart preserve model/quality; invalid inputs never reach the gateway', async () => {
  const png = await pixels(); let sent
  const fixture = async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 }) }
  const result = await generateImage(config(), image, { prompt: 'test', quality: 'xhigh', aspectRatio: '1:1' }, fixture)
  assert.equal(result.width, 32); assert.equal(result.height, 24)
  assert.deepEqual(JSON.parse(sent.init.body), { model: 'fixture-image', prompt: 'test', n: 1, quality: 'xhigh', size: '1024x1024', response_format: 'b64_json' })
  assert.equal(sent.init.headers.Authorization, 'Bearer fixture-relay-secret')
  await generateImage(config(), image, { prompt: 'edit', quality: 'xhigh', inputImages: ['data:image/png;base64,' + png.toString('base64')] }, fixture)
  assert.match(sent.url, /images\/edits$/); assert.equal(sent.init.body.get('model'), 'fixture-image'); assert.equal(sent.init.body.get('quality'), 'xhigh'); assert.equal(sent.init.body.getAll('image[]').length, 1)
  let invalidCalls = 0; const never = async () => { invalidCalls++; throw new Error('must not call') }
  await assert.rejects(generateImage(config(), image, { prompt: 'test', quality: 'unsupported' }, never))
  await assert.rejects(generateImage(config(), image, { prompt: 'test', inputImages: ['http://169.254.169.254/'] }, never))
  await assert.rejects(generateImage(config(), image, { prompt: 'test', inputImages: ['data:image/png;base64,YmFk'] }, never))
  assert.equal(invalidCalls, 0)
})

test('URL-only results and gateway errors cannot be reported as a successful image', async () => {
  await assert.rejects(generateImage(config(), image, { prompt: 'test' }, async () => new Response(JSON.stringify({ data: [{ url: 'http://private.invalid/' }] }))), /未返回支持的内嵌图片/)
  let attempts = 0
  await assert.rejects(generateImage(config(), image, { prompt: 'test' }, async () => { attempts++; return new Response('fixture-relay-secret', { status: 429 }) }), /HTTP 429/)
  assert.equal(attempts, 1)
})

test('LangGraph agent invokes the image tool through a local OpenAI-protocol fixture', async () => {
  const upstream = Fastify(); const png = await pixels(); let chats = 0; let images = 0
  upstream.post('/v1/chat/completions', async req => {
    assert.equal(req.headers.authorization, 'Bearer fixture-relay-secret')
    chats++
    return { id: 'fixture-completion-' + chats, object: 'chat.completion', created: 1, model: 'fixture-chat', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, choices: [{ index: 0, finish_reason: chats === 1 ? 'tool_calls' : 'stop', message: chats === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'fixture-tool', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'local fixture product' }) } }] } : { role: 'assistant', content: '本地协议测试已完成。' } }] }
  })
  upstream.post('/v1/images/generations', async () => { images++; return { data: [{ b64_json: png.toString('base64') }] } })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  try {
    const c = { ...config(), gateway: upstream.listeningOrigin + '/v1' }
    const result = await runAgent(c, chat, { runId: crypto.randomUUID(), sessionId: 'fixture-session', conversationId: 'fixture-canvas', prompt: '生成一张测试图' })
    assert.equal(chats, 2); assert.equal(images, 1)
    assert.equal(result.events.some(e => e.type === 'tool.completed' && e.artifacts[0].type === 'image'), true)
    assert.equal(result.events.at(-1).type, 'run.completed')
    assert.equal(result.events.some(e => e.delta === '本地协议测试已完成。'), true)
  } finally { await upstream.close() }
})
