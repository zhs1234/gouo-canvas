// Opt-in T1.12 browser acceptance. Never starts/stops Native or browser-test
// services, provisions accounts, reads operator credentials, or uses a paid provider.
// Run from v2 against a PREPARED, fresh user-acceptance environment:
// node tests/stack/browser-offline-native.cases.mjs --state .local/.../state.json
//   --identity .local/t112-identity.json --report .local/t112-report.json
//   --scenario text|image --confirm-isolated-native [--check-failed-refresh]
// --login-only diagnoses one ordinary UI login without arming/sending a model.
// --resume-completed .local/<blocked-report.json> only reads an original saved
// terminal run in a NEW browser profile after the operator waits naturally.
// Identity: {version:1,origin,stateFile,fixtureOnly:true,
//   account:{owner,username:'t112a<8-32 hex>',password,threadId:<empty own UUID>}}.
// --validate-only checks files/scope without Docker, HTTP, browser or a report.
import assert from 'node:assert/strict'
import { access, readFile, writeFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

export const sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
export const binarySha256 = 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529'
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const digest = value => createHash('sha256').update(value).digest('hex')
const pause = ms => new Promise(done => setTimeout(done, ms))
async function json(path) { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }
// Diagnostic allowlists exclude auth values and locator logs (fill logs can
// contain the password). Never persist a response or exception verbatim.
export function loginDiagnostic(status, body, sent) {
  const keys = value => value && typeof value === 'object' ? Object.keys(value).filter(key => /^[a-z_]{1,40}$/.test(key)).sort() : []
  const number = value => Number.isSafeInteger(value) ? value : null
  return { httpStatus: number(status), success: typeof body?.success === 'boolean' ? body.success : null,
    envelopeKeys: keys(body), dataKeys: keys(body?.data), userKeys: keys(body?.data?.user),
    user: { id: number(body?.data?.user?.id), role: number(body?.data?.user?.role), status: number(body?.data?.user?.status) },
    authBundlePresent: typeof body?.data?.access_token === 'string' && body.data.access_token.length > 0,
    publicMessagePresent: typeof body?.message === 'string' && body.message.length > 0,
    encryptedPasswordPresent: typeof sent?.password_encrypted === 'string' && sent.password_encrypted.length > 0,
    encryptedPasswordLength: typeof sent?.password_encrypted === 'string' ? sent.password_encrypted.length : null,
    plaintextPasswordFieldPresent: Object.hasOwn(sent ?? {}, 'password') }
}
export function failureDiagnostic(error, failedCheck) {
  const message = typeof error?.message === 'string' ? error.message : ''
  const operation = /^(?:locator\.(?:fill|click|waitFor|screenshot|getAttribute)|page\.(?:goto|reload|waitForResponse|waitForEvent|screenshot)|expect\([^\r\n]{0,40}\)\.(?:toBeVisible|toBeEnabled|toHaveURL))/.exec(message)?.[0]
  const resourceUnavailable = /No resource with given identifier|No data found for resource|Response body is unavailable|Network\.getResponseBody|Target page, context or browser has been closed/i.test(message)
  const locatorTimeout = /^(?:locator\.|expect\()/i.test(message) && /Timeout|timed out/i.test(message)
  const navigationError = /^page\.(?:goto|reload)|Navigation failed|navigation.*(?:interrupted|failed)/i.test(message)
  return { errorType: ['AssertionError', 'TimeoutError', 'Error', 'TypeError'].includes(error?.name) ? error.name : 'OtherError',
    classification: resourceUnavailable ? 'response-body-unavailable' : locatorTimeout ? 'locator-timeout' : navigationError ? 'navigation-error' : failedCheck ? 'contract-assertion' : 'operation-error',
    knownResourceUnavailableMessage: resourceUnavailable,
    ...(failedCheck ? { failedCheck } : {}), ...(operation ? { operation: operation.replace(/expect\([^)]*\)/, 'expect(locator)') } : {}),
    ...(/Timeout (\d+)ms/.test(message) ? { timeoutMilliseconds: Number(/Timeout (\d+)ms/.exec(message)[1]) } : {}),
    rawMessageAndLocatorLogExcluded: true }
}
export function selfDiagnostic(status, body, bearerPresent) {
  const number = value => Number.isSafeInteger(value) ? value : null
  return { httpStatus: number(status), success: typeof body?.success === 'boolean' ? body.success : null,
    user: { id: number(body?.data?.id), role: number(body?.data?.role), status: number(body?.data?.status) },
    bearerPresent: bearerPresent === true }
}
export function rateLimitDiagnostic(method, path, headers, observedAt = Date.now()) {
  const raw = headers['retry-after'], seconds = typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : null
  const date = typeof raw === 'string' && /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw.trim()) ? Date.parse(raw.trim()) : NaN
  return { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(method) ? method : 'other',
    path: /^\/api\/[a-z\d/_-]+$/i.test(path) ? path : 'excluded', httpStatus: 429, observedAt: new Date(observedAt).toISOString(),
    retryAfterPresent: raw !== undefined, retryAfterSeconds: seconds, retryAfterDate: Number.isFinite(date) ? new Date(date).toISOString() : null,
    headerValuesExcluded: true, automaticRetry: false }
}
export function validateCompletedResume(source, state, account, scenario) {
  assert.ok(source.version === 1 && source.state === 'blocked-rate-limit' && source.rateLimited === true
    && ['online-get-recovery', 'full-reload-cookie-recovery'].includes(source.stage) && source.origin === state.origin && source.project === state.project
    && (source.instanceId === undefined || source.instanceId === state.instanceId) && source.owner === account.owner && source.scenario === scenario
    && source.sourceCommit === sourceCommit && source.binarySha256 === binarySha256 && source.realPaidProviderCalls === 0
    && source.procurementCost === 0 && source.noModelRetry === true && source.evidence?.P === 'not executed', 'Resume requires the same isolated rate-limited original case')
  assert.ok(/^T112-[a-f\d]{16}$/.test(source.tag) && uuid(source.runId), 'Resume requires original runId and synthetic tag')
  assert.ok(source.offline?.navigatorOnline === false && source.offline.disconnectedRequest?.path === '/api/studio/runs/stream'
    && /^net::ERR_[A-Z_]+$/.test(source.offline.disconnectedRequest.error ?? ''), 'Resume requires actual original browser disconnection evidence')
  assert.ok(source.selfDiagnostic?.httpStatus === 200 && source.selfDiagnostic.success === true
    && source.selfDiagnostic.user?.id === account.owner && source.selfDiagnostic.user.role === 1 && source.selfDiagnostic.user.status === 1
    && source.selfDiagnostic.bearerPresent === true, 'Resume requires the original strict authenticated ordinary identity proof')
  const posts = source.browserRequests?.filter(row => row.path === '/api/studio/runs/stream' && row.method === 'POST')
  assert.ok(posts?.length === 1 && posts[0].sameKey === true && posts[0].runId === source.runId && posts[0].threadId === account.threadId, 'Resume forbids ambiguous or repeated original model sends')
  const before = source.snapshots?.find(row => row.stage === 'prepared-before-send')
  const accepted = source.snapshots?.find(row => row.stage === 'accepted-before-offline')
  const offline = source.snapshots?.find(row => row.stage === 'offline-provider-held')
  const terminal = source.snapshots?.find(row => row.stage === 'backend-terminal-before-recovery')
  const run = snapshot => snapshot?.studio?.runs?.find(row => row.runId === source.runId && row.threadId === account.threadId)
  const saved = run(terminal), partial = run(accepted)
  assert.ok(before && accepted && offline && terminal && terminal.studio.thread?.owner === account.owner
    && terminal.studio.thread.id === account.threadId && terminal.native.account?.id === account.owner
    && terminal.native.account.role === 1 && terminal.native.account.status === 1
    && partial?.status === 'running' && partial.front === true && partial.back === false
    && saved?.status === 'completed' && saved.front === true && saved.back === true && /^[a-f\d]{64}$/.test(saved.textHash)
    && saved.usage?.state === 'recorded' && saved.usage.settlementState === 'unconfirmed', 'Resume requires accepted partial and saved terminal evidence for the original owner/thread')
  const chats = scenario === 'image' ? 2 : 1, images = scenario === 'image' ? 1 : 0
  assert.ok(accepted.provider?.chat - before.provider?.chat === chats && accepted.provider?.image - before.provider?.image === images
    && offline.provider?.chat === accepted.provider.chat && offline.provider?.image === accepted.provider.image
    && offline.provider?.requests?.some(row => row.roleTag === source.tag && row.outcome === 'waiting-control')
    && terminal.provider?.chat === accepted.provider.chat && terminal.provider?.image === accepted.provider.image
    && terminal.provider?.requests?.filter(row => row.roleTag === source.tag && row.kind === 'chat').length === chats
    && terminal.provider?.requests?.filter(row => row.roleTag === source.tag && row.kind === 'image').length === images
    && terminal.provider?.requests?.filter(row => row.roleTag === source.tag).every(row => row.outcome === 'completed'), 'Resume requires bounded original supplier work with no replay')
  const reservations = terminal.studio.reservations?.filter(row => row.key === source.runId)
  const logs = terminal.native.logs?.filter(row => row.type === 2 && !before.native.logs?.some(old => old.id === row.id))
  assert.ok(reservations?.length === 1 + images && reservations.every(row => row.status === 'used') && logs?.length === chats + images
    && saved.usage.requestIds?.length === logs.length && saved.usage.requestIds.every(id => logs.some(row => row.request_id === id)), 'Resume requires original used reservations and exact owner Native consumption records')
  assert.ok(saved.images?.length === images && (images === 0 || /^[a-f\d]{64}$/.test(source.originalPngSha256)
    && saved.images[0].sha256 === source.originalPngSha256), 'Resume requires the original PNG proof for image cases')
  return { tag: source.tag, runId: source.runId, originalPngSha256: source.originalPngSha256, terminal,
    proof: { originalState: source.state, originalStage: source.stage, partialCapturedAt: accepted.capturedAt,
      offline: source.offline, terminalCapturedAt: terminal.capturedAt, originalRunId: source.runId,
      originalBrowserProfileRetained: false, continuousEndToEndPassed: false,
      originalRetryAfterHeadersAvailable: Array.isArray(source.rateLimits),
      evidenceComposition: 'Original partial/offline/backend proof plus a new browser profile reading the same saved run' } }
}
// Read-only CDP stream observation. Only summaries leave this parser; raw text,
// image URLs and error messages never enter the report. It consumes an extra
// observational copy, never the page's Fetch reader or a replayed request.
export function createStreamEvidence(tag, sentAt = Date.now()) {
  const evidence = { sentAt: new Date(sentAt).toISOString(), dataBytes: 0, events: [], frameCount: 0 }
  const decoder = new TextDecoder(); let buffer = ''
  return { evidence, receive(base64) {
    const bytes = Buffer.from(base64, 'base64'); evidence.dataBytes += bytes.length
    evidence.firstDataAt ??= new Date().toISOString(); buffer += decoder.decode(bytes, { stream: true })
    if (buffer.length > 48 * 1024 * 1024) { buffer = ''; evidence.observationSizeLimit = true; return }
    let boundary
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length)
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      evidence.frameCount++
      let event; try { event = JSON.parse(data) } catch { evidence.invalidJsonFrame = true; continue }
      if (!['run.started', 'message.delta', 'tool.started', 'tool.completed', 'run.completed', 'run.failed'].includes(event.type)) continue
      const entry = { type: event.type, runId: uuid(event.runId) ? event.runId : null, afterSendMilliseconds: Date.now() - sentAt }
      if (event.type === 'message.delta') {
        entry.deltaCharacters = typeof event.delta === 'string' ? event.delta.length : 0
        entry.frontMarker = typeof event.delta === 'string' && event.delta.includes(tag + ' 本地验收受控慢流前半段')
        entry.backMarker = typeof event.delta === 'string' && event.delta.includes(tag + ' 本地验收受控慢流后半段')
        evidence.firstDeltaAfterSendMilliseconds ??= entry.afterSendMilliseconds
      }
      if (event.type === 'tool.completed') entry.imageCount = event.artifacts?.filter(artifact => artifact.type === 'image').length ?? 0
      if (evidence.events.length < 100) evidence.events.push(entry); else evidence.eventSummaryLimit = true
    }
  } }
}
export async function validateOfflineInputs(args, localRoot = resolve('.local')) {
  assert.ok(args.includes('--confirm-isolated-native'), 'Explicit isolated Native confirmation required')
  const allowed = ['--state', '--identity', '--report', '--scenario', '--confirm-isolated-native', '--check-failed-refresh', '--validate-only', '--login-only', '--resume-completed']
  const values = new Map()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    assert.ok(allowed.includes(key) && !values.has(key), 'Unknown or repeated acceptance option')
    values.set(key, ['--confirm-isolated-native', '--check-failed-refresh', '--validate-only', '--login-only'].includes(key) ? true : args[++i])
  }
  const local = await realpath(localRoot)
  async function localPath(value, output = false) {
    assert.ok(typeof value === 'string' && value && !value.startsWith('--'), 'Required explicit file option missing')
    const path = resolve(value), actual = output ? join(await realpath(dirname(path)), path.split(/[\\/]/).at(-1)) : await realpath(path)
    const suffix = relative(local, actual)
    assert.ok(suffix && !suffix.startsWith('..') && !isAbsolute(suffix), 'Acceptance files must stay in this workspace .local')
    return actual
  }
  const statePath = await localPath(values.get('--state')), identityPath = await localPath(values.get('--identity')), reportPath = await localPath(values.get('--report'), true)
  assert.ok(![statePath, identityPath].includes(reportPath), 'Report cannot overwrite an input')
  let reportExists = false; try { await access(reportPath); reportExists = true } catch {}
  assert.ok(!reportExists, 'Existing report prevents accidental repeat; preserve failure and use a new approved case')
  const state = await json(statePath), identity = await json(identityPath), origin = new URL(state.origin)
  assert.ok(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && /^\d+$/.test(origin.port) && Number(origin.port) <= 65535
    && !['8080', '53238', '58438'].includes(origin.port) && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'Only a fresh loopback acceptance origin is allowed')
  assert.ok(state.version === 1 && /^gouo-user-acceptance-\d+-[a-z\d]+$/.test(state.project) && state.sourceCommit === sourceCommit
    && state.binarySha256 === binarySha256 && state.stopped !== true && state.procurementCost === 0 && state.syntheticComplianceFixture === true
    && state.provider === 'explicit local acceptance fixture' && uuid(state.instanceId), 'Fixed, active, zero-procurement synthetic stack required')
  assert.equal(await localPath(state.directory), dirname(statePath), 'Random state directory mismatch')
  assert.equal(await localPath(state.compose), join(state.directory, 'compose.json'), 'Compose must belong to the same random directory')
  assert.equal(await localPath(state.env), join(state.directory, 'empty.env'), 'Environment must belong to the same random directory')
  assert.equal((await readFile(state.env, 'utf8')).trim(), '', 'Operator environment files are forbidden')
  assert.ok(identity.version === 1 && identity.fixtureOnly === true && identity.origin === state.origin && await localPath(identity.stateFile) === statePath, 'Identity must explicitly belong to this synthetic instance')
  const account = identity.account
  assert.ok(account && Number.isSafeInteger(account.owner) && account.owner >= 2 && /^t112[a-z][a-f\d]{8,32}$/.test(account.username)
    && typeof account.password === 'string' && account.password.length >= 8 && uuid(account.threadId), 'Prepared ordinary T112 synthetic account and empty thread required')
  const scenario = values.get('--scenario') ?? 'text'
  assert.ok(['text', 'image'].includes(scenario), 'Only explicit text/image offline scenarios are supported')
  const composeData = await json(state.compose), services = composeData.services
  assert.ok(services?.['new-api']?.image === 'gouo-v2-new-api:latest' && services['studio-api']?.environment?.GOUO_BACKEND_DEV_TARGET === 'http://new-api:3000'
    && services['studio-api'].environment.GOUO_GATEWAY_BASE_URL === 'http://new-api:3000/v1' && services['studio-api'].environment.GOUO_ACCOUNT_INSTANCE_ID === state.instanceId
    && services['fixture-provider']?.entrypoint?.join(' ') === 'node /app/tests/stack/user-acceptance-environment-provider.mjs', 'Compose must use the isolated local fixture topology')
  assert.ok(!services['new-api'].ports && !services['studio-api'].ports && !services['fixture-provider'].ports, 'Private services cannot publish host ports')
  const controlDirectory = await localPath(join(state.directory, 'control'))
  assert.ok(services['fixture-provider'].volumes?.some(mount => mount.target === '/fixture' && resolve(mount.source) === controlDirectory && mount.read_only === false), 'Provider controls must be confined to this random fixture directory')
  assert.ok(!Object.values(composeData.volumes ?? {}).some(volume => volume?.external === true || volume?.name), 'External or named user data volumes are forbidden')
  let resume
  if (values.has('--resume-completed')) {
    assert.ok(!values.has('--login-only') && !values.has('--check-failed-refresh'), 'Read-only resume cannot run login-only or another offline scenario')
    const sourcePath = await localPath(values.get('--resume-completed'))
    assert.ok(![reportPath, statePath, identityPath].includes(sourcePath), 'Resume source must remain a separate preserved report')
    const bytes = await readFile(sourcePath)
    resume = { ...validateCompletedResume(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), state, account, scenario), sourcePath, sourceSha256: digest(bytes) }
  }
  return { state, account, statePath, reportPath, scenario, controlDirectory, resume, failedRefresh: values.has('--check-failed-refresh'), validateOnly: values.has('--validate-only'), loginOnly: values.has('--login-only') }
}

