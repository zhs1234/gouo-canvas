// Local HTTP supplier and file-scope tests only. No Native, Docker or browser.
// Explicit: node --test tests/stack/browser-offline-fixture.cases.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createAcceptanceProvider } from './user-acceptance-environment-provider.mjs'
import { validateOfflineInputs, validateCompletedResume, rateLimitDiagnostic, sourceCommit, binarySha256, loginDiagnostic, failureDiagnostic, selfDiagnostic, createStreamEvidence } from './browser-offline-native.cases.mjs'

test('login and locator diagnostics exclude passwords, auth values and raw logs', () => {
  const secret = 'Synthetic_sensitive_value_must_not_persist'
  const login = loginDiagnostic(200, { success: true, data: { user: { id: 3, role: 1, status: 1 }, access_token: secret, session: { sid: secret } }, message: secret }, { password: secret, password_encrypted: secret })
  assert.deepEqual(login.user, { id: 3, role: 1, status: 1 }); assert.equal(login.authBundlePresent, true)
  assert.equal(login.plaintextPasswordFieldPresent, true); assert.equal(JSON.stringify(login).includes(secret), false)
  const error = new Error(`locator.fill: Timeout 15000ms exceeded.\nCall log:\nfill "${secret}"`)
  assert.deepEqual(failureDiagnostic(error, 'Synthetic login check'), { errorType: 'Error', classification: 'locator-timeout', knownResourceUnavailableMessage: false, failedCheck: 'Synthetic login check', operation: 'locator.fill', timeoutMilliseconds: 15000, rawMessageAndLocatorLogExcluded: true })
  assert.equal(JSON.stringify(failureDiagnostic(error)).includes(secret), false)
  const lost = failureDiagnostic(new Error(`Protocol error (Network.getResponseBody): No resource with given identifier; ${secret}`))
  assert.equal(lost.classification, 'response-body-unavailable'); assert.equal(lost.knownResourceUnavailableMessage, true)
  assert.equal(JSON.stringify(lost).includes(secret), false)
  const self = selfDiagnostic(200, { success: true, data: { id: 3, role: 1, status: 1, setting: secret, access_token: secret } }, true)
  assert.deepEqual(self, { httpStatus: 200, success: true, user: { id: 3, role: 1, status: 1 }, bearerPresent: true })
  assert.equal(JSON.stringify(self).includes(secret), false)
})
test('split UTF-8 stream evidence records types and first-delta timings without raw content', () => {
  const tag = 'T112-1234567890abcdef', secret = 'sensitive raw content excluded', observer = createStreamEvidence(tag)
  const event = { type: 'message.delta', runId: '11111111-1111-4111-8111-111111111111', delta: `【${tag} 本地验收受控慢流前半段】${secret}` }
  const bytes = Buffer.from(`data: ${JSON.stringify(event)}\r\n\r\n`)
  for (const byte of bytes) observer.receive(Buffer.from([byte]).toString('base64'))
  assert.equal(observer.evidence.events[0].frontMarker, true); assert.equal(observer.evidence.frameCount, 1)
  assert.equal(Number.isFinite(observer.evidence.firstDeltaAfterSendMilliseconds), true)
  assert.equal(JSON.stringify(observer.evidence).includes(secret), false)
  assert.equal(JSON.stringify(observer.evidence).includes(event.delta), false)
})
test('429 evidence records only safe Retry-After guidance and never automatically retries', () => {
  const secret = 'Excluded_secret_header_value', at = Date.parse('2026-10-02T00:00:00Z')
  const seconds = rateLimitDiagnostic('POST', '/api/user/auth/refresh', { 'retry-after': '1200', authorization: secret }, at)
  assert.equal(seconds.retryAfterSeconds, 1200); assert.equal(seconds.automaticRetry, false)
  assert.equal(seconds.observedAt, '2026-10-02T00:00:00.000Z'); assert.equal(seconds.path, '/api/user/auth/refresh')
  assert.equal(rateLimitDiagnostic('GET', '/api/status', { 'retry-after': 'Fri, 02 Oct 2026 00:20:00 GMT' }, at).retryAfterDate, '2026-10-02T00:20:00.000Z')
  const excluded = rateLimitDiagnostic(secret, '/api/login?token=' + secret, { 'retry-after': secret, cookie: secret }, at)
  assert.equal(excluded.retryAfterPresent, true); assert.equal(excluded.retryAfterSeconds, null); assert.equal(excluded.retryAfterDate, null)
  assert.equal(JSON.stringify([seconds, excluded]).includes(secret), false)
  assert.equal(rateLimitDiagnostic('GET', '/api/status', {}, at).retryAfterPresent, false)
})

