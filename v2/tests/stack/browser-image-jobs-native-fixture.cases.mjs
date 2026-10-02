// F only: local HTTP supplier + pure file/evidence guards. No browser, Native,
// Docker, account setup, paid provider or real model. Explicit node --test file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { spawnSync } from 'node:child_process'
import { inputs, validatePersistence, validateHeld, validateBrowserRecovery, sceneSummary, processStartTicks } from './browser-image-jobs-native.cases.mjs'
import { sourceCommit, binarySha256 } from './browser-offline-native.cases.mjs'
import { createAcceptanceProvider } from './user-acceptance-environment-provider.mjs'

const key = '11111111-1111-4111-8111-111111111111', asset = '22222222-2222-4222-8222-222222222222', tag = 'B3N2-1234567890abcdef', canvasId = tag.toLowerCase()
const hash = value => createHash('sha256').update(value instanceof Uint8Array || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
async function directory(t, prefix = 'gouo-b3-n2-') { const path = await mkdtemp(join(tmpdir(), prefix)); t.after(() => rm(path, { recursive: true, force: true })); return path }
function persistence() {
  const parametersHash = 'a'.repeat(64)
  return { proof: { mode: 'job', jobId: key, requestId: key, owner: 'local:11', canvasId, parametersHash, sequence: 2, completedAt: 100 },
    post: { jobId: key, sameKey: true, model: 'fixture-image', inputImages: 0, syntheticPrompt: true, parametersHash, fetchSequence: 3, commitPresentAtFetch: true, fetchParametersHash: parametersHash } }
}
test('IDB completion proof requires original UUID/owner/canvas/parameters before the unique actual UI POST', () => {
  const f = persistence(); assert.equal(validatePersistence(f.proof, f.post, 11, canvasId).jobId, key)
  for (const change of [f => f.proof.sequence = 4, f => f.post.commitPresentAtFetch = false, f => f.post.fetchParametersHash = 'b'.repeat(64), f => f.proof.mode = 'sync', f => f.proof.owner = 'local:12',
    f => f.proof.canvasId = 'foreign-canvas', f => f.proof.requestId = asset, f => f.proof.parametersHash = 'b'.repeat(64),
    f => f.post.sameKey = false, f => f.post.model = 'external', f => f.post.inputImages = 1, f => f.post.syntheticPrompt = false]) {
    const broken = persistence(); change(broken); assert.throws(() => validatePersistence(broken.proof, broken.post, 11, canvasId))
  }
  assert.throws(() => validatePersistence(null, f.post, 11, canvasId))
})
function held() {
  const before = { studio: { requests: [] }, provider: { image: 4, chat: 7 } }
  const paused = { studio: { jobs: [{ key, status: 'submission_started' }], submissions: [{ key, model_kind: 'image' }], assets: [], stagingCount: 0,
    jobReservations: [{ key, status: 'held' }], reservations: [{ key, benefit: 'image', status: 'reserved' }] },
    provider: { image: 5, chat: 7, requests: [{ roleTag: tag, kind: 'image', outcome: 'waiting-image-control' }] } }
  return { before, paused }
}
test('page close requires actual submitted original work, held/reserved image and exactly one paused supplier image', () => {
  const f = held(); validateHeld(f.before, f.paused, key, tag)
  for (const change of [f => f.before.studio.requests.push({ key }), f => f.paused.studio.jobs[0].status = 'completed',
    f => f.paused.studio.jobs[0].key = asset, f => f.paused.studio.submissions.push({ model_kind: 'image' }),
    f => f.paused.studio.jobReservations[0].status = 'used', f => f.paused.studio.reservations[0].status = 'used',
    f => f.paused.studio.reservations[0].benefit = 'chat', f => f.paused.studio.assets.push({ id: asset }),
    f => f.paused.provider.image++, f => f.paused.provider.chat++, f => f.paused.provider.requests[0].outcome = 'completed']) {
    const broken = held(); change(broken); assert.throws(() => validateHeld(broken.before, broken.paused, key, tag))
  }
})
function browserRequests() { return [{ method: 'POST', path: '/api/user/login' }, { method: 'POST', path: '/api/studio/image-jobs', jobId: key },
  { method: 'GET', path: '/api/studio/image-jobs/' + key }, { method: 'POST', path: '/api/user/auth/refresh' }, { method: 'GET', path: '/api/studio/image-jobs/' + key }] }
test('close/new-tab recovery retains real GET counts and rejects replay, sync fallback, foreign ID and hidden actions', () => {
  assert.deepEqual(validateBrowserRecovery(browserRequests(), key, 3), { originalPosts: 1, originalJobGetCount: 2, recoveryBusinessWrites: 0, syncFallbackPosts: 0 })
  for (const row of [{ method: 'POST', path: '/api/studio/image-jobs', jobId: key }, { method: 'POST', path: '/api/studio/images' },
    { method: 'POST', path: '/api/studio/image-jobs/' + key + '/finalize' }, { method: 'POST', path: '/api/studio/trial/claim' },
    { method: 'GET', path: '/api/studio/image-jobs/' + asset }]) assert.throws(() => validateBrowserRecovery([...browserRequests(), row], key, 3))
})
test('scene evidence hashes original PNG and parameters, excludes private values, and rejects wrong owner or original result binding', () => {
  const parameters = { prompt: tag + ' 本地验收受控图片 · 采购成本0', model: 'fixture-image', inputImages: [] }, privateValue = 'secret-prompt-token-not-in-report'
  const scene = { canvasId, appState: {}, elements: [{ id: 'placeholder', type: 'rectangle', x: 1, y: 2, width: 400, height: 400,
    customData: { type: 'image-generator', status: 'awaiting', executionMode: 'job', jobId: key, requestId: key, requestOwner: 'local:11', requestParameters: parameters } },
    { id: 'image', type: 'image', fileId: 'png', customData: { type: 'image-job-result', jobId: key, requestOwner: 'local:11', assetId: asset, secret: privateValue } }],
    files: { png: { dataURL: 'data:image/png;base64,' + Buffer.from(privateValue).toString('base64') } } }
  const summary = sceneSummary(scene, 11, canvasId, tag)
  assert.equal(summary.images[0].imageSha256, hash(privateValue)); assert.equal(summary.placeholders[0].parametersHash, hash(parameters))
  assert.equal(JSON.stringify(summary).includes(privateValue), false); assert.equal(JSON.stringify(summary).includes(scene.files.png.dataURL), false)
  for (const change of [s => s.elements[1].customData.requestOwner = 'local:12', s => s.elements[1].customData.assetId = 'bad', s => s.files.png.dataURL = 'https://external.example/image.png']) {
    const broken = structuredClone(scene); change(broken); assert.throws(() => sceneSummary(broken, 11, canvasId, tag))
  }
})
async function guardFixture(t) {
  const local = await directory(t), instance = join(local, 'instance'); await mkdir(instance); await mkdir(join(instance, 'control'))
  const statePath = join(instance, 'state.json'), identityPath = join(local, 'ordinary.json'), foreignPath = join(local, 'foreign.json'), reportPath = join(local, 'new-report.json')
  const state = { version: 1, project: 'gouo-user-acceptance-123-abcdef', directory: instance, compose: join(instance, 'compose.json'), env: join(instance, 'empty.env'),
    origin: 'http://127.0.0.1:49999', sourceCommit, binarySha256, instanceId: key, procurementCost: 0, syntheticComplianceFixture: true, provider: 'explicit local acceptance fixture' }
  const identity = { version: 1, origin: state.origin, stateFile: statePath, fixtureOnly: true, account: { owner: 11, username: 't112k1234567890ab', password: 'Synthetic_only_123!', threadId: asset } }
  const foreign = { ...identity, account: { ...identity.account, owner: 7, username: 't112g1234567890ab' } }
  const compose = { services: { 'new-api': { image: 'gouo-v2-new-api:latest' },
    'studio-api': { environment: { GOUO_BACKEND_DEV_TARGET: 'http://new-api:3000', GOUO_GATEWAY_BASE_URL: 'http://new-api:3000/v1', GOUO_ACCOUNT_INSTANCE_ID: key, GOUO_ENABLE_IMAGE_JOBS: 'true' } },
    'fixture-provider': { environment: { GOUO_ACCOUNT_INSTANCE_ID: key }, entrypoint: ['node', '/app/tests/stack/user-acceptance-environment-provider.mjs'], volumes: [{ target: '/fixture', source: join(instance, 'control'), read_only: false }] } }, volumes: { 'native-data': {}, 'studio-data': {} } }
  const save = async () => Promise.all([writeFile(statePath, JSON.stringify(state)), writeFile(state.compose, JSON.stringify(compose)), writeFile(state.env, ''), writeFile(identityPath, JSON.stringify(identity)), writeFile(foreignPath, JSON.stringify(foreign))])
  await save()
  return { local, state, compose, identity, foreign, save, reportPath, args: ['--state', statePath, '--identity', identityPath, '--foreign-identity', foreignPath, '--report', reportPath, '--confirm-isolated-native'] }
}
test('new runner requires fixed random instance, image approval, supplier instance binding, ordinary foreign identity and a never-used report', async t => {
  const f = await guardFixture(t); assert.equal((await inputs(f.args, f.local)).foreignAccount.owner, 7)
  assert.equal((await inputs([...f.args, '--validate-only'], f.local)).validateOnly, true)
  for (const extra of [['--resume-completed', 'old.json'], ['--login-only'], ['--lose-response'], ['--check-failed-refresh'], ['--scenario', 'image'], ['--validate-only', '--validate-only']]) await assert.rejects(inputs([...f.args, ...extra], f.local))
  await assert.rejects(inputs(f.args.filter(value => value !== '--confirm-isolated-native'), f.local))
  for (const change of [fixture => fixture.state.origin = 'http://127.0.0.1:8080', fixture => fixture.state.origin = 'http://127.0.0.1:53238', fixture => fixture.state.binarySha256 = 'bad',
    fixture => fixture.compose.services['studio-api'].environment.GOUO_ENABLE_IMAGE_JOBS = 'false', fixture => fixture.compose.services['fixture-provider'].environment.GOUO_ACCOUNT_INSTANCE_ID = asset,
    fixture => fixture.foreign.account.owner = fixture.identity.account.owner]) {
    const fixture = await guardFixture(t)
    change(fixture); await fixture.save(); await assert.rejects(inputs(fixture.args, fixture.local))
  }
  const fresh = await guardFixture(t); await writeFile(fresh.reportPath, '{}'); await assert.rejects(inputs(fresh.args, fresh.local))
})
test('actual proc stat format trims terminal newlines and preserves field 22 even when command contains spaces or parentheses', () => {
  const fields = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 4)), '739', '2097152', '456']
  for (const command of ['node', 'node worker', 'node (worker)']) for (const suffix of ['', '\n', '\r\n']) {
    assert.equal(processStartTicks('1 (' + command + ') ' + fields.join(' ') + suffix), '739')
  }
  assert.equal(processStartTicks('1 (node) ' + [...fields.slice(0, 19), '12345678901234567890'].join(' ') + '\n'), '12345678901234567890')
  for (const value of [undefined, '', '1 node S 739\n', '0 (node) ' + fields.join(' '), '1 (node) S 739\n',
    '1 (node) ' + [...fields.slice(0, 19), 'untrusted'].join(' ') + '\n', '1 (node) ' + fields.join(' ') + '\nextra-line']) assert.throws(() => processStartTicks(value), /start-time observation invalid/)
})
test('embedded live observations parse as modules and contain no business constructors or SQL writes', async () => {
  const source = await readFile(new URL('./browser-image-jobs-native.cases.mjs', import.meta.url), 'utf8')
  for (const name of ['nativeCode', 'studioCode']) {
    const expression = new RegExp('const ' + name + ' = ([^\\n]+)').exec(source)?.[1]
    assert.ok(expression)
    const code = runInNewContext(expression, { account: { owner: 11 }, processStartTicks })
    const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: code, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(/UPDATE |INSERT |DELETE |CREATE TABLE|new (?:Ledger|Trial|ImageJobs)|fetch\(/.test(code), false)
    assert.match(code, /readOnly:true/)
  }
})

async function supplier(t, options = {}) {
  const path = await mkdtemp(join(tmpdir(), 'gouo-n2-image-supplier-')), server = await createAcceptanceProvider({ directory: path, instanceId: key, controlTimeout: 1500, ...options })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(path, { recursive: true, force: true }) })
  const origin = 'http://127.0.0.1:' + server.address().port, controlPath = join(path, 'image-job-control.json')
  const control = async command => { await writeFile(controlPath + '.tmp', JSON.stringify({ version: 1, instanceId: key, images: { [tag]: { instanceId: key, command } } })); await rename(controlPath + '.tmp', controlPath) }
  const stats = async () => (await fetch(origin + '/stats')).json()
  const send = (prompt = tag + ' 本地验收受控图片 · 采购成本0') => fetch(origin + '/v1/images/generations', { method: 'POST', headers: { Authorization: 'Bearer fixture-provider-zero-procurement-cost', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'fixture-image', prompt }) })
  return { path, origin, controlPath, control, stats, send }
}
async function until(operation) { const deadline = Date.now() + 2000; while (Date.now() < deadline) { const value = await operation(); if (value) return value; await new Promise(done => setTimeout(done, 20)) } throw new Error('Fixture observation timed out') }
test('controlled image withholds real HTTP response until explicit continuation of that original request', async t => {
  const f = await supplier(t); await f.control('hold'); let resolved = false
  assert.deepEqual((await f.stats()).imageControl, { version: 1, instanceId: key })
  const original = f.send().then(value => { resolved = true; return value })
  original.catch(() => {})
  await until(async () => (await f.stats()).requests.some(row => row.outcome === 'waiting-image-control'))
  assert.equal(resolved, false); assert.equal((await f.stats()).image, 1); assert.equal((await f.stats()).chat, 0)
  await f.control('continue'); const response = await original; assert.equal(response.status, 200)
  const body = await response.json(), stats = await f.stats(), request = stats.requests[0]
  assert.equal(request.roleTag, tag); assert.equal(request.outcome, 'completed'); assert.equal(request.controlCommand, 'continue'); assert.equal(request.controlInstanceMatches, true)
  assert.equal(request.imageSha256, hash(Buffer.from(body.data[0].b64_json, 'base64'))); assert.equal(stats.image, 1); assert.equal(stats.chat, 0)
})
test('ordinary old image fixture stays immediate and does not consult opt-in image controls', async t => {
  const f = await supplier(t); const response = await f.send('T112-1234567890abcdef LOCAL ACCEPTANCE FIXTURE image; cost zero')
  assert.equal(response.status, 200); assert.equal((await f.stats()).requests[0].outcome, 'completed')
})
test('controlled image refuses missing process instance, wrong file/entry UUID and lose-response commands', async t => {
  for (const variant of ['missing-process-instance', 'wrong-file-instance', 'wrong-entry-instance', 'lose-response']) {
    const f = await supplier(t, variant === 'missing-process-instance' ? { instanceId: '' } : {})
    const control = { version: 1, instanceId: key, images: { [tag]: { instanceId: key, command: 'hold' } } }
    if (variant === 'wrong-file-instance') control.instanceId = asset
    if (variant === 'wrong-entry-instance') control.images[tag].instanceId = asset
    if (variant === 'lose-response') control.images[tag].command = 'lose-response'
    await writeFile(f.controlPath, JSON.stringify(control)); await assert.rejects(f.send())
    assert.equal((await f.stats()).requests[0].outcome, 'image-control-invalid'); assert.equal((await f.stats()).image, 1)
  }
})
test('controlled image timeout closes the one original response without producing success or extra calls', async t => {
  const f = await supplier(t, { controlTimeout: 70 }); await f.control('hold'); await assert.rejects(f.send())
  const stats = await f.stats(); assert.equal(stats.requests[0].outcome, 'image-control-timeout'); assert.equal(stats.image, 1); assert.equal(stats.chat, 0)
})
