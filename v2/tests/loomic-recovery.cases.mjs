import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantIdForRun, createResultReader, imageForCanvas, parseRequestResult, receivedImageTools, recoveredContentBlocks, requestStatusMessage, runIdFromAssistant } from '../apps/studio/src/loomic/lib/request-recovery.ts'

const id = 'original-request-123', ownerA = 'local:7', ownerB = 'local:8', createdAt = '2026-10-02T00:00:00.000Z'
const image = { url: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', width: 1, height: 1, prompt: 'fixture' }
const usage = { state: 'recorded', settlementState: 'unconfirmed', requestCount: 2, requestIds: ['native-1', 'native-2'], quota: 123, cost: 0.123, currency: 'CNY' }
const agentEvents = [ { type: 'message.delta', delta: '已收到文本' }, { type: 'tool.started', toolCallId: 'tool-1', toolName: 'generate_image' },
  { type: 'tool.completed', toolCallId: 'tool-1', artifacts: [{ type: 'image', ...image }] }, { type: 'run.failed', error: { code: 'summary_failed', message: '总结失败' } } ]
const record = (kind = 'agent', result = { events: agentEvents, usage, fundingSelection: { chat: 'trial', image: 'wallet' } }) => ({ kind, requestId: id, status: 'completed', createdAt, result })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { resolve, reject, promise } }

test('only explicit persisted assistant IDs restore the exact original UUID; old/no-ID/user messages never invent a request', () => {
  const requestId = crypto.randomUUID(), assistant = { role: 'assistant', id: assistantIdForRun(requestId), contentBlocks: [] }
  assert.equal(runIdFromAssistant(JSON.parse(JSON.stringify(assistant))), requestId)
  for (const message of [{ role: 'assistant', id: 'assistant-12345' }, { role: 'assistant', id: requestId },
    { role: 'assistant', id: 'assistant-run-v1:invalid' }, { role: 'user', id: assistant.id }]) assert.equal(runIdFromAssistant(message), null)
  assert.throws(() => assistantIdForRun('not-an-original-uuid'))
})

test('restored received image tools are seen once; pending/failed/text-only tools are not image insertion proof', () => {
  const blocks = [{ type: 'text', text: 'partial' }, { type: 'tool', toolCallId: 'received', toolName: 'generate_image', status: 'completed', artifacts: [{ type: 'image', ...image }] },
    { type: 'tool', toolCallId: 'pending', toolName: 'generate_image', status: 'running' }, { type: 'tool', toolCallId: 'failed', toolName: 'generate_image', status: 'completed', outputSummary: '生成失败' }]
  assert.deepEqual([...receivedImageTools(blocks)], ['received'])
  assert.deepEqual([...receivedImageTools(recoveredContentBlocks(parseRequestResult(record(), 'agent', id).result.events, []))], ['tool-1'])
})

test('real failed terminal remains failed with partial text/image; Native evidence and funding intent survive projection', () => {
  const saved = parseRequestResult(record(), 'agent', id)
  assert.equal(saved.status, 'completed')
  assert.equal(saved.result.events.at(-1).type, 'run.failed')
  assert.equal(saved.result.events.at(-1).error.code, 'summary_failed')
  assert.equal(saved.result.events[0].runId, id)
  assert.equal(saved.result.events[2].toolName, 'generate_image')
  assert.deepEqual(saved.result.usage, usage)
  assert.deepEqual(saved.result.fundingSelection, { chat: 'trial', image: 'wallet' })
  const blocks = recoveredContentBlocks(saved.result.events, [])
  assert.equal(blocks[0].text, '已收到文本')
  assert.equal(blocks[1].artifacts[0].url, image.url)
  assert.equal(blocks.at(-1).text, '总结失败')
  assert.equal(recoveredContentBlocks(saved.result.events, blocks).filter(block => block.type === 'tool').length, 1)
})

