// Opt-in fixed Native + synthetic ordinary accounts + local supplier only.
// node tests/stack/image-jobs-native.cases.mjs --state ... --identity ...
// --foreign-identity ... --report ... --confirm-isolated-native
// No setup, provider mutation, retries, Native restart, balance edits or cleanup.
import assert from 'node:assert/strict'
import { readFile, writeFile, realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { publicEncrypt, constants, randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { validateOfflineInputs, sourceCommit, binarySha256, loginDiagnostic, selfDiagnostic, rateLimitDiagnostic } from './browser-offline-native.cases.mjs'

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const uuid = value => /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value ?? '')
export function jobSummary(data) {
  assert.ok(data && data.kind === 'image' && uuid(data.jobId) && data.requestId === data.jobId)
  assert.ok(['accepted', 'ready', 'submission_started', 'output_received', 'output_saved', 'needs_authorization', 'unknown', 'completed', 'cancelled_before_submission'].includes(data.status))
  assert.ok(data.assetId === undefined || uuid(data.assetId))
  const summary = { jobId: data.jobId, status: data.status, assetId: data.assetId ?? null }
  if (data.status === 'completed') {
    assert.ok(data.result?.url && uuid(data.assetId))
    assert.match(data.result.url, /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    const bytes = Buffer.from(data.result.url.split(',')[1], 'base64')
    assert.ok(bytes.length && bytes.length <= 30 * 1024 * 1024)
    assert.ok(Number.isSafeInteger(data.result.width) && data.result.width > 0 && Number.isSafeInteger(data.result.height) && data.result.height > 0 && data.result.width * data.result.height <= 24000000)
    const usage = data.result.usage
    assert.ok(usage && ['pending', 'recorded'].includes(usage.state) && usage.settlementState === 'unconfirmed')
    summary.imageSha256 = hash(bytes)
    summary.width = data.result.width
    summary.height = data.result.height
    assert.ok(Array.isArray(usage.requestIds) && usage.requestIds.length <= 100 && usage.requestIds.every(id => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)))
    summary.usage = { state: usage.state, settlementState: usage.settlementState, requestIds: usage.requestIds }
  } else assert.equal(data.result, undefined)
  return summary
}
export function validateOriginalJob(before, completed) {
  assert.equal(before.studio.requests.length, 0, 'Fresh synthetic owner must have zero original requests')
  assert.equal(completed.studio.jobs.length, 1)
  const job = completed.studio.jobs[0]
  assert.equal(job.status, 'completed')
  assert.equal(job.native_pending, 0)
  assert.equal(completed.studio.submissions.length, 1)
  assert.equal(completed.studio.submissions[0].model_kind, 'image')
  assert.equal(completed.provider.image, before.provider.image + 1)
  assert.equal(completed.provider.chat, before.provider.chat)
  assert.equal(completed.studio.stagingCount, 0)
  assert.equal(completed.studio.assets.length, 1)
  assert.equal(completed.studio.assets[0].run_id, job.key)
  assert.equal(completed.studio.assets[0].id, job.asset_id)
  assert.equal(completed.studio.assets[0].bytesSha256, completed.studio.assets[0].sha256)
}
export function validateReadOnly(before, after) {
  assert.equal(after.native.protectedHash, before.native.protectedHash, 'Native funding/usage rows changed during recovery')
  assert.equal(after.studio.dataHash, before.studio.dataHash, 'Studio rows changed during recovery')
  assert.equal(hash(after.provider), hash(before.provider), 'Supplier received additional model traffic')
}
export function validateResume(source, original) {
  assert.equal(source.state, 'failed')
  assert.equal(source.owner, original.account.owner)
  assert.equal(source.origin, original.state.origin)
  assert.equal(source.project, original.state.project)
  assert.equal(source.instanceId, original.state.instanceId)
  assert.equal(source.sourceCommit, sourceCommit); assert.equal(source.binarySha256, binarySha256)
  assert.equal(source.realPaidProviderCalls, 0); assert.equal(source.procurementCost, 0)
  assert.ok(uuid(source.jobId) && source.accepted?.jobId === source.jobId && source.accepted.status === 'accepted')
  assert.equal(source.requests.filter(row => row.method === 'POST' && row.path === '/api/studio/image-jobs').length, 1)
  const before = source.snapshots.find(row => row.stage === 'before-generation')
  const terminal = source.snapshots.find(row => row.stage === 'failure-readonly-observation')
  assert.ok(before && terminal)
  validateOriginalJob(before, terminal)
  assert.equal(terminal.studio.jobs[0].key, source.jobId)
  return { key: source.jobId, before, terminal }
}
export async function inputs(args, localRoot) {
  const foreignIndex = args.indexOf('--foreign-identity')
  assert.ok(foreignIndex >= 0 && args.lastIndexOf('--foreign-identity') === foreignIndex, 'One explicit foreign ordinary identity is required')
  const foreignPath = args[foreignIndex + 1]
  assert.ok(foreignPath && !foreignPath.startsWith('--'))
  let common = args.filter((_, index) => index !== foreignIndex && index !== foreignIndex + 1)
  const resumeIndex = common.indexOf('--resume-completed'), resumePath = resumeIndex >= 0 ? common[resumeIndex + 1] : null
  if (resumePath) { assert.equal(common.lastIndexOf('--resume-completed'), resumeIndex); common = common.filter((_, index) => index !== resumeIndex && index !== resumeIndex + 1) }
  const original = await validateOfflineInputs([...common, '--scenario', 'image'], localRoot)
  assert.ok(!original.validateOnly && !original.loginOnly && !original.resume && !original.loseResponse && !original.failedRefresh, 'Only the image-job scenario is supported')
  const identityIndex = common.indexOf('--identity'), foreignArgs = [...common]
  foreignArgs[identityIndex + 1] = foreignPath
  const foreign = await validateOfflineInputs([...foreignArgs, '--scenario', 'image'], localRoot)
  assert.notEqual(foreign.account.owner, original.account.owner)
  let resume
  if (resumePath) {
    const sourcePath = await realpath(resolve(resumePath)), local = await realpath(localRoot ?? resolve('.local'))
    const suffix = relative(local, sourcePath)
    assert.ok(suffix && !suffix.startsWith('..') && !isAbsolute(suffix), 'Resume source must stay in this private .local')
    assert.ok(![original.reportPath, original.statePath, await realpath(resolve(common[identityIndex + 1])), await realpath(resolve(foreignPath))].includes(sourcePath))
    const metadata = await stat(sourcePath); assert.ok(metadata.isFile() && metadata.size <= 16 * 1024 * 1024)
    const bytes = await readFile(sourcePath)
    resume = { ...validateResume(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), original), sourcePath, sourceSha256: hash(bytes) }
  }
  return { ...original, foreignAccount: foreign.account, resume }
}
async function run(input) {
  const { state, account, foreignAccount, reportPath, controlDirectory, resume } = input
  const report = { version: 1, state: 'started', origin: state.origin, project: state.project, instanceId: state.instanceId,
    sourceCommit, binarySha256, owner: account.owner, foreignOwner: foreignAccount.owner,
    evidence: { F: 'explicit local supplier', N: 'fixed real Native, synthetic ordinary accounts/funds', P: 'not executed' },
    realPaidProviderCalls: 0, procurementCost: 0, secretsExcluded: true, noModelRetry: true,
    startedAt: new Date().toISOString(), requests: [], snapshots: [], assertions: [] }
  if (resume) report.resumption = { sourceReport: resume.sourcePath, sourceReportSha256: resume.sourceSha256, continuousEndToEndPassed: false, noNewModelSubmission: true }
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  function docker(service, code, binary = false) {
    return new Promise((done, reject) => {
      const args = ['compose', '--env-file', state.env, '-p', state.project, '-f', state.compose, 'exec', '-T', service,
        ...(binary ? ['sha256sum', '/usr/local/bin/new-api'] : ['node', '--input-type=module', '-e', code])]
      const child = spawn(process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Read-only fixture Docker operation timed out')) }, 15000)
      child.stdout.on('data', chunk => output += chunk)
      child.on('error', () => { clearTimeout(timer); reject(new Error('Read-only fixture Docker operation failed')) })
      child.on('exit', code => { clearTimeout(timer); code === 0 ? done(output.trim()) : reject(new Error('Read-only fixture Docker operation failed')) })
    })
  }
  const nativeCode = [
    "import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';const db=new DatabaseSync('/data/new-api.db',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');",
    "const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');const owner=" + account.owner + ";",
    "const tables=['tokens','user_subscriptions','subscription_pre_consume_records','logs'];",
    "const protectedHash=hash([tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]),db.prepare('SELECT id,quota,used_quota,request_count,status FROM users ORDER BY id').all()]);",
    "console.log(JSON.stringify({protectedHash,account:db.prepare('SELECT id,username,role,status FROM users WHERE id=?').get(owner),",
    "channels:db.prepare('SELECT type,status,base_url,key FROM channels').all().map(c=>({localOnly:c.type===1&&c.status===1&&c.base_url==='http://fixture-provider:19000'&&c.key==='fixture-provider-zero-procurement-cost'})),",
    "logs:db.prepare('SELECT id,user_id,type,quota,request_id FROM logs WHERE user_id=? AND type=2 ORDER BY id').all(owner)}));db.close()"
  ].join('')
  const studioCode = [
    "import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');const owner=" + account.owner + ";",
    "const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)||v instanceof Uint8Array?v:JSON.stringify(v)).digest('hex');",
    "const tables=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all().map(r=>r.name);",
    "const dataHash=hash(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));",
    "console.log(JSON.stringify({dataHash,requests:db.prepare('SELECT kind,key,status FROM requests WHERE owner=? ORDER BY rowid').all(owner),",
    "jobs:db.prepare('SELECT key,status,native_pending,asset_id FROM image_jobs WHERE owner=? ORDER BY rowid').all(owner),",
    "submissions:db.prepare('SELECT key,attempt,model_kind,funding_source FROM model_submissions WHERE owner=? ORDER BY rowid').all(owner),",
    "stagingCount:db.prepare('SELECT COUNT(*) AS n FROM image_job_staging WHERE owner=?').get(owner).n,",
    "assets:db.prepare('SELECT id,run_id,sha256,bytes FROM studio_assets WHERE owner=? ORDER BY rowid').all(owner).map(a=>({id:a.id,run_id:a.run_id,sha256:a.sha256,bytesSha256:hash(a.bytes)})),",
    "reservations:db.prepare('SELECT request_kind,key,benefit,status FROM trial_reservations WHERE owner=? ORDER BY rowid').all(owner)}));db.close()"
  ].join('')
  async function snapshot(stage) {
    const [native, studio, provider] = await Promise.all([
      docker('new-api', nativeCode).then(JSON.parse), docker('studio-api', studioCode).then(JSON.parse),
      readFile(resolve(controlDirectory, 'provider-stats.json'), 'utf8').then(JSON.parse)
    ])
    const value = { stage, capturedAt: new Date().toISOString(), native, studio, provider }
    report.snapshots.push(value); await persist(); return value
  }
  async function call(path, body, token, { method, expected = 200, key } = {}) {
    const verb = method ?? (body === undefined ? 'GET' : 'POST')
    const response = await fetch(state.origin + path, { method: verb, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Origin: state.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    report.requests.push({ method: verb, path, status: response.status })
    if (response.status === 429) {
      report.state = 'blocked-rate-limit'; report.rateLimit = rateLimitDiagnostic(verb, path, response.headers)
      await persist(); throw new Error('Native or API rate limit: stopped without retry')
    }
    assert.equal(response.status, expected, 'Unexpected HTTP status for ' + verb + ' ' + path)
    const result = await response.json()
    if (expected < 400) assert.equal(result.success, true)
    else assert.equal(result.success, false)
    return { data: result.data, cacheControl: response.headers.get('cache-control') }
  }
  async function login(identity) {
    const encryption = (await call('/api/user/login/encryption-key')).data
    assert.equal(encryption.enabled, true)
    const encrypted = publicEncrypt({ key: encryption.public_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(identity.password)).toString('base64')
    const data = (await call('/api/user/login', { username: identity.username, password_encrypted: encrypted, encryption_key_id: encryption.kid })).data
    assert.equal(data.user.id, identity.owner); assert.equal(data.user.role, 1); assert.equal(data.user.status, 1)
    assert.ok(typeof data.access_token === 'string' && data.access_token)
    const self = (await call('/api/user/self', undefined, data.access_token)).data
    assert.equal(self.id, identity.owner); assert.equal(self.role, 1); assert.equal(self.status, 1)
    report.assertions.push('Actual encrypted Native login and enabled ordinary owner ' + identity.owner)
    report.login = [...(report.login ?? []), loginDiagnostic(200, { success: true, data }, { password_encrypted: true }), selfDiagnostic(200, { success: true, data: self }, true)]
    return data.access_token
  }
  try {
    assert.equal((await docker('new-api', '', true)).split(/\s+/)[0], binarySha256)
    const before = await snapshot('before-generation')
    assert.equal(before.native.account?.id, account.owner); assert.equal(before.native.account.username, account.username)
    assert.equal(before.native.account.role, 1); assert.equal(before.native.account.status, 1)
    assert.ok(before.native.channels.length && before.native.channels.every(channel => channel.localOnly))
    if (resume) validateReadOnly(resume.terminal, before)
    else assert.equal(before.studio.requests.length, 0, 'Fresh owner prevents accidental second model case')
    const token = await login(account), foreignToken = await login(foreignAccount)
    const catalog = (await call('/api/studio/models', undefined, token)).data
    if (!resume) { assert.equal(catalog.imageJobsEnabled, true); assert.ok(catalog.models.some(model => model.id === 'fixture-image' && model.kind === 'image' && model.accessible)) }
    const key = resume?.key ?? randomUUID(), payload = { model: 'fixture-image', prompt: '【本地验收替身·采购成本0】B3 原任务与私有项目闭环', inputImages: [] }
    report.jobId = key
    if (!resume) {
      const accepted = await call('/api/studio/image-jobs', payload, token, { expected: 202, key })
      report.accepted = jobSummary(accepted.data); assert.equal(report.accepted.status, 'accepted')
      assert.match(accepted.cacheControl ?? '', /private/); assert.match(accepted.cacheControl ?? '', /no-store/)
    }
    const deadline = Date.now() + 20000
    let completed
    while (Date.now() < deadline) {
      const read = await call('/api/studio/image-jobs/' + key, undefined, token)
      assert.match(read.cacheControl ?? '', /no-store/)
      const summary = jobSummary(read.data)
      report.readStatuses = [...(report.readStatuses ?? []), summary.status]
      if (summary.status === 'completed') { completed = read.data; break }
      assert.ok(['accepted', 'ready', 'submission_started', 'output_received', 'output_saved'].includes(summary.status), 'Original job did not complete; no reauthorization or model retry')
      await new Promise(done => setTimeout(done, 150))
    }
    assert.ok(completed, 'Original task completion timed out; do not retry POST')
    report.completed = jobSummary(completed)
    const generated = await snapshot('completed-before-recovery')
    validateOriginalJob(resume?.before ?? before, generated)
    const asset = (await call('/api/studio/assets/' + completed.assetId, undefined, token)).data
    assert.equal(asset.sha256, report.completed.imageSha256)
    assert.equal(hash(Buffer.from(asset.dataURL.split(',')[1], 'base64')), asset.sha256)
    const project = (await call('/api/studio/projects/from-asset', { assetId: asset.id, title: 'B3 本地验收私有原图项目' }, token)).data
    const document = { elements: [{ type: 'image', id: 'native-original-image', x: 0, y: 0, width: 320, height: 320, fileId: 'original-file', customData: { assetId: asset.id } }],
      appState: { viewBackgroundColor: '#ffffff' }, files: { 'original-file': { id: 'original-file', assetId: asset.id, dataURL: asset.dataURL, mimeType: asset.mimeType, created: Date.now() } } }
    const saved = (await call('/api/studio/projects/' + project.id, { expectedRevision: project.revision, document }, token, { method: 'PATCH' })).data
    assert.equal(saved.revision, 2)
    report.project = { id: saved.id, revision: saved.revision, sourceAssetId: saved.sourceAssetId, documentHash: hash(saved.document), assetSha256: asset.sha256 }
    const stable = await snapshot('saved-before-readonly-checks')
    if (!resume) {
      const replay = await call('/api/studio/image-jobs', payload, token, { key })
      assert.equal(replay.data.jobId, key); assert.equal(replay.data.status, 'completed')
      await call('/api/studio/image-jobs', { ...payload, prompt: payload.prompt + ' 改动' }, token, { expected: 409, key })
      await call('/api/studio/image-jobs/' + key + '/authorize', { confirm: true }, token, { expected: 409 })
      await call('/api/studio/image-jobs/' + key + '/cancel', { confirm: true }, token, { expected: 409 })
    }
    for (const path of ['/api/studio/image-jobs/' + key, '/api/studio/assets/' + asset.id, '/api/studio/projects/' + saved.id]) {
      await call(path, undefined, foreignToken, { expected: 404 })
      await call(path, undefined, undefined, { expected: 401 })
    }
    await call('/api/studio/projects/from-asset', { assetId: asset.id }, foreignToken, { expected: 404 })
    for (let index = 0; index < 2; index++) {
      assert.equal(jobSummary((await call('/api/studio/image-jobs/' + key, undefined, token)).data).imageSha256, asset.sha256)
      const reopened = (await call('/api/studio/projects/' + saved.id, undefined, token)).data
      assert.equal(hash(reopened.document), report.project.documentHash)
      assert.equal((await call('/api/studio/projects/from-asset', { assetId: asset.id }, token)).data.id, saved.id)
    }
    validateReadOnly(stable, await snapshot('after-readonly-checks'))
    if (resume) assert.equal(hash(await readFile(resume.sourcePath)), resume.sourceSha256)
    const nativeIds = new Set(generated.native.logs.map(row => row.request_id))
    assert.ok(report.completed.usage.requestIds.length && report.completed.usage.requestIds.every(id => nativeIds.has(id)))
    report.assertions.push('One original image submission; exact private bytes; durable revision 2; same asset project; foreign/anonymous denied; recovery hashes unchanged')
    report.state = resume ? 'resumed-original-read-and-project-passed' : 'passed'; report.finishedAt = new Date().toISOString(); await persist()
    console.log(JSON.stringify({ state: report.state, report: reportPath, jobId: key, owner: account.owner, assetSha256: asset.sha256, projectId: saved.id, procurementCost: 0 }))
  } catch {
    if (report.state !== 'blocked-rate-limit') report.state = 'failed'
    report.failure = { rawErrorsAndAuthExcluded: true, noRetryOrRelease: true }
    try { await snapshot('failure-readonly-observation') } catch { report.failureSnapshotUnavailable = true }
    await persist()
    console.log(JSON.stringify({ state: report.state, report: reportPath, noRetryOrRelease: true }))
    process.exitCode = 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run(await inputs(process.argv.slice(2)))
