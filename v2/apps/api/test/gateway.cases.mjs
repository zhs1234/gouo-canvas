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
import { loadConfig } from '../src/config.mjs'

// Explicit local fixtures only. This suite never calls a real provider.
const chat = { id: 'chat', displayName: 'Fixture chat', kind: 'chat', upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified', vision: false, toolCalling: true }
const image = { id: 'image', displayName: 'Fixture image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', qualities: ['xhigh'], sizes: { '1:1': '1024x1024' }, operations: ['generate', 'edit'], responseFormat: 'b64_json' }
const config = () => ({ models: [chat, image], relayKey: 'fixture-relay-secret', relayOwnerId: 7, allowGeneration: true, gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:' })
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

test('a development relay token cannot be spent by another authenticated account', async () => {
  let calls = 0
  const app = createServer({ ...config(), relayOwnerId: 7 }, { fetch: authFetch, generateImage: async () => { calls++; return {} } })
  try {
    const other = await app.inject({ method: 'POST', url: '/api/studio/images', headers: { ...headers, authorization: 'Bearer fixture-user-8', 'new-api-user': '7' }, payload: { prompt: 'test', model: 'image' } })
    assert.equal(other.statusCode, 403); assert.equal(calls, 0)
    const owner = await app.inject({ method: 'POST', url: '/api/studio/images', headers, payload: { prompt: 'test', model: 'image' } })
    assert.equal(owner.statusCode, 200); assert.equal(calls, 1)
    assert.throws(() => loadConfig({ GOUO_RELAY_OWNER_ID: '0' }), /所属账号/)
    assert.throws(() => loadConfig({ GOUO_RELAY_OWNER_ID: '1.5' }), /所属账号/)
  } finally { await app.close() }
})

test('image-only conversations use the selected real image protocol once, including canvas references', async () => {
  const upstream = Fastify(); const png = await pixels(); let images = 0; let edits = 0
  upstream.post('/v1/images/generations', async req => {
    assert.equal(req.headers.authorization, 'Bearer fixture-relay-secret')
    assert.equal(req.body.model, 'fixture-image-2')
    assert.equal(req.body.prompt, '原样发送的生图需求')
    images++; return { data: [{ b64_json: png.toString('base64') }] }
  })
  upstream.addContentTypeParser(/^multipart\/form-data/, { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
  upstream.post('/v1/images/edits', async req => {
    assert.match(req.body.toString(), /name="image\[\]"/)
    edits++; return { data: [{ b64_json: png.toString('base64') }] }
  })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  const second = { ...image, id: 'image2', upstreamModelId: 'fixture-image-2' }
  const app = createServer({ ...config(), gateway: upstream.listeningOrigin + '/v1', models: [image, second] }, { fetch: authFetch })
  const runId = crypto.randomUUID()
  const payload = { runId, sessionId: 'fixture-session', conversationId: 'fixture-canvas', prompt: '原样发送的生图需求', imageGenerationPreference: { mode: 'manual', models: ['image2'] } }
  const send = body => app.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers, 'idempotency-key': body.runId }, payload: body })
  try {
    assert.equal((await app.inject('/api/studio/models')).json().data.conversationMode, 'image')
    const first = await send(payload); assert.equal(first.statusCode, 200)
    const events = first.json().data.events
    assert.equal(events.find(e => e.type === 'tool.completed').artifacts[0].width, 32)
    assert.equal(events.at(-1).type, 'run.completed')
    assert.deepEqual((await send(payload)).json(), first.json()); assert.equal(images, 1)
    assert.equal((await send({ ...payload, prompt: 'changed' })).statusCode, 409); assert.equal(images, 1)
    assert.equal((await send({ ...payload, model: 'image', runId: crypto.randomUUID() })).statusCode, 422)
    assert.equal((await send({ ...payload, model: 'missing', runId: crypto.randomUUID() })).statusCode, 503)
    const reference = await send({ ...payload, runId: crypto.randomUUID(), attachments: [{ url: 'data:image/png;base64,' + png.toString('base64'), assetId: 'fixture-ref', source: 'canvas-ref', mimeType: 'image/png' }] })
    assert.equal(reference.statusCode, 200); assert.equal(edits, 1)
  } finally { await app.close(); await upstream.close() }
})

test('failed image-only conversations do not produce success events or repeat ambiguous requests', async () => {
  const upstream = Fastify(); let calls = 0
  upstream.post('/v1/images/generations', async (_req, reply) => { calls++; return reply.code(429).send({ error: 'fixture-only failure' }) })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  const app = createServer({ ...config(), models: [image], gateway: upstream.listeningOrigin + '/v1' }, { fetch: authFetch })
  const runId = crypto.randomUUID()
  const send = () => app.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers, 'idempotency-key': runId }, payload: { runId, prompt: 'fixture', sessionId: 's', conversationId: 'c' } })
  try {
    assert.equal((await send()).statusCode, 502)
    assert.equal((await send()).statusCode, 409); assert.equal(calls, 1)
  } finally { await app.close(); await upstream.close() }
})