async function directory(t, prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}
async function guardFixture(t) {
  const local = await directory(t, 'gouo-t112-guards-'), random = join(local, 'user-acceptance-new')
  await mkdir(random); await mkdir(join(random, 'control'))
  const statePath = join(random, 'state.json'), identityPath = join(local, 'identity.json'), reportPath = join(local, 'report.json')
  const state = { version: 1, project: 'gouo-user-acceptance-123-t112', directory: random, compose: join(random, 'compose.json'), env: join(random, 'empty.env'),
    origin: 'http://127.0.0.1:45678', sourceCommit, binarySha256, instanceId: '11111111-1111-4111-8111-111111111111', procurementCost: 0, syntheticComplianceFixture: true, provider: 'explicit local acceptance fixture' }
  const identity = { version: 1, origin: state.origin, stateFile: statePath, fixtureOnly: true, account: { owner: 2, username: 't112a12345678', password: 'Synthetic_fixture_only_2026!', threadId: '22222222-2222-4222-8222-222222222222' } }
  const compose = { services: { 'new-api': { image: 'gouo-v2-new-api:latest' }, 'studio-api': { environment: { GOUO_BACKEND_DEV_TARGET: 'http://new-api:3000', GOUO_GATEWAY_BASE_URL: 'http://new-api:3000/v1', GOUO_ACCOUNT_INSTANCE_ID: state.instanceId } }, 'fixture-provider': { entrypoint: ['node', '/app/tests/stack/user-acceptance-environment-provider.mjs'], volumes: [{ source: join(random, 'control'), target: '/fixture', read_only: false }] } }, volumes: { 'native-data': {}, 'studio-data': {} } }
  const args = ['--state', statePath, '--identity', identityPath, '--report', reportPath, '--scenario', 'text', '--confirm-isolated-native']
  const save = async () => { await writeFile(statePath, JSON.stringify(state)); await writeFile(identityPath, JSON.stringify(identity)); await writeFile(state.compose, JSON.stringify(compose)); await writeFile(state.env, '') }
  await save(); return { local, args, state, identity, compose, save, reportPath, identityPath }
}
function completedReport(f) {
  const runId = '33333333-3333-4333-8333-333333333333', tag = 'T112-1234567890abcdef'
  const partial = { runId, threadId: f.identity.account.threadId, status: 'running', front: true, back: false }
  const saved = { ...partial, status: 'completed', back: true, textHash: 'a'.repeat(64), images: [], usage: { state: 'recorded', settlementState: 'unconfirmed', requestIds: ['synthetic-native-request'] } }
  const provider = { chat: 1, image: 0, requests: [{ roleTag: tag, kind: 'chat', outcome: 'waiting-control' }] }
  return { version: 1, state: 'blocked-rate-limit', rateLimited: true, stage: 'online-get-recovery', origin: f.state.origin, project: f.state.project,
    sourceCommit, binarySha256, instanceId: f.state.instanceId, owner: f.identity.account.owner, scenario: 'text', tag, runId,
    realPaidProviderCalls: 0, procurementCost: 0, noModelRetry: true, evidence: { P: 'not executed' },
    selfDiagnostic: { httpStatus: 200, success: true, user: { id: f.identity.account.owner, role: 1, status: 1 }, bearerPresent: true },
    offline: { navigatorOnline: false, disconnectedRequest: { path: '/api/studio/runs/stream', error: 'net::ERR_ABORTED' } },
    browserRequests: [{ path: '/api/studio/runs/stream', method: 'POST', runId, threadId: f.identity.account.threadId, sameKey: true }],
    snapshots: [
      { stage: 'prepared-before-send', native: { logs: [] }, provider: { chat: 0, image: 0 } },
      { stage: 'accepted-before-offline', studio: { runs: [partial] }, provider },
      { stage: 'offline-provider-held', provider: structuredClone(provider) },
      { stage: 'backend-terminal-before-recovery', native: { account: { id: f.identity.account.owner, role: 1, status: 1 }, logs: [{ id: 1, type: 2, request_id: 'synthetic-native-request' }] },
        studio: { thread: { id: f.identity.account.threadId, owner: f.identity.account.owner }, runs: [saved], reservations: [{ key: runId, status: 'used' }] },
        provider: { ...provider, requests: [{ ...provider.requests[0], outcome: 'completed' }] } },
    ] }
}

