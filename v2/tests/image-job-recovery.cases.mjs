import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canOperateJob, createImageJobClient, imageJobPayloadSchema, parseImageJob, validPersistedImageBinding } from '../apps/studio/src/loomic/lib/image-jobs.ts'

const id = '85ec4ad0-4bd0-4aa5-b9ac-ecbe8f5a1701', owner = 'local:7', at = '2026-10-02T00:00:00.000Z'
const image = { url: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', width: 1, height: 1 }
const dto = (status = 'accepted', extra = {}) => ({ jobId: id, requestId: id, kind: 'image', status, createdAt: at, updatedAt: at, ...extra })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
function fixture(transport, extra = {}) { return createImageJobClient({ transport, getOwner: () => owner, getEpoch: () => 1, verifyOwner: async () => true, ...extra }) }

test('persisted mode/ID conflicts fail closed instead of switching a job into synchronous recovery', () => {
  assert.equal(validPersistedImageBinding({}), true)
  assert.equal(validPersistedImageBinding({ requestId: 'legacy-original-key', requestOwner: owner }), true)
  assert.equal(validPersistedImageBinding({ executionMode: 'job', jobId: id, requestId: id, requestOwner: owner }), true)
  for (const value of [{ jobId: id, requestId: id, requestOwner: owner }, { executionMode: 'sync', jobId: id, requestId: id, requestOwner: owner },
    { executionMode: 'job', requestId: id, requestOwner: owner }, { executionMode: 'job', jobId: id, requestId: crypto.randomUUID(), requestOwner: owner },
    { executionMode: 'other', requestId: id, requestOwner: owner }, { executionMode: 'job', jobId: id, requestId: id, requestOwner: 'local:guest' }]) assert.equal(validPersistedImageBinding(value), false)
})

test('job DTO whitelist keeps genuine statuses and requires validated original plus asset only on completed GET', () => {
  for (const status of ['accepted','ready','submission_started','output_received','output_saved','needs_authorization','unknown','cancelled_before_submission']) {
    assert.equal(parseImageJob(dto(status, { privateToken: 'never publish' }), id, true).status, status)
    assert.equal(parseImageJob(dto(status, { privateToken: 'never publish' }), id).privateToken, undefined)
    assert.throws(() => parseImageJob(dto(status, { result: image }), id, true))
  }
  assert.throws(() => parseImageJob(dto('running'), id))
  assert.throws(() => parseImageJob(dto('completed'), id, true))
  assert.throws(() => parseImageJob(dto('completed', { assetId: id, result: { ...image, mimeType: 'image/jpeg' } }), id, true))
  const complete = parseImageJob(dto('completed', { assetId: id, result: { ...image, privateToken: 'hidden' } }), id, true)
  assert.equal(complete.result.url, image.url); assert.equal(complete.result.privateToken, undefined)
  assert.throws(() => parseImageJob(dto('completed', { assetId: 'invalid', result: image }), id, true))
  assert.throws(() => parseImageJob(dto('accepted', { pendingNativeOperation: true }), id))
  assert.throws(() => parseImageJob(dto('accepted', { requestId: crypto.randomUUID() }), id))
})
test('original parameters are strict and no bearer, drift field or false funding consent can be persisted/sent', () => {
  assert.deepEqual(imageJobPayloadSchema.parse({ model: 'image-fixture', prompt: ' 原参数 ' }), { model: 'image-fixture', prompt: '原参数', inputImages: [] })
  for (const extra of [{ accessToken: 'secret' }, { provider: 'other' }, { payWithBalance: false }]) assert.throws(() => imageJobPayloadSchema.parse({ model: 'image-fixture', prompt: '原参数', ...extra }))
})
test('unknown/submitted/cancelled/completed never authorize or cancel; raw output has only local finalize', () => {
  for (const status of ['submission_started','unknown','completed','cancelled_before_submission']) for (const action of ['authorize','cancel','finalize']) assert.equal(canOperateJob(dto(status), action), false)
  for (const status of ['output_received','output_saved']) { assert.equal(canOperateJob(dto(status), 'finalize'), true); assert.equal(canOperateJob(dto(status), 'authorize'), false); assert.equal(canOperateJob(dto(status), 'cancel'), false) }
  assert.equal(canOperateJob(dto('needs_authorization'), 'authorize'), true)
  assert.equal(canOperateJob(dto('unknown', { pendingNativeOperation: true }), 'cancel'), false)
})
test('duplicate manual/online GETs share the same original read and release on failure for a later explicit read', async () => {
  const gate = deferred(), calls = []; let fail = true
  const client = fixture(async (path, init) => { calls.push({ path, init }); await gate.promise; if (fail) throw new Error('read unavailable'); return dto('unknown') })
  const first = client.read(owner, id), second = client.read(owner, id)
  assert.equal(first, second); gate.resolve(); await assert.rejects(first); assert.equal(calls.length, 1)
  fail = false; assert.equal((await client.read(owner, id)).status, 'unknown'); assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.path === `/api/studio/image-jobs/${id}` && call.init.method === 'GET' && call.init.cache === 'no-store'))
})
test('owner/epoch changes before GET, while it is pending, and A→B→A discard all late results', async () => {
  let activeOwner = owner, epoch = 1, calls = 0; const gate = deferred()
  const client = fixture(async () => { calls++; await gate.promise; return dto('completed', { assetId: id, result: image }) }, { getOwner: () => activeOwner, getEpoch: () => epoch })
  activeOwner = 'local:8'; assert.throws(() => client.read(owner, id)); assert.equal(calls, 0)
  activeOwner = owner; const pending = client.read(owner, id); await Promise.resolve(); activeOwner = 'local:8'; epoch++; activeOwner = owner; epoch++
  gate.resolve(); await assert.rejects(pending, /账号已变化/); assert.equal(calls, 1)
})
test('fresh owner mismatch or changed identity makes zero POSTs, including stale A authorization', async () => {
  let epoch = 1, calls = 0
  const client = fixture(async () => { calls++; return dto() }, { verifyOwner: async () => false })
  await assert.rejects(client.start(owner, id, { prompt: '原参数', model: 'image-fixture', inputImages: [] })); assert.equal(calls, 0)
  const changed = fixture(async () => { calls++; return dto() }, { getEpoch: () => epoch, verifyOwner: async () => { epoch++; return true } })
  await assert.rejects(changed.operate(owner, parseImageJob(dto('needs_authorization'), id), 'authorize', true)); assert.equal(calls, 0)
})
test('202 acceptance and POST errors have one original key and no synchronous fallback or hidden retry', async () => {
  const calls = [], payload = { prompt: '原参数', model: 'image-fixture', inputImages: [], payWithBalance: true }
  const client = fixture(async (path, init) => { calls.push({ path, init }); throw new Error('202 response lost') })
  await assert.rejects(client.start(owner, id, payload)); assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/api/studio/image-jobs'); assert.equal(calls[0].init.headers['Idempotency-Key'], id); assert.deepEqual(JSON.parse(calls[0].init.body), payload)
})
test('actions require explicit original-state proof and send only confirm; finalize never sends image parameters', async () => {
  const calls = [], client = fixture(async (path, init) => { calls.push({ path, init }); return dto(path.endsWith('/cancel') ? 'cancelled_before_submission' : 'accepted') })
  const needs = parseImageJob(dto('needs_authorization'), id)
  await assert.rejects(client.operate(owner, needs, 'authorize')); await assert.rejects(client.operate(owner, parseImageJob(dto('unknown'), id), 'cancel', true)); assert.equal(calls.length, 0)
  await client.operate(owner, needs, 'authorize', true); await client.operate(owner, needs, 'cancel', true)
  await client.operate(owner, parseImageJob(dto('output_saved', { assetId: id }), id), 'finalize')
  assert.deepEqual(calls.slice(0, 2).map(call => JSON.parse(call.init.body)), [{ confirm: true }, { confirm: true }])
  assert.equal(calls[2].init.body, undefined)
  assert.ok(calls.every(call => call.init.method === 'POST' && call.path.startsWith(`/api/studio/image-jobs/${id}/`)))
})
