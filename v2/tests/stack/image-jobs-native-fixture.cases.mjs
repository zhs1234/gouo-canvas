import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { jobSummary, validateOriginalJob, validateReadOnly, validateResume, inputs } from './image-jobs-native.cases.mjs'
import { sourceCommit, binarySha256 } from './browser-offline-native.cases.mjs'
const key = '11111111-1111-4111-8111-111111111111', asset = '22222222-2222-4222-8222-222222222222'
test('job report excludes original prompt, credentials and private image body and refuses a fabricated terminal', () => {
  const secret = 'private-token-prompt-not-in-report'
  const data = { kind: 'image', jobId: key, requestId: key, status: 'completed', assetId: asset, secret,
    result: { url: 'data:image/png;base64,cHJpdmF0ZQ==', prompt: secret, width: 1, height: 1,
      usage: { state: 'pending', settlementState: 'unconfirmed', requestIds: ['observed-original'] } } }
  const summary = jobSummary(data)
  assert.match(summary.imageSha256, /^[a-f\d]{64}$/)
  assert.equal(JSON.stringify(summary).includes(secret), false)
  assert.equal(JSON.stringify(summary).includes(data.result.url), false)
  for (const alter of [d => d.requestId = asset, d => d.status = 'fake', d => d.assetId = null,
    d => d.result.usage.settlementState = 'confirmed', d => d.result.usage.state = 'settled',
    d => d.result.url = 'https://untrusted.example/private.png']) {
    const d = structuredClone(data); alter(d); assert.throws(() => jobSummary(d))
  }
  assert.throws(() => jobSummary({ ...data, status: 'unknown' }))
  assert.equal(jobSummary({ kind: 'image', jobId: key, requestId: key, status: 'unknown' }).status, 'unknown')
})
test('original completed proof requires a new owner, exactly one image submission and the exact private bytes', () => {
  const before = { studio: { requests: [] }, provider: { image: 4, chat: 7 } }
  const completed = { studio: { jobs: [{ key, asset_id: asset, status: 'completed', native_pending: 0 }],
    submissions: [{ model_kind: 'image' }], stagingCount: 0,
    assets: [{ id: asset, run_id: key, sha256: 'a'.repeat(64), bytesSha256: 'a'.repeat(64) }] }, provider: { image: 5, chat: 7 } }
  validateOriginalJob(before, completed)
  for (const alter of [s => s.studio.jobs[0].status = 'unknown', s => s.studio.jobs[0].native_pending = 1,
    s => s.studio.submissions.push({ model_kind: 'image' }), s => s.provider.image++,
    s => s.provider.chat++, s => s.studio.stagingCount = 1,
    s => s.studio.assets[0].run_id = asset, s => s.studio.assets[0].bytesSha256 = 'b'.repeat(64)]) {
    const s = structuredClone(completed); alter(s); assert.throws(() => validateOriginalJob(before, s))
  }
  assert.throws(() => validateOriginalJob({ ...before, studio: { requests: [{ key }] } }, completed))
})
test('read-only proof refuses model traffic, private database mutations and Native money mutations', () => {
  const before = { studio: { dataHash: 'studio' }, native: { protectedHash: 'native' }, provider: { image: 1, chat: 0, requests: [] } }
  validateReadOnly(before, structuredClone(before))
  for (const alter of [s => s.studio.dataHash = 'changed', s => s.native.protectedHash = 'changed', s => s.provider.image++]) {
    const s = structuredClone(before); alter(s); assert.throws(() => validateReadOnly(before, s))
  }
})
test('segmented recovery requires the same accepted original, complete bytes and preserved instance proof', () => {
  const original = { account: { owner: 10 }, state: { origin: 'http://127.0.0.1:49999', project: 'gouo-user-acceptance-123-abcdef', instanceId: key } }
  const before = { stage: 'before-generation', studio: { requests: [] }, provider: { image: 4, chat: 7 } }
  const terminal = { stage: 'failure-readonly-observation', studio: { jobs: [{ key, asset_id: asset, status: 'completed', native_pending: 0 }],
    submissions: [{ model_kind: 'image' }], stagingCount: 0, assets: [{ id: asset, run_id: key, sha256: 'a'.repeat(64), bytesSha256: 'a'.repeat(64) }] }, provider: { image: 5, chat: 7 } }
  const source = { state: 'failed', owner: 10, ...original.state, sourceCommit, binarySha256, realPaidProviderCalls: 0, procurementCost: 0,
    jobId: key, accepted: { jobId: key, status: 'accepted' }, requests: [{ method: 'POST', path: '/api/studio/image-jobs' }], snapshots: [before, terminal] }
  assert.equal(validateResume(source, original).key, key)
  for (const alter of [s => s.state = 'passed', s => s.owner = 7, s => s.instanceId = asset, s => s.binarySha256 = 'wrong',
    s => s.requests.push({ method: 'POST', path: '/api/studio/image-jobs' }), s => s.accepted.status = 'fake',
    s => s.snapshots[1].studio.jobs[0].status = 'unknown', s => s.snapshots[1].provider.image++]) {
    const s = structuredClone(source); alter(s); assert.throws(() => validateResume(s, original))
  }
})
test('opt-in scope requires a separate ordinary identity, same random instance, no prior report and no alternate scenario', async () => {
  const local = await mkdtemp(join(tmpdir(), 'gouo-job-native-fixture-'))
  try {
    const directory = join(local, 'instance'); await mkdir(directory); await mkdir(join(directory, 'control'))
    const statePath = join(directory, 'state.json'), identityPath = join(local, 'identity.json'), foreignPath = join(local, 'foreign.json'), reportPath = join(local, 'report.json')
    const state = { version: 1, project: 'gouo-user-acceptance-123-abcdef', directory, compose: join(directory, 'compose.json'), env: join(directory, 'empty.env'),
      origin: 'http://127.0.0.1:49999', sourceCommit, binarySha256, instanceId: key, procurementCost: 0,
      syntheticComplianceFixture: true, provider: 'explicit local acceptance fixture' }
    const identity = { version: 1, origin: state.origin, stateFile: statePath, fixtureOnly: true,
      account: { owner: 9, username: 't112g1234567890ab', password: 'Synthetic_only_123!', threadId: asset } }
    const foreign = { ...identity, account: { ...identity.account, owner: 7, username: 't112e1234567890ab' } }
    const compose = { services: { 'new-api': { image: 'gouo-v2-new-api:latest' },
      'studio-api': { environment: { GOUO_BACKEND_DEV_TARGET: 'http://new-api:3000', GOUO_GATEWAY_BASE_URL: 'http://new-api:3000/v1', GOUO_ACCOUNT_INSTANCE_ID: key } },
      'fixture-provider': { entrypoint: ['node', '/app/tests/stack/user-acceptance-environment-provider.mjs'], volumes: [{ target: '/fixture', source: join(directory, 'control'), read_only: false }] } }, volumes: { 'native-data': {}, 'studio-data': {} } }
    await Promise.all([writeFile(statePath, JSON.stringify(state)), writeFile(state.compose, JSON.stringify(compose)), writeFile(state.env, ''),
      writeFile(identityPath, JSON.stringify(identity)), writeFile(foreignPath, JSON.stringify(foreign))])
    const args = ['--state', statePath, '--identity', identityPath, '--foreign-identity', foreignPath, '--report', reportPath, '--confirm-isolated-native']
    assert.equal((await inputs(args, local)).foreignAccount.owner, 7)
    await assert.rejects(inputs(args.filter(v => v !== '--confirm-isolated-native'), local))
    await assert.rejects(inputs([...args, '--foreign-identity', foreignPath], local))
    await assert.rejects(inputs(args.map(v => v === foreignPath ? identityPath : v), local))
    await assert.rejects(inputs([...args, '--scenario', 'text'], local))
    await assert.rejects(inputs([...args, '--login-only'], local))
    await writeFile(reportPath, '{}')
    await assert.rejects(inputs(args, local))
  } finally { await rm(local, { recursive: true, force: true }) }
})