test('read-only resume binds an unchanged blocked report to the original ordinary identity and explicitly segmented evidence', async t => {
  const f = await guardFixture(t), source = completedReport(f), sourcePath = join(f.local, 'blocked-original.json')
  const originalBytes = JSON.stringify(source); await writeFile(sourcePath, originalBytes)
  const input = await validateOfflineInputs([...f.args, '--resume-completed', sourcePath], f.local)
  assert.equal(input.resume.runId, source.runId); assert.equal(input.resume.tag, source.tag)
  assert.equal(input.resume.sourceSha256, createHash('sha256').update(originalBytes).digest('hex'))
  assert.equal(input.resume.proof.continuousEndToEndPassed, false); assert.equal(input.resume.proof.originalBrowserProfileRetained, false)
  assert.equal(await readFile(sourcePath, 'utf8'), originalBytes)
  await assert.rejects(readFile(f.reportPath), { code: 'ENOENT' })
})

test('resume refuses different owner/instance/thread, incomplete evidence, model replay, held usage and unproved PNG', async t => {
  const f = await guardFixture(t)
  const mutations = [
    source => { source.owner++ }, source => { source.instanceId = '44444444-4444-4444-8444-444444444444' },
    source => { source.browserRequests[0].threadId = '44444444-4444-4444-8444-444444444444' },
    source => { source.offline.disconnectedRequest = null }, source => { source.selfDiagnostic.user.role = 10 },
    source => { source.browserRequests.push(source.browserRequests[0]) },
    source => { source.snapshots.at(-1).studio.runs[0].status = 'unknown' },
    source => { source.snapshots.at(-1).studio.reservations[0].status = 'held' },
    source => { source.snapshots.at(-1).native.logs = [] }, source => { source.snapshots.splice(2, 1) },
    source => { source.snapshots.at(-1).provider.chat++ },
    source => { source.snapshots.at(-1).studio.runs[0].images.push({ sha256: 'b'.repeat(64) }) },
  ]
  for (const mutate of mutations) { const source = completedReport(f); mutate(source); assert.throws(() => validateCompletedResume(source, f.state, f.identity.account, 'text')) }
})
test('image resume requires the original PNG and every bounded Native/tool consumption record', async t => {
  const f = await guardFixture(t), source = completedReport(f), terminal = source.snapshots.at(-1)
  source.scenario = 'image'; source.stage = 'full-reload-cookie-recovery'; source.originalPngSha256 = 'b'.repeat(64)
  for (const snapshot of source.snapshots.slice(1)) {
    snapshot.provider.chat = 2; snapshot.provider.image = 1
    snapshot.provider.requests = [
      { roleTag: source.tag, kind: 'chat', outcome: 'completed' }, { roleTag: source.tag, kind: 'image', outcome: 'completed' },
      { roleTag: source.tag, kind: 'chat', outcome: snapshot === terminal ? 'completed' : 'waiting-control' },
    ]
  }
  terminal.studio.runs[0].images = [{ sha256: source.originalPngSha256 }]
  terminal.studio.runs[0].usage.requestIds = ['native-planning', 'native-image', 'native-summary']
  terminal.native.logs = terminal.studio.runs[0].usage.requestIds.map((request_id, index) => ({ id: index + 1, type: 2, request_id }))
  terminal.studio.reservations.push({ key: source.runId, status: 'used' })
  assert.equal(validateCompletedResume(source, f.state, f.identity.account, 'image').originalPngSha256, source.originalPngSha256)
  source.originalPngSha256 = 'c'.repeat(64)
  assert.throws(() => validateCompletedResume(source, f.state, f.identity.account, 'image'), /PNG/)
})

