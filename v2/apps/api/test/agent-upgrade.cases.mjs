import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'

const chat = { id: 'chat', kind: 'chat', upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified', toolCalling: true, channelId: 2, maxChatCalls: 2 }
const image = { id: 'image', kind: 'image', upstreamModelId: 'fixture-image', enabled: true, verification: 'live-verified', channelId: 1, operations: ['generate'], qualities: [], sizes: {} }
const completion = message => ({ id: 'fixture-response', object: 'chat.completion', created: 1, model: 'fixture-chat', choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }] })
const text = content => completion({ role: 'assistant', content })
const toolCall = (args = { prompt: 'fixture image' }, id = 'fixture-tool') => completion({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'generate_image', arguments: JSON.stringify(args) } }] })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

// 使用真实 SDK + 回环网关，所有账号、图片和账单均为合成 fixture。
async function fixture(t, options = {}) {
  const calls = { chats: [], images: 0, logs: [] }
  const upstream = Fastify()
  const png = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#7799bb' } }).png().toBuffer()
  upstream.post('/v1/chat/completions', async (req, reply) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-secret-2')
    calls.chats.push(req.body)
    reply.header('X-Oneapi-Request-Id', 'chat-' + calls.chats.length)
    const result = options.chat ? await options.chat(req, reply, calls) : calls.chats.length === 1 ? toolCall() : text('fixture summary')
    if (result?.object === 'chat.completion') result.id = 'fixture-response-' + calls.chats.length
    return result
  })
  upstream.post('/v1/images/generations', async (req, reply) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-secret-1')
    assert.equal(req.body.model, 'fixture-image')
    calls.images++
    reply.header('X-Oneapi-Request-Id', 'image-' + calls.images)
    return options.image ? options.image(req, reply) : { data: [{ b64_json: png.toString('base64') }] }
  })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => upstream.close())
  const accountFetch = async (url, init) => {
    const parsed = new URL(url)
    const owner = init.headers.Authorization === 'Bearer fixture-owner' ? 7 : 8
    let data
    if (parsed.pathname === '/api/user/self') data = { id: owner }
    else {
      assert.equal(owner, 7)
      if (parsed.pathname === '/api/status') data = { quota_per_unit: 500000, usd_exchange_rate: 7.3 }
      else {
        assert.equal(parsed.pathname, '/api/log/self')
        const id = parsed.searchParams.get('request_id')
        calls.logs.push(id)
        data = { page: 1, page_size: 2, total: 1, items: [{ type: 2, request_id: id, quota: 100 }] }
      }
    }
    return Response.json({ success: true, data })
  }
  const app = createServer({ models: [{ ...chat, ...options.model }, image], relayKey: 'fixture-secret', relayOwnerId: 7, allowGeneration: true, gateway: upstream.listeningOrigin + '/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:' }, { fetch: accountFetch })
  t.after(() => app.close())
  const payload = { runId: crypto.randomUUID(), model: 'chat', sessionId: 's', conversationId: 'c', prompt: 'fixture request', ...options.payload }
  const headers = body => ({ authorization: 'Bearer fixture-owner', 'idempotency-key': body.runId })
  const send = (body = payload, extra = {}) => app.inject({ method: 'POST', url: '/api/studio/runs', payload: body, headers: { ...headers(body), ...extra } })
  return { app, calls, payload, headers, send }
}

test('SDK upgrade: real tool loop records all three gateway IDs once and preserves auth/replay boundaries', async t => {
  const f = await fixture(t)
  assert.equal((await f.send(f.payload, { authorization: 'Bearer fixture-other', 'new-api-user': '7' })).statusCode, 403)
  assert.equal(f.calls.chats.length, 0)
  const response = await f.send()
  assert.equal(response.statusCode, 200)
  const data = response.json().data
  assert.deepEqual(data.events.map(e => e.type), ['run.started', 'tool.started', 'tool.completed', 'message.delta', 'run.completed'])
  assert.equal(data.events[1].toolCallId, data.events[2].toolCallId)
  assert.equal(data.events[2].artifacts[0].width, 12)
  assert.equal(data.events[3].delta, 'fixture summary')
  assert.equal(f.calls.chats[1].messages.at(-1).role, 'tool')
  assert.equal(f.calls.chats[1].messages.at(-1).tool_call_id, 'fixture-tool')
  assert.deepEqual(data.usage.requestIds, ['chat-1', 'image-1', 'chat-2'])
  assert.equal(data.usage.state, 'recorded')
  assert.equal(data.usage.settlementState, 'unconfirmed')
  assert.equal(data.usage.quota, 300)
  assert.deepEqual((await f.send()).json(), response.json())
  assert.equal((await f.send({ ...f.payload, prompt: 'changed' })).statusCode, 409)
  assert.equal(f.calls.chats.length, 2)
  assert.equal(f.calls.images, 1)
  assert.equal(f.calls.logs.length, 3)
})

