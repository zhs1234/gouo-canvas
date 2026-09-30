import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const parse = text => text.split('\n\n').filter(s => s.startsWith('data: ')).map(s => JSON.parse(s.slice(6)))
async function fixture(t, mode = 'text') {
  const gate = deferred()
  t.after(() => gate.resolve())
  const upstream = Fastify()
  let calls = 0
  let images = 0
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aaa' } }).png().toBuffer()
  upstream.post('/v1/images/generations', async () => { images++; return { data: [{ b64_json: png.toString('base64') }] } })
  upstream.post('/v1/chat/completions', async (req, reply) => {
    calls++
    assert.equal(req.body.stream, true)
    assert.equal(req.headers.authorization, 'Bearer fixture-key-2')
    reply.hijack()
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'x-oneapi-request-id': 'chat-' + calls })
    const chunk = (delta, finish_reason = null) => reply.raw.write('data: ' + JSON.stringify({ id: 'chunk-' + calls, object: 'chat.completion.chunk', created: 1, model: 'fixture-chat', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n')
    if (mode === 'tool' && calls === 1) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'tool-1', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":' } }] })
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"fixture"}' } }] })
      chunk({}, 'tool_calls')
    } else {
      chunk({ role: 'assistant', content: '第一段' })
      await gate.promise
      if (mode === 'broken') { reply.raw.destroy(); return }
      chunk({ content: '第二段' })
      chunk({}, 'stop')
    }
    reply.raw.end('data: [DONE]\n\n')
  })
  await upstream.listen({ host: '127.0.0.1', port: 0 })
  const app = createServer({ authOrigin: 'http://fixture.invalid', gateway: upstream.listeningOrigin + '/v1', relayKey: 'fixture-key', relayOwnerId: 7, allowGeneration: true, ledgerPath: ':memory:', models: [
    { id: 'chat', kind: 'chat', upstreamModelId: 'fixture-chat', channelId: 2, enabled: true, verification: 'live-verified', toolCalling: mode === 'tool', maxChatCalls: 2 },
    { id: 'image', kind: 'image', upstreamModelId: 'fixture-image', channelId: 1, enabled: true, verification: 'live-verified', operations: ['generate'], sizes: {}, qualities: [] },
  ] }, { fetch: async (_url, init) => Response.json({ success: true, data: { id: init.headers.Authorization === 'Bearer owner' ? 7 : 8 } }) })
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(async () => { gate.resolve(); app.server.closeAllConnections(); upstream.server.closeAllConnections(); await app.close(); await upstream.close() })
  const body = { runId: crypto.randomUUID(), sessionId: 's', conversationId: 'c', prompt: 'fixture', model: 'chat' }
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json', 'idempotency-key': body.runId }
  const send = (payload = body, extra = {}) => fetch(app.listeningOrigin + '/api/studio/runs/stream', { method: 'POST', headers: { ...headers, 'idempotency-key': payload.runId, ...extra }, body: JSON.stringify(payload) })
  return { app, gate, body, headers, send, counts: () => [calls, images] }
}

test('SSE sends real token chunks before upstream completion; preserves auth, busy and cross-transport replay', async t => {
  const f = await fixture(t)
  assert.equal((await f.send(f.body, { authorization: 'Bearer other' })).status, 403)
  assert.deepEqual(f.counts(), [0, 0])
  const response = await f.send()
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = ''
  while (!parse(received).some(e => e.type === 'message.delta')) received += decoder.decode((await reader.read()).value)
  assert.equal(parse(received).find(e => e.type === 'message.delta').delta, '第一段')
  assert.equal(parse(received).some(e => e.type === 'run.completed'), false)
  assert.equal((await f.send()).status, 409)
  const next = { ...f.body, runId: crypto.randomUUID() }
  assert.equal((await f.send(next)).status, 409)
  f.gate.resolve()
  while (true) { const chunk = await reader.read(); if (chunk.done) break; received += decoder.decode(chunk.value) }
  const events = parse(received)
  assert.equal(events.filter(e => e.type === 'message.delta').map(e => e.delta).join(''), '第一段第二段')
  assert.equal(events.at(-1).type, 'run.completed')
  assert.equal(events.at(-1).usage.state, 'pending')
  assert.deepEqual(parse(await (await f.send()).text()), events)
  const batch = await f.app.inject({ method: 'POST', url: '/api/studio/runs', headers: f.headers, payload: f.body })
  assert.equal(batch.json().data.events.at(-1).type, 'run.completed')
  assert.deepEqual(f.counts(), [1, 0])
  assert.equal((await f.send({ ...f.body, prompt: 'changed' })).status, 409)
  const nextResponse = await f.send(next)
  assert.equal(nextResponse.status, 200)
  await nextResponse.text()
})

test('SSE fragmented tool arguments generate one image and stream the summary; final result survives client disconnect', async t => {
  const f = await fixture(t, 'tool')
  const response = await f.send()
  const reader = response.body.getReader()
  let received = ''
  while (!parse(received).some(e => e.type === 'message.delta')) received += new TextDecoder().decode((await reader.read()).value)
  assert.deepEqual(parse(received).filter(e => e.type.startsWith('tool.')).map(e => e.type), ['tool.started', 'tool.completed'])
  await reader.cancel()
  f.gate.resolve()
  let replay
  for (let i = 0; i < 100; i++) { replay = await f.send(); if (replay.status === 200) break; await new Promise(r => setTimeout(r, 10)) }
  const events = parse(await replay.text())
  assert.equal(events.at(-1).type, 'run.completed')
  assert.equal(events.find(e => e.type === 'tool.completed').artifacts[0].width, 8)
  assert.deepEqual(f.counts(), [2, 1])
})

test('SSE broken upstream ends failed with partial text and cannot rerun paid work', async t => {
  const f = await fixture(t, 'broken')
  const response = await f.send()
  const reader = response.body.getReader()
  let text = ''
  while (!parse(text).some(e => e.type === 'message.delta')) text += new TextDecoder().decode((await reader.read()).value)
  f.gate.resolve()
  while (true) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value) }
  const events = parse(text)
  assert.equal(events.at(-1).type, 'run.failed')
  assert.equal(events.at(-1).usage.state, 'pending')
  assert.deepEqual(parse(await (await f.send()).text()), events)
  assert.deepEqual(f.counts(), [1, 0])
})