test('resume rejects out-of-scope reports and flags that could mix a new offline/send scenario into read-only recovery', async t => {
  const f = await guardFixture(t), path = join(f.local, 'blocked-original.json'), outside = await directory(t, 'gouo-t112-outside-report-')
  await writeFile(path, JSON.stringify(completedReport(f))); const args = [...f.args, '--resume-completed', path]
  for (const option of ['--login-only', '--check-failed-refresh']) await assert.rejects(validateOfflineInputs([...args, option], f.local), /Read-only resume/)
  const external = join(outside, 'blocked-original.json'); await writeFile(external, JSON.stringify(completedReport(f)))
  await assert.rejects(validateOfflineInputs([...f.args, '--resume-completed', external], f.local), /workspace .local/)
  const invalid = completedReport(f); invalid.state = 'failed'; await writeFile(path, JSON.stringify(invalid))
  await assert.rejects(validateOfflineInputs(args, f.local), /rate-limited original case/)
})
test('valid synthetic manifest scope needs no Native, HTTP or browser', async t => {
  const f = await guardFixture(t), input = await validateOfflineInputs(f.args, f.local)
  assert.equal(input.account.owner, 2); assert.equal(input.scenario, 'text')
  await assert.rejects(readFile(f.reportPath), { code: 'ENOENT' })
})
for (const port of [8080, 53238, 58438]) test(`reject daily/old QA origin ${port} before live operations`, async t => {
  const f = await guardFixture(t); f.state.origin = f.identity.origin = 'http://127.0.0.1:' + port; await f.save()
  await assert.rejects(validateOfflineInputs(f.args, f.local), /fresh loopback/)
})
test('reject missing isolated confirmation, duplicate options and real account identity', async t => {
  const f = await guardFixture(t)
  await assert.rejects(validateOfflineInputs(f.args.slice(0, -1), f.local), /confirmation/)
  await assert.rejects(validateOfflineInputs([...f.args, '--scenario', 'image'], f.local), /repeated/)
  f.identity.account.owner = 1; await f.save(); await assert.rejects(validateOfflineInputs(f.args, f.local), /ordinary/)
  f.identity.account.owner = 2; f.identity.account.username = 'normal-customer'; await f.save(); await assert.rejects(validateOfflineInputs(f.args, f.local), /ordinary/)
})
test('reject existing report and nonempty operator environment', async t => {
  const f = await guardFixture(t)
  await writeFile(f.reportPath, '{}'); await assert.rejects(validateOfflineInputs(f.args, f.local), /Existing report/); await rm(f.reportPath)
  await writeFile(f.state.env, 'SECRET=operator-file\n'); await assert.rejects(validateOfflineInputs(f.args, f.local), /Operator environment/)
})
test('reject nonfixture topology, host provider publication and external data volume', async t => {
  const f = await guardFixture(t)
  f.compose.services['studio-api'].environment.GOUO_GATEWAY_BASE_URL = 'https://external-provider.invalid/v1'; await f.save()
  await assert.rejects(validateOfflineInputs(f.args, f.local), /local fixture topology/)
  f.compose.services['studio-api'].environment.GOUO_GATEWAY_BASE_URL = 'http://new-api:3000/v1'; f.compose.services['fixture-provider'].ports = ['19000:19000']; await f.save()
  await assert.rejects(validateOfflineInputs(f.args, f.local), /publish host ports/)
  delete f.compose.services['fixture-provider'].ports; f.compose.volumes['native-data'] = { external: true }; await f.save()
  await assert.rejects(validateOfflineInputs(f.args, f.local), /External/)
})
test('reject input outside .local and changed Native identity', async t => {
  const f = await guardFixture(t), external = await directory(t, 'gouo-t112-outside-'), outsideIdentity = join(external, 'identity.json')
  await writeFile(outsideIdentity, JSON.stringify(f.identity)); const args = [...f.args]; args[args.indexOf('--identity') + 1] = outsideIdentity
  await assert.rejects(validateOfflineInputs(args, f.local), /workspace .local/)
  f.state.binarySha256 = '0'.repeat(64); await f.save(); await assert.rejects(validateOfflineInputs(f.args, f.local), /Fixed/)
})