async function run(input) {
  const { state, account, reportPath, scenario, controlDirectory, failedRefresh, resume } = input
  const tag = resume?.tag ?? 'T112-' + randomBytes(8).toString('hex'), controlPath = join(controlDirectory, 'offline-control.json')
  const report = { version: 1, state: 'started', scenario, tag, origin: state.origin, project: state.project, owner: account.owner,
    instanceId: state.instanceId,
    sourceCommit, binarySha256, evidence: { F: 'explicit local supplier', N: 'real fixed Native; synthetic ordinary account and funds', P: 'not executed' },
    realPaidProviderCalls: 0, procurementCost: 0, secretsExcluded: true, noModelRetry: true, failedRefreshRequired: failedRefresh,
    startedAt: new Date().toISOString(), stage: 'live-scope-check', browserRequests: [], snapshots: [], screenshots: [], assertions: [] }
  if (resume) {
    report.runId = resume.runId; report.originalPngSha256 = resume.originalPngSha256
    report.resumption = { ...resume.proof, sourceReport: resume.sourcePath, sourceReportSha256: resume.sourceSha256, freshBrowserProfile: true, noModelSendOrControl: true }
  }
  const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  const check = (condition, label) => { if (!condition) report.failedCheck = label; assert.ok(condition, label); report.assertions.push(label) }
  function compose(service, code, binary = false) {
    return new Promise((done, reject) => {
      const command = ['compose', '--env-file', state.env, '-p', state.project, '-f', state.compose, 'exec', '-T', service,
        ...(binary ? ['sha256sum', '/usr/local/bin/new-api'] : ['node', '--input-type=module', '-e', code])]
      const child = spawn(process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker', command, { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated read-only Docker operation timed out')) }, 15_000)
      child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', () => {})
      child.on('error', () => { clearTimeout(timer); reject(new Error('Isolated read-only Docker operation failed')) })
      child.on('exit', code => { clearTimeout(timer); code === 0 ? done(output.trim()) : reject(new Error('Isolated read-only Docker operation failed')) })
    })
  }
  const nativeCode = `import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';const db=new DatabaseSync('/data/new-api.db',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const owner=${account.owner};const tables=['tokens','user_subscriptions','subscription_pre_consume_records','logs'];const monetaryHash=hash(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));console.log(JSON.stringify({monetaryHash,account:db.prepare('SELECT id,username,role,status,quota,used_quota,request_count FROM users WHERE id=?').get(owner),channels:db.prepare('SELECT id,type,status,base_url,key FROM channels').all().map(channel=>({id:channel.id,localOnly:channel.type===1&&channel.status===1&&channel.base_url==='http://fixture-provider:19000'&&channel.key==='fixture-provider-zero-procurement-cost'})),tokens:db.prepare('SELECT id,user_id,status,remain_quota,used_quota,expired_time FROM tokens WHERE user_id=? ORDER BY id').all(owner),subscriptions:db.prepare('SELECT id,user_id,status,amount_used,amount_total FROM user_subscriptions WHERE user_id=? ORDER BY id').all(owner),preconsume:db.prepare('SELECT id,request_id,user_id,pre_consumed,status FROM subscription_pre_consume_records WHERE user_id=? ORDER BY id').all(owner),logs:db.prepare('SELECT id,user_id,token_id,type,quota,request_id FROM logs WHERE user_id=? ORDER BY id').all(owner)}));db.close()`
  const studioCode = `import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');const owner=${account.owner};const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);const dataHash=hash(tables.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));const runs=db.prepare('SELECT * FROM studio_runs WHERE owner=? ORDER BY rowid').all(owner).map(run=>{const events=['running','unknown'].includes(run.status)?db.prepare('SELECT event FROM studio_run_events WHERE owner=? AND run_id=? ORDER BY sequence').all(owner,run.run_id).map(row=>JSON.parse(row.event)):JSON.parse(run.events);const text=events.filter(event=>event.type==='message.delta').map(event=>event.delta).join('');return{runId:run.run_id,threadId:run.thread_id,status:run.status,textHash:hash(text),textLength:text.length,front:text.includes(${JSON.stringify(tag+' 本地验收受控慢流前半段')}),back:text.includes(${JSON.stringify(tag+' 本地验收受控慢流后半段')}),images:events.filter(event=>event.type==='tool.completed').flatMap(event=>(event.artifacts??[]).filter(artifact=>artifact.type==='image').map((artifact,index)=>({toolCallId:event.toolCallId,index,sha256:hash(Buffer.from(artifact.url.split(',')[1],'base64'))}))),usage:run.usage?JSON.parse(run.usage):null}});console.log(JSON.stringify({dataHash,thread:db.prepare('SELECT id,owner FROM studio_threads WHERE id=?').get(${JSON.stringify(account.threadId)}),runs,requests:db.prepare('SELECT kind,key,status FROM requests WHERE owner=? ORDER BY rowid').all(owner),reservations:db.prepare('SELECT request_kind,key,benefit,status FROM trial_reservations WHERE owner=? ORDER BY rowid').all(owner),funding:db.prepare('SELECT status FROM funding_writes WHERE owner=?').get(owner)??null,renewals:db.prepare('SELECT status FROM relay_renewals WHERE owner=? ORDER BY rowid').all(owner),grants:db.prepare('SELECT status FROM trial_grants WHERE owner=?').get(owner)??null}));db.close()`
  async function snapshot(stage) {
    const [native, studio, provider] = await Promise.all([compose('new-api', nativeCode).then(JSON.parse), compose('studio-api', studioCode).then(JSON.parse), json(join(controlDirectory, 'provider-stats.json')).catch(error => { if (error.code === 'ENOENT') return { chat: 0, image: 0, requests: [] }; throw error })])
    const entry = { stage, capturedAt: new Date().toISOString(), native, studio, provider }; report.snapshots.push(entry); await persist(); return entry
  }
  async function control(command) {
    check(!resume, 'Read-only resume cannot change supplier controls')
    let file; try { file = await json(controlPath) } catch (error) { if (error.code !== 'ENOENT') throw error; file = { version: 1, instanceId: state.instanceId, streams: {} } }
    check(file.version === 1 && file.instanceId === state.instanceId && typeof file.streams === 'object' && file.streams, 'Control belongs to this isolated instance')
    file.streams[tag] = { command }; await writeFile(controlPath, JSON.stringify(file), { mode: 0o600 })
  }
  async function until(predicate, label, timeout = 15_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(150) }
    throw new Error(label)
  }
  let browser, context, page, safeScreenshot = false, controlArmed = false, providerReleased = false
  const screenshot = async stage => { const path = join(dirname(reportPath), `${tag}-${stage}.png`); await page.screenshot({ path, fullPage: true }); report.screenshots.push({ stage, path }); await persist() }
  try {
    check((await compose('new-api', '', true)).split(/\s+/)[0] === binarySha256, 'Actual Native binary is the approved fixed version')
    const initial = await snapshot('before-browser')
    check(initial.native.account?.id === account.owner && initial.native.account.username === account.username && initial.native.account.role === 1 && initial.native.account.status === 1, 'Prepared Native owner is enabled ordinary synthetic identity')
    check(initial.native.channels.length > 0 && initial.native.channels.every(channel => channel.localOnly), 'Every channel uses only the explicit zero-procurement local supplier')
    check(initial.studio.thread?.owner === account.owner && (resume || !initial.studio.runs.some(run => run.threadId === account.threadId)), 'Prepared thread belongs to owner; new generation requires an empty thread')
    if (resume) {
      check(digest(JSON.stringify(initial.studio.runs.find(row => row.runId === resume.runId))) === digest(JSON.stringify(resume.terminal.studio.runs.find(row => row.runId === resume.runId))), 'Original saved terminal result is unchanged before read-only resume')
    }
    check(!initial.studio.reservations.some(row => row.status !== 'used') && !['pending', 'unknown'].includes(initial.studio.funding?.status)
      && !initial.studio.renewals.some(row => ['pending', 'unknown'].includes(row.status)) && initial.studio.grants?.status !== 'unknown', 'Prepared owner has no old unresolved financial or usage operation')
    const { chromium, expect } = await import('@playwright/test')
    browser = await chromium.launch({ headless: true }); context = await browser.newContext(); page = await context.newPage(); page.setDefaultTimeout(15_000)
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable')
    const streams = new Map()
    cdp.on('Network.requestWillBeSent', event => {
      const url = new URL(event.request.url)
      if (url.origin !== new URL(state.origin).origin || url.pathname !== '/api/studio/runs/stream' || event.request.method !== 'POST') return
      const observer = createStreamEvidence(tag); observer.pendingChunks = []; streams.set(event.requestId, observer); report.streamEvidence ??= []; report.streamEvidence.push(observer.evidence)
    })
    cdp.on('Network.responseReceived', event => {
      const observer = streams.get(event.requestId); if (!observer) return
      observer.evidence.httpStatus = event.response.status
      const header = name => Object.entries(event.response.headers).find(([key]) => key.toLowerCase() === name)?.[1]
      observer.evidence.contentType = String(header('content-type') ?? '').slice(0, 100)
      observer.evidence.contentEncoding = String(header('content-encoding') ?? 'identity').slice(0, 40)
      observer.evidence.headersAfterSendMilliseconds = Date.now() - Date.parse(observer.evidence.sentAt)
      void cdp.send('Network.streamResourceContent', { requestId: event.requestId }).then(result => {
        if (result.bufferedData) observer.receive(result.bufferedData)
        for (const data of observer.pendingChunks) observer.receive(data)
        observer.pendingChunks = []; observer.evidence.cdpStreamObservation = 'available'
      }, () => { observer.evidence.cdpStreamObservation = 'unavailable; HTTP/byte timings and server snapshots remain observable' })
    })
    cdp.on('Network.dataReceived', event => {
      const observer = streams.get(event.requestId); if (!observer) return
      observer.evidence.observedTransferBytes = (observer.evidence.observedTransferBytes ?? 0) + event.dataLength
      observer.evidence.firstTransferAfterSendMilliseconds ??= Date.now() - Date.parse(observer.evidence.sentAt)
      if (event.data) { if (observer.evidence.cdpStreamObservation === 'available') observer.receive(event.data); else observer.pendingChunks.push(event.data) }
    })
    const responseTasks = []
    let rejectRateLimit
    const rateLimitStop = new Promise((_, reject) => { rejectRateLimit = reject }); rateLimitStop.catch(() => {})
    const ui = operation => { if (report.rateLimited) throw new Error('Native rate limit stops acceptance; manual continuation requires natural reset'); return Promise.race([operation(), rateLimitStop]) }
    page.on('request', request => {
      const url = new URL(request.url()); if (url.origin !== new URL(state.origin).origin || !url.pathname.startsWith('/api/')) return
      const entry = { method: request.method(), path: url.pathname, at: new Date().toISOString() }
      if (url.pathname === '/api/studio/runs/stream' && request.method() === 'POST') {
        const body = request.postDataJSON(); entry.runId = body.runId; entry.threadId = body.threadId; entry.sameKey = request.headers()['idempotency-key'] === body.runId
        report.runId ??= body.runId
      }
      report.browserRequests.push(entry)
    })
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (path.startsWith('/api/') && response.status() === 429) {
        report.rateLimited = true; report.rateLimits ??= []
        report.rateLimits.push(rateLimitDiagnostic(response.request().method(), path, response.headers()))
        report.rateLimitPolicy = 'Stopped at observed 429; no bucket reset, parameter/IP change, timed wait or automatic retry'
        rejectRateLimit(new Error('Native rate limit stops acceptance; manual continuation requires natural reset'))
      }
      if (response.request().method() === 'GET' && path === '/api/studio/threads/' + account.threadId) responseTasks.push(response.json().then(body => {
        report.historyReads ??= []; report.historyReads.push({ status: response.status(), runIds: body.data?.runs?.map(run => ({ runId: run.runId, status: run.status })) ?? [] })
      }).catch(() => { report.historyReadUnavailable = true }))
    })
    report.stage = 'ordinary-ui-login'; await persist()
    await ui(() => page.goto(state.origin + '/sign-in?redirect=' + encodeURIComponent('/studio/chat?thread=' + account.threadId)))
    await ui(() => page.locator('input[name="username"]').fill(account.username)); await ui(() => page.locator('input[name="password"]').fill(account.password))
    // Install before click. The stable Studio document's authenticated self
    // response proves the current owner after actual Native cookie recovery.
    const selfResponse = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.origin === new URL(state.origin).origin && url.pathname === '/api/user/self' && response.request().method() === 'GET'
        && response.status() === 200 && new URL(page.url()).pathname === '/studio/chat'
    }).then(async response => {
      const body = await response.json(), bearerPresent = /^Bearer [^\r\n]+$/i.test(response.request().headers().authorization ?? '')
      const diagnostic = selfDiagnostic(response.status(), body, bearerPresent)
      report.selfDiagnostic = diagnostic; await persist(); return diagnostic
    }).then(value => ({ value }), error => ({ error }))
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user/login' && response.request().method() === 'POST').then(async response => {
      // Begin reading before click's navigation wait settles. A later full
      // document navigation may dispose of the original CDP response body.
      const bodyRead = response.json().then(body => ({ body }), error => ({ error }))
      const intent = response.request().postDataJSON(), status = response.status()
      report.loginDiagnostic = loginDiagnostic(status, null, intent); await persist()
      const result = await bodyRead
      if (result.error) {
        report.loginBodyUnavailable = true; report.loginBodyObservation = failureDiagnostic(result.error); report.loginEnvelopeRead = false
        await persist(); return { status, body: null, intent }
      }
      report.loginEnvelopeRead = true; report.loginDiagnostic = loginDiagnostic(status, result.body, intent); await persist()
      return { status, body: result.body, intent }
    })
    const [login] = await ui(() => Promise.all([loginResponse, page.locator('form button[type="submit"]').click()]))
    const body = login.body, loginIntent = login.intent
    check(login.status === 200 && (body === null || body.success === true), 'Original Native UI login returned HTTP 200 without an observed rejection')
    check(!Object.hasOwn(loginIntent, 'password') && typeof loginIntent.password_encrypted === 'string', 'Native UI used encrypted login rather than a plaintext Studio form')
    await ui(() => expect(page).toHaveURL(state.origin + '/studio/chat?thread=' + account.threadId)); safeScreenshot = true
    const authenticated = await ui(() => selfResponse)
    if (authenticated.error) { report.selfReadFailure = failureDiagnostic(authenticated.error); await persist(); throw new Error('Authenticated self response unavailable; identity proof failed') }
    const self = authenticated.value
    check(self.httpStatus === 200 && self.success === true && self.user.id === account.owner && self.user.role === 1 && self.user.status === 1 && self.bearerPresent, 'Authenticated Native self after cookie recovery proves the same enabled ordinary owner')
    report.identityProofSource = 'New API /api/user/self after native cookie login'; await persist()
    await ui(() => expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled())
    if (resume) {
      report.stage = 'resumed-get-and-reload'; await persist()
      const completeText = `【${tag} 本地验收受控慢流前半段】【${tag} 本地验收受控慢流后半段】`
      await ui(() => expect(page.getByText(completeText, { exact: true })).toBeVisible({ timeout: 15_000 }))
      if (scenario === 'image') check(digest(Buffer.from((await ui(() => page.getByAltText('生成图片').getAttribute('src'))).split(',')[1], 'base64')) === report.originalPngSha256, 'New browser GET renders the same original PNG bytes')
      await screenshot('resumed-restored'); await ui(() => page.reload())
      await ui(() => expect(page.getByText(completeText, { exact: true })).toBeVisible({ timeout: 15_000 }))
      if (scenario === 'image') check(digest(Buffer.from((await ui(() => page.getByAltText('生成图片').getAttribute('src'))).split(',')[1], 'base64')) === report.originalPngSha256, 'New browser reload renders the same original PNG bytes')
      await ui(() => Promise.all(responseTasks))
      const restored = await snapshot('after-readonly-resume')
      check(report.browserRequests.filter(row => row.path.startsWith('/api/studio/') && row.method !== 'GET').length === 0, 'Read-only resume used business GETs with zero model sends or writes')
      check(report.historyReads?.some(read => read.status === 200 && read.runIds.some(row => row.runId === resume.runId && row.status === 'completed')), 'New browser actual GET recovered the original completed runId')
      check(restored.native.monetaryHash === initial.native.monetaryHash && digest(JSON.stringify(restored.native.account)) === digest(JSON.stringify(initial.native.account))
        && restored.studio.dataHash === initial.studio.dataHash && digest(JSON.stringify(restored.provider)) === digest(JSON.stringify(initial.provider)), 'Read-only resume left Native money, Studio data, held state and provider counts unchanged')
      check(digest(await readFile(resume.sourcePath)) === resume.sourceSha256, 'Original blocked report remains unchanged')
      check(!report.rateLimited, 'No 429 was treated as successful read-only recovery')
      report.state = 'resumed-read-only-passed'; report.stage = 'segmented-recovery-complete'; report.completedAt = new Date().toISOString()
      await screenshot('resumed-reloaded'); await persist()
      console.log(JSON.stringify({ report: reportPath, state: report.state, runId: report.runId, modelSends: 0, continuousEndToEndPassed: false })); return
    }
    if (input.loginOnly) {
      report.state = 'login-verified-only'; report.stage = 'login-only-complete'; report.completedAt = new Date().toISOString()
      check(!report.browserRequests.some(row => row.path === '/api/studio/runs/stream' && row.method === 'POST'), 'Login-only diagnostic made zero model sends')
      await snapshot('login-only-readonly'); await persist()
      console.log(JSON.stringify({ report: reportPath, state: report.state, modelSends: 0, realPaidProviderCalls: 0 })); return
    }
    const before = await snapshot('prepared-before-send')
    await control('hold'); controlArmed = true
    report.stage = 'unique-ui-send'; await persist()
    const prompt = `${tag} 本地验收受控慢流${scenario === 'image' ? ' 本地验收生图' : ''}`
    await ui(() => page.getByRole('textbox', { name: '消息', exact: true }).fill(prompt))
    await ui(() => page.getByRole('button', { name: '发送', exact: true }).click())
    const front = `【${tag} 本地验收受控慢流前半段】`, back = `【${tag} 本地验收受控慢流后半段】`
    await ui(() => expect(page.getByText(front, { exact: true })).toBeVisible({ timeout: 15_000 }))
    report.frontVisibleAt = new Date().toISOString()
    const modelPosts = () => report.browserRequests.filter(row => row.path === '/api/studio/runs/stream' && row.method === 'POST')
    check(modelPosts().length === 1 && modelPosts()[0].sameKey && modelPosts()[0].threadId === account.threadId && uuid(modelPosts()[0].runId), 'One UI send uses one runId equal to its idempotency key')
    report.runId = modelPosts()[0].runId
    await until(async () => (await json(join(controlDirectory, 'provider-stats.json'))).requests.find(row => row.roleTag === tag && row.outcome === 'waiting-control'), 'Supplier did not reach the explicit pause')
    const accepted = await snapshot('accepted-before-offline'), acceptedRun = accepted.studio.runs.find(run => run.runId === report.runId)
    check(acceptedRun?.status === 'running' && acceptedRun.front && !acceptedRun.back, 'Server persisted partial content before browser offline')
    const expectedChat = scenario === 'image' ? 2 : 1, expectedImage = scenario === 'image' ? 1 : 0
    check(accepted.provider.chat - before.provider.chat === expectedChat && accepted.provider.image - before.provider.image === expectedImage, 'Only the intended bounded local model calls were accepted')
    if (scenario === 'image') {
      await ui(() => expect(page.getByAltText('生成图片')).toBeVisible())
      report.originalPngSha256 = digest(Buffer.from((await page.getByAltText('生成图片').getAttribute('src')).split(',')[1], 'base64'))
      check(acceptedRun.images.length === 1 && acceptedRun.images[0].sha256 === report.originalPngSha256
        && accepted.provider.requests.some(row => row.roleTag === tag && row.kind === 'image' && row.imageSha256 === report.originalPngSha256), 'Visible, persisted and supplier original PNG hashes agree before offline')
    }
    await screenshot('partial')
    report.stage = 'actual-browser-offline'; await persist()
    const disconnect = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === '/api/studio/runs/stream', timeout: 10_000 })
      .then(request => ({ path: '/api/studio/runs/stream', error: request.failure()?.errorText ?? 'unknown' }), () => null)
    await context.setOffline(true)
    report.offline = { commandedAt: new Date().toISOString(), navigatorOnline: await page.evaluate(() => navigator.onLine), disconnectedRequest: await disconnect }
    check(report.offline.navigatorOnline === false && report.offline.disconnectedRequest, 'Browser offline actually interrupted the accepted HTTP stream')
    await ui(() => expect(page.getByText(front, { exact: true })).toBeVisible())
    if (failedRefresh) {
      report.stage = 'failed-read-preserves-content'; await persist()
      await ui(() => page.getByRole('button', { name: '刷新任务记录', exact: true }).click())
      await ui(() => expect(page.getByText(front, { exact: true })).toBeVisible())
      if (scenario === 'image') await ui(() => expect(page.getByAltText('生成图片')).toBeVisible())
      check(modelPosts().length === 1, 'Failed offline refresh did not issue another model send')
    }
    await screenshot('offline')
    const offline = await snapshot('offline-provider-held')
    check(offline.provider.chat === accepted.provider.chat && offline.provider.image === accepted.provider.image
      && offline.provider.requests.find(row => row.roleTag === tag && row.outcome === 'waiting-control'), 'Browser disconnect did not cancel or resubmit accepted supplier work')
    await control('continue'); providerReleased = true
    report.stage = 'backend-completes-browser-offline'; await persist()
    await until(async () => {
      const result = JSON.parse(await compose('studio-api', `import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');console.log(JSON.stringify(db.prepare('SELECT status FROM studio_runs WHERE owner=? AND run_id=?').get(${account.owner},${JSON.stringify(report.runId)})));db.close()`))
      return result?.status === 'completed'
    }, 'Backend did not complete the existing request while browser was offline', 25_000)
    const terminal = await snapshot('backend-terminal-before-recovery'), terminalRun = terminal.studio.runs.find(run => run.runId === report.runId)
    check(terminalRun.front && terminalRun.back && terminalRun.status === 'completed', 'Backend saved the complete original request before recovery')
    check(terminalRun.usage?.settlementState === 'unconfirmed', 'Consumption record is not presented as a confirmed funds settlement')
    check(terminal.provider.chat === accepted.provider.chat && terminal.provider.image === accepted.provider.image, 'Continuing the paused request added no new model call')
    const reservations = terminal.studio.reservations.filter(row => row.key === report.runId)
    check(reservations.length === 1 + expectedImage && reservations.every(row => row.status === 'used'), 'Known complete local request has its exact chat/image reservations and no held usage')
    const newLogs = terminal.native.logs.filter(row => row.type === 2 && !before.native.logs.some(old => old.id === row.id))
    check(newLogs.length === expectedChat + expectedImage && new Set(newLogs.map(row => row.request_id)).size === newLogs.length
      && terminalRun.usage?.state === 'recorded' && terminalRun.usage.requestIds?.length === newLogs.length && terminalRun.usage.requestIds.every(id => newLogs.some(log => log.request_id === id)), 'Completed run maps its exact owner Native consumption records without claiming settlement')
    const recoveryStart = report.browserRequests.length
    report.stage = 'online-get-recovery'; await persist(); await context.setOffline(false)
    await ui(() => page.getByRole('button', { name: '刷新任务记录', exact: true }).click())
    await ui(() => expect(page.getByText(front + back, { exact: true })).toBeVisible())
    if (scenario === 'image') check(digest(Buffer.from((await page.getByAltText('生成图片').getAttribute('src')).split(',')[1], 'base64')) === report.originalPngSha256, 'Recovery renders the same original PNG bytes')
    await ui(() => Promise.all(responseTasks))
    check(report.historyReads?.some(read => read.status === 200 && read.runIds.some(run => run.runId === report.runId && run.status === 'completed')), 'First manual online GET rendered the complete original saved run')
    report.manualGetRecoveredAt = new Date().toISOString()
    await screenshot('restored'); report.stage = 'full-reload-cookie-recovery'; await persist(); await ui(() => page.reload())
    await ui(() => expect(page.getByText(front + back, { exact: true })).toBeVisible())
    if (scenario === 'image') check(digest(Buffer.from((await page.getByAltText('生成图片').getAttribute('src')).split(',')[1], 'base64')) === report.originalPngSha256, 'Full reload preserves the same original PNG bytes')
    await Promise.all(responseTasks)
    const restored = await snapshot('after-get-and-reload')
    check(report.browserRequests.slice(recoveryStart).filter(row => row.path.startsWith('/api/studio/') && row.method !== 'GET').length === 0, 'Online recovery and reload only read business APIs')
    check(modelPosts().length === 1 && report.historyReads.some(read => read.status === 200 && read.runIds.some(run => run.runId === report.runId && run.status === 'completed')), 'Actual GET recovered the original completed runId without a second send')
    check(restored.native.monetaryHash === terminal.native.monetaryHash && digest(JSON.stringify(restored.native.account)) === digest(JSON.stringify(terminal.native.account)) && restored.studio.dataHash === terminal.studio.dataHash
      && digest(JSON.stringify(restored.provider)) === digest(JSON.stringify(terminal.provider)), 'GET recovery did not alter Native money, Studio data, held state or provider counts')
    check(!report.rateLimited, 'No rate-limit response was counted as successful recovery')
    report.state = 'passed'; report.completedAt = new Date().toISOString(); await screenshot('reloaded'); await persist()
    console.log(JSON.stringify({ report: reportPath, state: report.state, scenario, runId: report.runId, realPaidProviderCalls: 0, procurementCost: 0 }))
  } catch (error) {
    report.state = report.rateLimited ? 'blocked-rate-limit' : 'failed'
    report.failureDiagnostic = failureDiagnostic(error, report.failedCheck)
    report.reason = 'Acceptance stopped at the recorded stage; no model replay, financial mutation or retry performed'
    if (controlArmed || resume) try { await snapshot(resume ? 'failed-readonly-resume-observation' : 'failed-before-supplier-release') } catch { report.failureReadOnlySnapshotUnavailable = true }
    if (safeScreenshot) try { await screenshot('failed') } catch {}
    await persist(); console.error(JSON.stringify({ report: reportPath, state: report.state, stage: report.stage, reason: report.reason })); process.exitCode = 1
  } finally {
    // Release only the already accepted local supplier request. A failed UI
    // assertion must not leave it paused; this never creates a new request.
    if (controlArmed && !providerReleased) try {
      await control('continue'); report.cleanupContinuedOriginalSupplier = true
      report.cleanupMeaning = 'Original accepted supplier work was released after UI failure; backend may complete and synthetic Native funds/usage may change. No model was resubmitted.'
      await pause(300); await snapshot('failure-cleanup-readonly-observation'); await persist()
    } catch {}
    if (context) { try { await context.setOffline(false) } catch {}; await context.close() }
    if (browser) await browser.close()
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const input = await validateOfflineInputs(process.argv.slice(2))
    if (input.validateOnly) console.log(JSON.stringify({ state: 'scope-validated-only', origin: input.state.origin, scenario: input.scenario, nativeOperations: 0, browserOperations: 0 }))
    else await run(input)
  } catch { console.error('Offline acceptance scope rejected before Native/HTTP/browser operations; required local fixture inputs or confirmation are invalid'); process.exitCode = 1 }
}