test('running/unknown/proved-before-submit cancellation are genuine result-free states, never synthesized completion', () => {
  for (const status of ['running', 'unknown', 'cancelled_before_submission']) {
    const value = { kind: 'image', requestId: id, status, createdAt }
    assert.equal(parseRequestResult(value, 'image', id).status, status)
    assert.equal(parseRequestResult(value, 'image', id).result, undefined)
    assert.throws(() => parseRequestResult({ ...value, result: image }, 'image', id))
    assert.match(requestStatusMessage(status), /未重新生成|不会重发/)
  }
  assert.throws(() => parseRequestResult({ kind: 'image', requestId: id, status: 'cancelled', createdAt }, 'image', id))
})

test('wrong owner/kind/key contract, malformed result and nonterminal snapshots are rejected before applying content', () => {
  for (const bad of [null, {}, { ...record(), requestId: 'other-request' }, { ...record(), kind: 'image' },
    { ...record(), createdAt: 'yesterday' }, record('agent', { events: [] }), record('agent', { events: [{ type: 'message.delta', delta: 4 }, { type: 'run.completed' }] }),
    record('agent', { events: [{ type: 'run.completed', runId: 'foreign-request' }] }),
    record('agent', { events: [{ type: 'run.completed' }, { type: 'message.delta', delta: 'late' }] }),
    record('agent', { events: [{ type: 'provider.secret', token: 'fixture-private' }, { type: 'run.completed' }] })]) {
    assert.throws(() => parseRequestResult(bad, 'agent', id))
  }
  const previous = [{ type: 'text', text: '保留部分文本' }, { type: 'tool', toolCallId: 'saved-image', toolName: 'generate_image', status: 'completed', artifacts: [{ type: 'image', ...image }] }]
  const before = structuredClone(previous)
  assert.throws(() => parseRequestResult(record('agent', {}), 'agent', id))
  assert.deepEqual(previous, before)
})

test('legacy image missing MIME/geometry is readable and decodes actual pixels before insertion', async () => {
  const saved = parseRequestResult(record('image', { url: image.url }), 'image', id).result
  assert.equal(saved.width, undefined)
  let decoded = 0
  const resolved = await imageForCanvas(saved, async url => { assert.equal(url, image.url); decoded++; return { width: 37, height: 19 } })
  assert.equal(decoded, 1)
  assert.deepEqual([resolved.width, resolved.height, resolved.mimeType], [37, 19, 'image/png'])
  assert.equal(saved.width, undefined)
  await assert.rejects(imageForCanvas(saved, async () => { throw new Error('real decoder failed') }), /decoder failed/)
  assert.equal(saved.url, image.url)
})

test('unsafe MIME, external URL, conflicting/invalid decoded geometry fail closed without invented dimensions', async () => {
  for (const bad of [{ ...image, mimeType: 'image/jpeg' }, { ...image, url: 'https://provider.invalid/private.png' },
    { ...image, url: 'javascript:alert(1)' }, { ...image, width: 0 }, { ...image, height: Infinity }]) {
    assert.throws(() => parseRequestResult(record('image', bad), 'image', id))
  }
  for (const decoded of [{ width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 10000, height: 10000 }, { width: Infinity, height: 1 }]) {
    await assert.rejects(imageForCanvas({ url: image.url }, async () => decoded), /尺寸/)
  }
  await assert.rejects(imageForCanvas({ url: image.url, width: 30 }, async () => ({ width: 31, height: 20 })), /尺寸/)
  const exact = await imageForCanvas(image, async () => { throw new Error('unexpected decode') })
  assert.equal(exact.width, 1)
})

test('legacy settled is recorded/unconfirmed in top-level and terminal usage; evidence is preserved, private fields stripped', () => {
  const legacy = { ...usage, state: 'settled', settlementState: undefined, token: 'fixture-private' }
  const saved = parseRequestResult(record('agent', { events: [{ type: 'run.completed', usage: legacy, hiddenToken: 'fixture-private' }], usage: legacy, fundingSelection: { image: 'wallet', privateKey: 'fixture-private' } }), 'agent', id)
  for (const value of [saved.result.usage, saved.result.events[0].usage]) {
    assert.equal(value.state, 'recorded'); assert.equal(value.settlementState, 'unconfirmed')
    assert.deepEqual(value.requestIds, usage.requestIds); assert.equal(value.quota, usage.quota)
  }
  assert.doesNotMatch(JSON.stringify(saved), /fixture-private|privateKey|hiddenToken/)
})