test('switching between image and agent modes cannot spend the same conversation request ID twice', async () => {
  let images = 0; let agents = 0
  const app = createServer(config(), { fetch: authFetch,
    runImage: async () => { images++; return { events: [] } },
    runAgent: async () => { agents++; return { events: [] } },
  })
  const runId = crypto.randomUUID()
  const send = model => app.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers, 'idempotency-key': runId }, payload: { runId, model, prompt: 'fixture', sessionId: 's', conversationId: 'c' } })
  try {
    assert.equal((await send('image')).statusCode, 200)
    assert.equal((await send('chat')).statusCode, 409)
    assert.equal(images, 1); assert.equal(agents, 0)
  } finally { await app.close() }
})

test('idempotent image replay is owner scoped and changed parameters conflict', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-owner-ledger-'))
  const c = { ...config(), ledgerPath: join(directory, 'requests.sqlite') }
  let calls = 0
  const overrides = { fetch: authFetch, generateImage: async () => { calls++; return { url: 'fixture-owner-result-' + calls, width: 32, height: 24 } } }
  let app = createServer(c, overrides)
  let other
  const make = (server = app, h = headers, prompt = 'test') => server.inject({ method: 'POST', url: '/api/studio/images', headers: h, payload: { prompt, model: 'image' } })
  try {
    const first = await make(); assert.equal(first.statusCode, 200)
    assert.deepEqual((await make()).json(), first.json()); assert.equal(calls, 1)
    assert.equal((await make(app, headers, 'changed')).statusCode, 409); assert.equal(calls, 1)
    await app.close(); app = undefined
    other = createServer({ ...c, relayOwnerId: 8 }, overrides)
    const second = await make(other, { ...headers, authorization: 'Bearer fixture-user-8' })
    assert.equal(second.statusCode, 200); assert.equal(calls, 2)
    assert.notEqual(second.json().data.url, first.json().data.url)
    await other.close(); other = undefined
    app = createServer(c, overrides)
    assert.deepEqual((await make()).json(), first.json()); assert.equal(calls, 2)
  } finally { await app?.close(); await other?.close(); rmSync(directory, { recursive: true, force: true }) }
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

test('LangGraph pins each model to its channel and enforces a bounded tool loop without retries', async () => {
  const upstream = Fastify(); const png = await pixels(); let chats = 0; let images = 0; let rejectChat = false
  upstream.post('/v1/chat/completions', async (req, reply) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-relay-secret-2')
    chats++
    reply.header('X-Oneapi-Request-Id', 'fixture-chat-' + chats)
    if (rejectChat) return reply.code(503).send({ error: { message: 'fixture-secret-must-not-be-shown' } })
    const start = req.body.messages.at(-1).role === 'user'
    return { id: 'fixture-completion-' + chats, object: 'chat.completion', created: 1, model: 'fixture-chat', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, choices: [{ index: 0, finish_reason: start ? 'tool_calls' : 'stop', message: start ? { role: 'assistant', content: '', tool_calls: [{ id: 'fixture-tool', type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'local fixture product' }) } }] } : { role: 'assistant', content: '本地协议测试已完成。' } }] }
  })
  upstream.post('/v1/images/generations', async (req, reply) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-relay-secret-1')
    images++; reply.header('X-Oneapi-Request-Id', 'fixture-image-' + images)
    return { data: [{ b64_json: png.toString('base64') }] }
  })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  try {
    const requests = []
    const c = { ...config(), models: [{ ...image, channelId: 1 }], gateway: upstream.listeningOrigin + '/v1', onGatewayResponse: info => requests.push(info) }
    const payload = { runId: crypto.randomUUID(), sessionId: 'fixture-session', conversationId: 'fixture-canvas', prompt: '生成一张测试图' }
    const result = await runAgent(c, { ...chat, channelId: 2, maxChatCalls: 2 }, payload)
    assert.equal(chats, 2); assert.equal(images, 1)
    assert.deepEqual(requests.map(r => r.requestId), ['fixture-chat-1', 'fixture-image-1', 'fixture-chat-2'])
    assert.equal(result.events.some(e => e.type === 'tool.completed' && e.artifacts[0].type === 'image'), true)
    assert.equal(result.events.at(-1).type, 'run.completed')
    assert.equal(result.events.some(e => e.delta === '本地协议测试已完成。'), true)
    const limited = await runAgent(c, { ...chat, channelId: 2, maxChatCalls: 1 }, { ...payload, runId: crypto.randomUUID() })
    assert.equal(chats, 3); assert.equal(images, 2)
    assert.equal(limited.events.at(-1).type, 'run.failed')
    assert.equal(limited.events.filter(e => e.type === 'tool.completed').length, 1)
    rejectChat = true
    const rejected = await runAgent(c, { ...chat, channelId: 2, maxChatCalls: 2 }, { ...payload, runId: crypto.randomUUID() })
    assert.equal(chats, 4); assert.equal(images, 2)
    assert.equal(rejected.events.at(-1).error.message, '对话网关返回 HTTP 503，未自动重试')
    assert.equal(requests.at(-1).status, 503)
    assert.doesNotMatch(JSON.stringify(rejected), /fixture-secret/)
  } finally { await upstream.close() }
})