async function provider(t, controlTimeout = 2500) {
  const path = await directory(t, 'gouo-t112-provider-'), server = await createAcceptanceProvider({ directory: path, controlTimeout })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); return new Promise(done => server.close(done)) })
  const origin = 'http://127.0.0.1:' + server.address().port, tag = 'T112-1234567890abcdef'
  const command = value => writeFile(join(path, 'offline-control.json'), JSON.stringify({ version: 1, streams: { [tag]: { command: value } } }))
  const stats = async () => JSON.parse(await readFile(join(path, 'provider-stats.json'), 'utf8'))
  const post = (endpoint, data, auth = true) => fetch(origin + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer fixture-provider-zero-procurement-cost' } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) })
  const chat = (extra = []) => post('/v1/chat/completions', { stream: true, messages: [{ role: 'user', content: tag + ' 本地验收受控慢流 本地验收生图' }, ...extra] })
  return { path, origin, tag, command, stats, post, chat }
}
async function readTo(reader, marker) {
  let text = ''; while (!text.includes(marker)) { const chunk = await reader.read(); assert.equal(chunk.done, false); text += new TextDecoder().decode(chunk.value) }
  return text
}
async function remainder(reader) { let text = ''; while (true) { const chunk = await reader.read(); if (chunk.done) return text; text += new TextDecoder().decode(chunk.value) } }
test('controlled stream remains accepted and paused until explicit continue; completion adds no call', async t => {
  const f = await provider(t); await f.command('hold')
  const response = await f.chat([{ role: 'tool', content: 'explicit tool result' }]), reader = response.body.getReader()
  let initial = await readTo(reader, '前半段')
  const frames = () => initial.split('\n\n').filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)))
  while (frames().length < 3) { const chunk = await reader.read(); assert.equal(chunk.done, false); initial += new TextDecoder().decode(chunk.value) }
  assert.ok(!initial.includes('[DONE]')); assert.deepEqual(frames()[2].choices[0].delta, {}); assert.equal(frames()[2].choices[0].finish_reason, null)
  await new Promise(done => setTimeout(done, 150)); const before = await f.stats()
  assert.equal(before.chat, 1); assert.equal(before.requests[0].outcome, 'waiting-control'); assert.equal(before.requests[0].imageCompletedBeforePause, true)
  assert.equal(before.requests[0].prePauseDataFrames, 3)
  await f.command('continue'); const final = await remainder(reader)
  assert.ok(final.includes('后半段') && final.includes('[DONE]')); const after = await f.stats()
  assert.equal(after.chat, 1); assert.equal(after.requests[0].outcome, 'completed')
})
test('explicit lose-response preserves accepted count and records ambiguous response', async t => {
  const f = await provider(t); await f.command('hold')
  const response = await f.chat([{ role: 'tool', content: 'explicit tool result' }]), reader = response.body.getReader()
  await readTo(reader, '前半段'); await f.command('lose-response'); await assert.rejects(remainder(reader))
  const stats = await f.stats(); assert.equal(stats.chat, 1); assert.equal(stats.ambiguous, 1); assert.equal(stats.requests[0].outcome, 'response-lost')
})
test('image hash records original PNG bytes; tool planning precedes controlled summary pause', async t => {
  const f = await provider(t); await f.command('hold')
  const planning = await (await f.chat()).text(); assert.ok(planning.includes('tool_calls')); assert.ok(!planning.includes('前半段'))
  const image = await (await f.post('/v1/images/generations', { prompt: f.tag + ' LOCAL ACCEPTANCE FIXTURE' })).json()
  const hash = createHash('sha256').update(Buffer.from(image.data[0].b64_json, 'base64')).digest('hex')
  const response = await f.chat([{ role: 'tool', content: 'image complete' }]), reader = response.body.getReader(); await readTo(reader, '前半段')
  const before = await f.stats(); assert.equal(before.chat, 2); assert.equal(before.image, 1); assert.equal(before.requests.find(row => row.kind === 'image').imageSha256, hash)
  await f.command('continue'); await remainder(reader)
  assert.equal((await f.stats()).requests.at(-1).outcome, 'completed')
})
test('unauthorized local requests and missing/expired control never continue silently', async t => {
  const f = await provider(t, 150)
  assert.equal((await f.post('/v1/chat/completions', {}, false)).status, 401); assert.equal((await f.stats()).chat, 0)
  await assert.rejects(async () => (await f.chat([{ role: 'tool', content: 'explicit tool result' }])).text())
  assert.equal((await f.stats()).requests[0].outcome, 'control-invalid')
  await f.command('hold'); const timed = await f.chat([{ role: 'tool', content: 'explicit tool result' }]); await assert.rejects(timed.text())
  assert.equal((await f.stats()).requests.at(-1).outcome, 'control-timeout'); assert.equal((await f.stats()).chat, 2)
})
