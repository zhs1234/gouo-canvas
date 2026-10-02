// Opt-in, already prepared random Native acceptance stack only. No model calls.
// From v2: node tests/stack/owner-isolation-native.cases.mjs --state .local/.../state.json --fixtures .local/t111-fixtures.json --identities .local/t111-identities.json --report .local/t111-owner-native-report.json --confirm-isolated-native
import assert from 'node:assert/strict'
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { createHash, publicEncrypt, constants, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
const binarySha256 = 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529'
const local = resolve('.local'), args = process.argv.slice(2)
function option(name) { const index = args.indexOf(name); assert.ok(index >= 0 && args[index + 1], 'Required explicit file option missing'); return args[index + 1] }
function localPath(value) {
  const path = resolve(value), suffix = relative(local, path)
  assert.ok(suffix && !suffix.startsWith('..') && !isAbsolute(suffix), 'All input/output files must be inside this workspace .local')
  return path
}
async function json(path) { try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) } catch { throw new Error('Acceptance JSON file unavailable or malformed') } }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
assert.ok(args.includes('--confirm-isolated-native'), 'Explicit isolated Native confirmation required')
const statePath = localPath(option('--state')), fixturePath = localPath(option('--fixtures')), identityPath = localPath(option('--identities')), reportPath = localPath(option('--report'))
const state = await json(statePath), fixture = await json(fixturePath), identities = await json(identityPath)
let origin
try { origin = new URL(state.origin) } catch { throw new Error('Acceptance origin is invalid') }
assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && /^\d+$/.test(origin.port) && !['8080', '53238', '58438'].includes(origin.port) && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'Only a fresh loopback acceptance origin is allowed')
assert.ok(state.version === 1 && /^gouo-user-acceptance-\d+-[a-z\d]+$/.test(state.project) && state.sourceCommit === sourceCommit && state.binarySha256 === binarySha256 && state.stopped !== true && state.procurementCost === 0 && state.syntheticComplianceFixture === true, 'State must identify the fixed synthetic acceptance stack')
assert.equal(resolve(state.directory), resolve(statePath, '..'), 'State directory mismatch')
assert.equal(resolve(state.compose), resolve(state.directory, 'compose.json'), 'Compose must belong to the same random directory')
assert.equal(resolve(state.env), resolve(state.directory, 'empty.env'), 'Environment file must belong to the same random directory')
assert.equal(fixture.version, 1, 'Unsupported fixture version')
assert.equal(identities.version, 1, 'Unsupported synthetic identity manifest version')
assert.equal(fixture.origin, state.origin, 'Fixture origin mismatch')
assert.equal(localPath(fixture.stateFile.startsWith('v2/') ? fixture.stateFile.slice(3) : fixture.stateFile), statePath, 'Fixture instance mismatch')
for (const role of ['A', 'B']) {
  const account = fixture.accounts?.[role], identity = identities.accounts?.[role]
  assert.ok(account && identity && Number.isSafeInteger(account.owner) && account.owner >= 2 && identity.owner === account.owner && identity.username === account.username && /^t111[ab][a-f\d]+$/.test(identity.username) && typeof identity.password === 'string' && identity.password.length >= 8, 'Prepared synthetic ordinary identity mismatch')
  assert.ok(['threadId', 'runId', 'projectId', 'assetId'].every(field => uuid(account[field])) && typeof account.toolCallId === 'string' && account.toolCallId.length > 0 && Number.isInteger(account.artifactIndex) && account.artifactIndex >= 0 && Number.isInteger(account.projectRevision) && account.projectRevision >= 1, 'Prepared content metadata is incomplete')
  assert.equal(account.marker, 'T111-' + role, 'Explicit synthetic acceptance marker required')
}
assert.notEqual(fixture.accounts.A.owner, fixture.accounts.B.owner, 'Two distinct owners required')
assert.ok(/^[a-f\d]{64}$/.test(fixture.accounts.A.sha256) && /^[a-f\d]{64}$/.test(fixture.accounts.B.sha256) && fixture.accounts.A.sha256 !== fixture.accounts.B.sha256, 'Distinct prepared synthetic PNG hashes required')
const actualBinary = await new Promise((done, reject) => {
  const child = spawn(process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker', ['compose', '--env-file', state.env, '-p', state.project, '-f', state.compose, 'exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated Native checksum verification timed out')) }, 15_000)
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', () => {})
  child.on('error', () => { clearTimeout(timer); reject(new Error('Isolated Native checksum verification failed')) })
  child.on('exit', code => { clearTimeout(timer); code === 0 ? done(output.trim().split(/\s+/)[0]) : reject(new Error('Isolated Native checksum verification failed')) })
})
assert.equal(actualBinary, binarySha256, 'Actual running Native binary checksum mismatch')
let exists = false; try { await access(reportPath); exists = true } catch {}
assert.ok(!exists, 'An existing report prevents accidental rerun; use a fresh explicitly approved report path')
const report = { version: 1, state: 'started', origin: state.origin, project: state.project, sourceCommit, binarySha256, actualBinaryVerified: true, startedAt: new Date().toISOString(), requests: [], directions: [], expectedModelCalls: 0, procurementCost: 0, secretsExcluded: true, noRetry: true, deleteScope: 'DELETE routes are unsupported; 404 is route absence, not implemented owner authorization', readOnlyDatabaseProof: 'Root must compare complete pre/post Native and Studio snapshots separately' }
const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2))
await persist()
async function request(path, { token, method = 'GET', body, label, headers = {} } = {}) {
  let response
  try { response = await fetch(new URL(path, origin), { method, redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Origin: origin.origin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
  catch { report.requests.push({ label, method, path: path.split('?')[0], state: 'outcome-unavailable' }); await persist(); throw new Error('HTTP outcome unavailable; no retry performed') }
  report.requests.push({ label, method, path: path.split('?')[0], status: response.status }); await persist()
  if (response.status === 429) throw new Error('Native or Studio rate limit encountered; acceptance stopped without retry')
  let data; try { data = await response.json() } catch { throw new Error('HTTP response is not a valid JSON envelope; stopped without retry') }
  return { status: response.status, body: data }
}
function success(result) { assert.ok(result.status === 200 && result.body?.success === true && result.body.data, 'Required own-account operation did not succeed'); return result.body.data }
async function login(role) {
  const identity = identities.accounts[role]
  const key = success(await request('/api/user/login/encryption-key', { label: role + ':RSA-key' }))
  assert.ok(key.enabled === true && typeof key.public_key === 'string' && typeof key.kid === 'string', 'Native encrypted login contract mismatch')
  let encrypted; try { encrypted = publicEncrypt({ key: key.public_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(identity.password)).toString('base64') } catch { throw new Error('Native RSA encryption key is invalid') }
  const session = success(await request('/api/user/login', { method: 'POST', label: role + ':login', body: { username: identity.username, password_encrypted: encrypted, encryption_key_id: key.kid } }))
  assert.ok(session.user?.id === identity.owner && session.user.role === 1 && session.user.status === 1 && typeof session.access_token === 'string' && session.access_token.length > 0, 'Native login must return the expected enabled ordinary owner and a valid token')
  return session.access_token // Node memory only; never written or printed.
}
async function deny(token, path, method = 'GET', body, headers, label = method + ':foreign') {
  const result = await request(path, { token, method, body, headers, label })
  assert.ok(result.status === 404 && result.body?.success === false && result.body.data === undefined, 'Cross-owner request must return a data-free 404')
}
async function ownSnapshot(token, account, role) {
  const values = {}
  for (const [kind, id] of Object.entries({ threads: account.threadId, runs: account.runId, projects: account.projectId, assets: account.assetId })) values[kind] = success(await request('/api/studio/' + kind + '/' + id, { token, label: role + ':own-' + kind }))
  assert.ok(values.projects.revision === account.projectRevision && values.assets.id === account.assetId, 'Prepared own content differs from manifest')
  return values
}
try {
  const tokens = { A: await login('A'), B: await login('B') }
  const before = {}
  for (const role of ['A', 'B']) before[role] = await ownSnapshot(tokens[role], fixture.accounts[role], role)
  for (const [role, other] of [['A', 'B'], ['B', 'A']]) {
    const token = tokens[role], foreign = fixture.accounts[other], own = fixture.accounts[role], document = before[role].projects.document
    for (const [kind, id] of Object.entries({ threads: foreign.threadId, runs: foreign.runId, projects: foreign.projectId, assets: foreign.assetId })) await deny(token, '/api/studio/' + kind + '/' + id, 'GET', undefined, undefined, role + ':foreign-' + kind)
    await deny(token, '/api/studio/projects/' + foreign.projectId, 'PATCH', { expectedRevision: foreign.projectRevision, title: 'T111 forbidden foreign patch' }, undefined, role + ':foreign-project-patch')
    const unsupported = await request('/api/studio/projects/' + foreign.projectId, { token, method: 'DELETE', label: role + ':unsupported-delete' })
    assert.ok(unsupported.status === 404 && unsupported.body?.data === undefined, 'Unsupported DELETE route must not return private data')
    for (let attempt = 1; attempt <= 2; attempt++) {
      await deny(token, '/api/studio/assets/from-run', 'POST', { runId: foreign.runId, toolCallId: foreign.toolCallId, artifactIndex: foreign.artifactIndex }, undefined, role + ':foreign-from-run-' + attempt)
      await deny(token, '/api/studio/projects/from-asset', 'POST', { assetId: foreign.assetId, title: 'T111 forbidden foreign asset' }, undefined, role + ':foreign-from-asset-' + attempt)
    }
    for (const variant of ['file', 'element', 'customData']) {
      const edited = structuredClone(document)
      if (variant === 'file') edited.files['t111-foreign-reference'] = { assetId: foreign.assetId }
      else edited.elements.push({ id: 't111-foreign-reference', type: 'rectangle', ...(variant === 'element' ? { assetId: foreign.assetId } : { customData: { assetId: foreign.assetId } }) })
      await deny(token, '/api/studio/projects/' + own.projectId, 'PATCH', { expectedRevision: own.projectRevision, document: edited }, undefined, role + ':own-project-foreign-' + variant)
    }
    const runId = randomUUID()
    await deny(token, '/api/studio/runs', 'POST', { threadId: foreign.threadId, runId, sessionId: runId, conversationId: foreign.threadId, prompt: 'T111 cross-owner rejection only; do not generate' }, { 'Idempotency-Key': runId }, role + ':foreign-thread-run')
    const asset = success(await request('/api/studio/assets/from-run', { token, method: 'POST', label: role + ':own-existing-asset', body: { runId: own.runId, toolCallId: own.toolCallId, artifactIndex: own.artifactIndex } }))
    assert.ok(asset.id === own.assetId, 'Own materialization must return the existing asset')
    const project = success(await request('/api/studio/projects/from-asset', { token, method: 'POST', label: role + ':own-existing-project', body: { assetId: own.assetId } }))
    assert.ok(project.id === own.projectId && project.revision === own.projectRevision, 'Own existing project must remain idempotent')
    report.directions.push({ from: role, to: other, owner: own.owner, foreignOwner: foreign.owner, state: 'passed', unsupportedDeleteCount: 1, rejectedGenerationRequestId: runId })
    await persist()
  }
  for (const role of ['A', 'B']) {
    const after = await ownSnapshot(tokens[role], fixture.accounts[role], role)
    assert.ok(hash(after) === hash(before[role]), 'Own thread/run/project/asset DTOs must remain byte-equivalent after all rejection probes')
    report.directions.find(value => value.from === role).ownDtoHashUnchanged = true
  }
  report.state = 'passed'; report.completedAt = new Date().toISOString(); await persist()
  console.log(JSON.stringify({ report: reportPath, state: report.state, requests: report.requests.length, directions: report.directions.length, expectedModelCalls: 0, procurementCost: 0 }))
} catch (error) {
  report.state = report.requests.some(value => value.status === 429) ? 'blocked-rate-limit' : 'failed'
  report.reason = error instanceof assert.AssertionError ? 'Owner-isolation contract assertion failed; no retries or subsequent probes' : ['HTTP outcome unavailable; no retry performed', 'HTTP response is not a valid JSON envelope; stopped without retry', 'Native or Studio rate limit encountered; acceptance stopped without retry'].includes(error.message) ? error.message : 'Acceptance failed; diagnostic excludes private responses and credentials'
  await persist(); console.error(JSON.stringify({ report: reportPath, state: report.state, reason: report.reason })); process.exitCode = 1
}