test('SDK upgrade: text-only model preserves history and sends no image tools', async t => {
  const f = await fixture(t, { model: { toolCalling: false }, payload: { history: [{ role: 'user', content: 'previous user' }, { role: 'assistant', contentBlocks: [{ type: 'text', text: 'previous answer' }] }] }, chat: req => {
    assert.equal(req.body.tools?.length ?? 0, 0)
    assert.equal(req.body.messages[1].content, 'previous user')
    assert.equal(req.body.messages[2].content, 'previous answer')
    return text('text only')
  } })
  const data = (await f.send()).json().data
  assert.deepEqual(data.events.map(e => e.type), ['run.started', 'message.delta', 'run.completed'])
  assert.equal(data.events[1].delta, 'text only')
  assert.equal(f.calls.chats.length, 1)
  assert.equal(f.calls.images, 0)
})

for (const mode of ['tool HTTP error', 'invalid tool arguments', 'repeated tool']) test('SDK upgrade: ' + mode + ' cannot retry or create a second image', async t => {
  const f = await fixture(t, { chat: (_req, _reply, calls) => toolCall(mode === 'invalid tool arguments' ? { prompt: '' } : undefined, 'fixture-tool-' + calls.chats.length), image: mode === 'tool HTTP error' ? (_req, reply) => reply.code(429).send({ error: 'fixture-private-provider-detail' }) : undefined })
  const result = await f.send()
  assert.equal(result.statusCode, 200)
  const data = result.json().data
  assert.equal(data.events.at(-1).type, 'run.failed')
  assert.equal(data.events.some(e => e.type === 'run.completed'), false)
  assert.doesNotMatch(result.body, /fixture-private-provider-detail|fixture-secret/)
  assert.equal(f.calls.images, mode === 'invalid tool arguments' ? 0 : 1)
  assert.equal(f.calls.chats.length, mode === 'repeated tool' ? 2 : 1)
  if (mode === 'tool HTTP error') assert.equal(data.usage.state, 'pending')
  const before = [f.calls.chats.length, f.calls.images, f.calls.logs.length]
  assert.deepEqual((await f.send()).json(), result.json())
  assert.deepEqual([f.calls.chats.length, f.calls.images, f.calls.logs.length], before)
})

test('SDK upgrade: lost summary connection preserves the generated artifact and never retries unknown work', async t => {
  const f = await fixture(t, { chat: (_req, reply, calls) => {
    if (calls.chats.length === 1) return toolCall()
    reply.raw.destroy()
    return reply
  } })
  const first = await f.send()
  const events = first.json().data.events
  assert.equal(first.json().data.usage.state, 'pending')
  assert.equal(first.json().data.usage.cost, undefined)
  assert.equal(first.json().data.usage.requestCount, 3)
  assert.deepEqual(first.json().data.usage.requestIds, ['chat-1', 'image-1'])
  assert.equal(events.at(-1).type, 'run.failed')
  assert.equal(events.filter(e => e.type === 'tool.completed').length, 1)
  assert.deepEqual((await f.send()).json(), first.json())
  assert.equal(f.calls.chats.length, 2)
  assert.equal(f.calls.images, 1)
})

test('SDK upgrade: lost image connection leaves usage pending and never repeats the tool', async t => {
  const f = await fixture(t, { image: (_req, reply) => { reply.raw.destroy(); return reply } })
  const first = await f.send()
  const data = first.json().data
  assert.equal(data.events.at(-1).type, 'run.failed')
  assert.equal(data.events.some(e => e.type === 'tool.completed'), false)
  assert.equal(data.usage.state, 'pending')
  assert.equal(data.usage.requestCount, 2)
  assert.equal(data.usage.cost, undefined)
  assert.deepEqual((await f.send()).json(), first.json())
  assert.equal(f.calls.chats.length, 1)
  assert.equal(f.calls.images, 1)
})

test('SDK upgrade: disconnected client cannot re-execute a running request; fresh busy ID remains retryable', async t => {
  const started = deferred()
  const release = deferred()
  t.after(() => release.resolve())
  const f = await fixture(t, { chat: async (_req, _reply, calls) => {
    if (calls.chats.length === 1) { started.resolve(); await release.promise }
    return text('completed after disconnect')
  } })
  await f.app.listen({ host: '127.0.0.1', port: 0 })
  const controller = new AbortController()
  const request = fetch(f.app.listeningOrigin + '/api/studio/runs', { method: 'POST', headers: { ...f.headers(f.payload), 'content-type': 'application/json' }, body: JSON.stringify(f.payload), signal: controller.signal })
  const aborted = assert.rejects(request, { name: 'AbortError' })
  await started.promise
  controller.abort()
  await aborted
  assert.equal((await f.send()).statusCode, 409)
  const fresh = { ...f.payload, runId: crypto.randomUUID() }
  assert.match((await f.send(fresh)).json().message, /尚未执行/)
  release.resolve()
  let replay
  for (let i = 0; i < 100; i++) {
    replay = await f.send()
    if (replay.statusCode === 200) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(replay.statusCode, 200)
  assert.equal(replay.json().data.events.at(-1).type, 'run.completed')
  assert.equal(f.calls.chats.length, 1)
  assert.equal((await f.send(fresh)).statusCode, 200)
  assert.equal(f.calls.chats.length, 2)
  assert.equal(f.calls.images, 0)
})