test('concurrent reconnect/manual reads share one original GET; a later explicit read still uses the same key', async () => {
  const gate = deferred(), calls = []
  const reader = createResultReader((path, init) => { calls.push({ path, init }); return gate.promise }, () => ownerA, () => 1)
  const first = reader(ownerA, 'agent', id), second = reader(ownerA, 'agent', id)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { path: `/api/studio/requests/agent/${id}/result`, init: { method: 'GET', cache: 'no-store' } })
  gate.resolve(record())
  assert.deepEqual(await first, await second)
  await reader(ownerA, 'agent', id)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.init.method === 'GET' && !call.init.body && !call.init.headers))
})

test('owner changed before read/anonymous/invalid key never invokes transport', async () => {
  let calls = 0
  const reader = createResultReader(async () => { calls++; return record() }, () => ownerB, () => 1)
  for (const [owner, kind, key] of [[ownerA, 'agent', id], ['local:guest', 'image', id], [ownerB, 'video', id], [ownerB, 'agent', 'bad/id'], [ownerB, 'agent', 'short']]) {
    await assert.rejects(reader(owner, kind, key))
  }
  assert.equal(calls, 0)
})

test('late GET after owner switch cannot apply A data; A→B→A also fails by identity epoch', async () => {
  for (const returnToA of [false, true]) {
    let owner = ownerA, epoch = 1, applied = null
    const gate = deferred(), reader = createResultReader(() => gate.promise, () => owner, () => epoch)
    const reading = reader(ownerA, 'agent', id).then(value => { applied = value })
    await Promise.resolve()
    owner = ownerB; epoch++
    if (returnToA) { owner = ownerA; epoch++ }
    gate.resolve(record())
    await assert.rejects(reading, /账号已变化/)
    assert.equal(applied, null)
  }
})

test('identity changed while queued microtask prevents the GET itself', async () => {
  let epoch = 1, calls = 0
  const reader = createResultReader(async () => { calls++; return record() }, () => ownerA, () => epoch)
  const reading = reader(ownerA, 'agent', id)
  epoch++
  await assert.rejects(reading, /账号已变化/)
  assert.equal(calls, 0)
})

test('failed/bad GET releases only its in-flight read; later manual recovery reuses key and content stays intact', async () => {
  const previous = [{ type: 'text', text: '保留文本' }], before = structuredClone(previous)
  let calls = 0
  const reader = createResultReader(async () => { calls++; if (calls === 1) throw new Error('offline'); if (calls === 2) return {}; return record() }, () => ownerA, () => 1)
  await assert.rejects(reader(ownerA, 'agent', id), /offline/)
  await assert.rejects(reader(ownerA, 'agent', id))
  assert.deepEqual(previous, before)
  assert.equal((await reader(ownerA, 'agent', id)).requestId, id)
  assert.equal(calls, 3)
})

test('failed snapshot preserves received image/text; pending tool says failure, and repeated snapshot does not duplicate image', () => {
  const previous = [{ type: 'text', text: '已收到部分文字' }, { type: 'tool', toolCallId: 'tool-1', toolName: 'generate_image', status: 'completed', artifacts: [{ type: 'image', ...image }] }]
  const before = structuredClone(previous)
  const events = parseRequestResult(record('agent', { events: [{ type: 'tool.started', toolCallId: 'tool-1', toolName: 'generate_image' }, { type: 'tool.started', toolCallId: 'failed-tool', toolName: 'generate_image' }, { type: 'run.failed' }] }), 'agent', id).result.events
  const next = recoveredContentBlocks(events, previous)
  assert.equal(next[0].text, previous[0].text)
  assert.equal(next.find(block => block.toolCallId === 'tool-1').artifacts[0].url, image.url)
  assert.equal(next.find(block => block.toolCallId === 'failed-tool').outputSummary, '原请求失败')
  const repeated = recoveredContentBlocks(events, next)
  assert.deepEqual(repeated, next)
  assert.equal(repeated.filter(block => block.type === 'tool' && block.toolCallId === 'tool-1').length, 1)
  assert.deepEqual(previous, before)
})
