// B3-N2 opt-in real UI + fixed Native + synthetic ordinary accounts only.
// node tests/stack/browser-image-jobs-native.cases.mjs --state .local/.../state.json
// --identity .local/...json --foreign-identity .local/...json --report .local/...json
// --confirm-isolated-native [--validate-only]
// A fresh owner sends ONCE. The local image supplier holds that original job;
// page close never cancels the server, and recovery uses only the original GET.
// No setup, real supplier, secret export, bucket reset, retries or service changes.
import assert from 'node:assert/strict'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { inputs as jobInputs, jobSummary, validateOriginalJob, validateReadOnly } from './image-jobs-native.cases.mjs'
import { sourceCommit, binarySha256, loginDiagnostic, selfDiagnostic, failureDiagnostic, rateLimitDiagnostic } from './browser-offline-native.cases.mjs'

const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex')
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const pause = ms => new Promise(done => setTimeout(done, ms))
export function processStartTicks(value) {
  if (typeof value !== 'string' || value.length > 65536) throw new Error('API process start-time observation invalid')
  const fields = /^[1-9]\d* \(.*\) ([^\r\n]+)$/.exec(value.trim())?.[1].split(/\s+/)
  // Captured field 3 is state (index 0), hence field 22 is index 19.
  if (!fields || !/^[A-Za-z]$/.test(fields[0]) || !/^\d{1,40}$/.test(fields[19] ?? '')) throw new Error('API process start-time observation invalid')
  return fields[19]
}
export async function inputs(args, localRoot) {
  assert.ok(!args.some(arg => ['--resume-completed', '--login-only', '--lose-response', '--check-failed-refresh', '--scenario'].includes(arg)), 'One fresh image-job UI case only')
  assert.ok(args.filter(arg => arg === '--validate-only').length <= 1, 'Repeated validate-only rejected')
  const input = await jobInputs(args.filter(arg => arg !== '--validate-only'), localRoot)
  const compose = JSON.parse((await readFile(input.state.compose, 'utf8')).replace(/^\uFEFF/, ''))
  assert.equal(compose.services['studio-api'].environment.GOUO_ENABLE_IMAGE_JOBS, 'true', 'Approved persistent image jobs must be enabled')
  assert.equal(compose.services['fixture-provider'].environment?.GOUO_ACCOUNT_INSTANCE_ID, input.state.instanceId, 'Image control supplier must be bound to the original instance UUID')
  return { ...input, validateOnly: args.includes('--validate-only') }
}
export function validatePersistence(proof, post, owner, canvasId) {
  assert.ok(uuid(post.jobId) && post.sameKey && post.model === 'fixture-image' && post.inputImages === 0 && post.syntheticPrompt, 'Original UI send must use its UUID and approved local model')
  assert.ok(proof && proof.mode === 'job' && proof.jobId === post.jobId && proof.requestId === post.jobId
    && proof.owner === 'local:' + owner && proof.canvasId === canvasId && proof.parametersHash === post.parametersHash
    && Number.isSafeInteger(proof.sequence) && Number.isSafeInteger(post.fetchSequence) && proof.sequence < post.fetchSequence
    && post.commitPresentAtFetch === true && post.fetchParametersHash === post.parametersHash, 'Same browser event order proves exact IDB completion before the original fetch call')
  return { ...proof }
}
export function validateHeld(before, held, key, tag) {
  assert.equal(before.studio.requests.length, 0)
  assert.equal(held.studio.jobs.length, 1); assert.equal(held.studio.jobs[0].key, key)
  assert.equal(held.studio.jobs[0].status, 'submission_started')
  assert.equal(held.studio.submissions.length, 1); assert.equal(held.studio.submissions[0].model_kind, 'image'); assert.equal(held.studio.submissions[0].key, key)
  assert.equal(held.studio.assets.length, 0); assert.equal(held.studio.stagingCount, 0)
  assert.deepEqual(held.studio.jobReservations.map(row => ({ key: row.key, status: row.status })), [{ key, status: 'held' }])
  assert.deepEqual(held.studio.reservations.map(row => ({ key: row.key, benefit: row.benefit, status: row.status })), [{ key, benefit: 'image', status: 'reserved' }])
  assert.equal(held.provider.image, before.provider.image + 1); assert.equal(held.provider.chat, before.provider.chat)
  const requests = held.provider.requests.filter(row => row.roleTag === tag)
  assert.equal(requests.length, 1); assert.equal(requests[0].kind, 'image'); assert.equal(requests[0].outcome, 'waiting-image-control')
}
export function validateBrowserRecovery(requests, key, recoveryIndex) {
  const business = requests.filter(row => row.path.startsWith('/api/studio/'))
  const posts = business.filter(row => row.method !== 'GET')
  assert.equal(posts.length, 1, 'Only one business send, no sync fallback, finalize, reauthorization or replay')
  assert.equal(posts[0].method, 'POST'); assert.equal(posts[0].path, '/api/studio/image-jobs'); assert.equal(posts[0].jobId, key)
  const reads = business.filter(row => row.path.startsWith('/api/studio/image-jobs/'))
  assert.ok(reads.length > 0 && reads.every(row => row.method === 'GET' && row.path === '/api/studio/image-jobs/' + key), 'Every task read uses the original ID')
  assert.ok(requests.slice(recoveryIndex).filter(row => row.path.startsWith('/api/studio/')).every(row => row.method === 'GET'), 'New-tab recovery only reads business data')
  return { originalPosts: 1, originalJobGetCount: reads.length, recoveryBusinessWrites: 0, syncFallbackPosts: 0 }
}
export function sceneSummary(scene, owner, canvasId, tag) {
  assert.ok(scene && scene.canvasId === canvasId)
  const elements = scene.elements.filter(element => !element.isDeleted)
  const placeholders = elements.filter(element => element.customData?.type === 'image-generator').map(element => {
    const data = element.customData
    return { elementId: element.id, x: element.x, y: element.y, width: element.width, height: element.height,
      mode: data.executionMode ?? null, jobId: data.jobId ?? null, requestId: data.requestId ?? null, owner: data.requestOwner ?? null,
      status: data.status, jobStatus: data.jobStatus ?? null, parametersHash: data.requestParameters ? hash(data.requestParameters) : null,
      syntheticPrompt: data.requestParameters?.prompt === tag + ' 本地验收受控图片 · 采购成本0', model: data.requestParameters?.model ?? null }
  })
  const images = elements.filter(element => element.type === 'image').map(element => {
    const data = element.customData, file = scene.files[element.fileId]
    assert.ok(data?.type === 'image-job-result' && uuid(data.jobId) && data.requestOwner === 'local:' + owner && uuid(data.assetId), 'Canvas result must carry the original private job/owner/asset')
    assert.match(file?.dataURL ?? '', /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    return { jobId: data.jobId, assetId: data.assetId, owner: data.requestOwner, imageSha256: hash(Buffer.from(file.dataURL.split(',')[1], 'base64')) }
  })
  return { canvasId, placeholders, images, appState: { scrollX: scene.appState?.scrollX ?? 0, scrollY: scene.appState?.scrollY ?? 0, zoom: scene.appState?.zoom?.value ?? 1 } }
}
async function run(input) {
  const { state, account, foreignAccount, reportPath, controlDirectory } = input
  const tag = 'B3N2-' + randomBytes(8).toString('hex'), canvasId = tag.toLowerCase(), canvasPath = '/studio/canvas?id=' + canvasId
  const controlPath = join(controlDirectory, 'image-job-control.json'), expectedPrompt = tag + ' 本地验收受控图片 · 采购成本0'
  const report = { version: 1, state: 'started', stage: 'live-scope-check', origin: state.origin, project: state.project, instanceId: state.instanceId,
    sourceCommit, binarySha256, owner: account.owner, foreignOwner: foreignAccount.owner, tag, canvasId,
    evidence: { F: 'explicit controlled local supplier', N: 'fixed Native, real UI, ordinary synthetic account and funds', P: 'not executed' },
    realPaidProviderCalls: 0, procurementCost: 0, secretsExcluded: true, noModelRetry: true,
    startedAt: new Date().toISOString(), browserRequests: [], requests: [], snapshots: [], scenes: [], screenshots: [], assertions: [] }
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
  const check = (condition, label) => { if (!condition) report.failedCheck = label; assert.ok(condition, label); report.assertions.push(label) }
  function docker(service, code, binary = false) {
    return new Promise((done, reject) => {
      const args = ['compose', '--env-file', state.env, '-p', state.project, '-f', state.compose, 'exec', '-T', service,
        ...(binary ? ['sha256sum', '/usr/local/bin/new-api'] : ['node', '--input-type=module', '-e', code])]
      const child = spawn(process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Read-only fixture observation timed out')) }, 15000)
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 4 * 1024 * 1024) child.kill() })
      child.on('error', () => { clearTimeout(timer); reject(new Error('Read-only fixture observation failed')) })
      child.on('exit', code => { clearTimeout(timer); code === 0 ? done(output.trim()) : reject(new Error('Read-only fixture observation failed')) })
    })
  }
  const nativeCode = "import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';const db=new DatabaseSync('/data/new-api.db',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');const owner=" + account.owner + ";const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');const tables=['tokens','user_subscriptions','subscription_pre_consume_records','logs'];console.log(JSON.stringify({protectedHash:hash([tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]),db.prepare('SELECT id,quota,used_quota,request_count,status FROM users ORDER BY id').all()]),account:db.prepare('SELECT id,username,role,status FROM users WHERE id=?').get(owner),channels:db.prepare('SELECT type,status,base_url,key FROM channels').all().map(c=>({localOnly:c.type===1&&c.status===1&&c.base_url==='http://fixture-provider:19000'&&c.key==='fixture-provider-zero-procurement-cost'})),logs:db.prepare('SELECT id,user_id,type,quota,request_id FROM logs WHERE user_id=? AND type=2 ORDER BY id').all(owner)}));db.close()"
  const studioCode = "import{DatabaseSync}from'node:sqlite';import{createHash}from'node:crypto';import{readFileSync}from'node:fs';const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');const owner=" + account.owner + ";const hash=v=>createHash('sha256').update(v instanceof Uint8Array?v:JSON.stringify(v)).digest('hex');const tables=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all().map(r=>r.name);console.log(JSON.stringify({dataHash:hash(tables.map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()])),processStartTicks:(" + processStartTicks.toString() + ")(readFileSync('/proc/1/stat','utf8')),requests:db.prepare('SELECT kind,key,status FROM requests WHERE owner=? ORDER BY rowid').all(owner),jobs:db.prepare('SELECT key,status,native_pending,asset_id FROM image_jobs WHERE owner=? ORDER BY rowid').all(owner),submissions:db.prepare('SELECT key,attempt,model_kind,funding_source FROM model_submissions WHERE owner=? ORDER BY rowid').all(owner),stagingCount:db.prepare('SELECT COUNT(*) AS n FROM image_job_staging WHERE owner=?').get(owner).n,assets:db.prepare('SELECT id,run_id,sha256,bytes FROM studio_assets WHERE owner=? ORDER BY rowid').all(owner).map(a=>({id:a.id,run_id:a.run_id,sha256:a.sha256,bytesSha256:hash(a.bytes)})),reservations:db.prepare('SELECT key,benefit,status FROM trial_reservations WHERE owner=? ORDER BY rowid').all(owner),jobReservations:db.prepare('SELECT key,status FROM image_job_reservations WHERE owner=? ORDER BY rowid').all(owner)}));db.close()"
  const providerObservation = () => docker('fixture-provider', "const r=await fetch('http://127.0.0.1:19000/stats');if(!r.ok)throw Error('Local stats unavailable');console.log(JSON.stringify(await r.json()))").then(JSON.parse)
  async function snapshot(stage) {
    // Actual local /stats avoids nonexistent or concurrently written files.
    // Never synthesize zero counters or create a supplier observation file.
    const [native, studio, provider] = await Promise.all([docker('new-api', nativeCode).then(JSON.parse), docker('studio-api', studioCode).then(JSON.parse), providerObservation()])
    const value = { stage, capturedAt: new Date().toISOString(), native, studio, provider }; report.snapshots.push(value); await persist(); return value
  }
  async function control(command) {
    assert.ok(['hold', 'continue'].includes(command))
    let file; try { file = JSON.parse(await readFile(controlPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; file = { version: 1, instanceId: state.instanceId, images: {} } }
    assert.ok(file.version === 1 && file.instanceId === state.instanceId && file.images && typeof file.images === 'object')
    file.images[tag] = { instanceId: state.instanceId, command }
    const temporary = controlPath + '.' + randomBytes(8).toString('hex') + '.tmp'
    await writeFile(temporary, JSON.stringify(file), { flag: 'wx', mode: 0o600 }); await rename(temporary, controlPath)
  }
  let browser, context, page, foreignContext, armed = false, released = false, safeScreenshot = false, token, foreignToken
  const tasks = [], origin = new URL(state.origin).origin
  let rejectRateLimit; const rateLimitStop = new Promise((_, reject) => { rejectRateLimit = reject }); rateLimitStop.catch(() => {})
  const ui = operation => { if (report.rateLimited) throw new Error('Observed 429; no automatic continuation'); return Promise.race([operation(), rateLimitStop]) }
  function rateLimit(method, path, headers) {
    report.rateLimited = true; report.state = 'blocked-rate-limit'; report.rateLimits ??= []
    report.rateLimits.push(rateLimitDiagnostic(method, path, headers)); rejectRateLimit(new Error('Observed 429; no automatic continuation'))
  }
  function observe(surface, identity) {
    surface.on('request', request => {
      const url = new URL(request.url()); if (url.origin !== origin || !url.pathname.startsWith('/api/')) return
      const row = { method: request.method(), path: url.pathname, owner: identity.owner, atMilliseconds: Date.now() }
      if (url.pathname === '/api/studio/image-jobs' && request.method() === 'POST') {
        const body = request.postDataJSON(), key = request.headers()['idempotency-key']
        Object.assign(row, { jobId: uuid(key) ? key : null, sameKey: uuid(key), model: body.model === 'fixture-image' ? body.model : 'excluded', inputImages: body.inputImages?.length,
          syntheticPrompt: body.prompt === expectedPrompt, parametersHash: hash(body) }); report.jobId ??= row.jobId
      }
      report.browserRequests.push(row)
    })
    surface.on('response', response => {
      const url = new URL(response.url()); if (url.origin !== origin || !url.pathname.startsWith('/api/')) return
      if (response.status() === 429) rateLimit(response.request().method(), url.pathname, response.headers())
      if (url.pathname === '/api/studio/image-jobs' || /^\/api\/studio\/image-jobs\/[a-f\d-]{36}$/.test(url.pathname)) tasks.push(response.json().then(body => {
        if (body.success === true) {
          const summary = jobSummary(body.data); report.jobResponses ??= []; report.jobResponses.push({ method: response.request().method(), path: url.pathname, httpStatus: response.status(), ...summary })
          if (response.request().method() === 'POST') { assert.equal(response.status(), 202); assert.equal(summary.status, 'accepted'); report.accepted = summary }
        }
      }).catch(error => {
        report.responseObservationFailures ??= []; const failure = failureDiagnostic(error)
        report.responseObservationFailures.push({ ...failure, method: response.request().method(), path: url.pathname, httpStatus: response.status(),
          acceptablePageCloseObservationLimit: surface.isClosed() && failure.classification === 'response-body-unavailable' && failure.knownResourceUnavailableMessage })
      }))
    })
    surface.on('requestfailed', request => {
      const url = new URL(request.url()); if (url.origin === origin && url.pathname.startsWith('/api/')) {
        const raw = request.failure()?.errorText; report.failedRequests ??= []
        report.failedRequests.push({ method: request.method(), path: url.pathname, error: /^net::ERR_[A-Z_]+$/.test(raw ?? '') ? raw : 'excluded' })
      }
    })
  }
  async function nativeUiLogin(surface, identity, expect) {
    observe(surface, identity)
    await ui(() => surface.goto(state.origin + '/sign-in?redirect=' + encodeURIComponent(canvasPath)))
    await ui(() => surface.locator('input[name="username"]').fill(identity.username)); await ui(() => surface.locator('input[name="password"]').fill(identity.password))
    const selfRead = surface.waitForResponse(response => new URL(response.url()).pathname === '/api/user/self' && response.request().method() === 'GET'
      && response.status() === 200 && new URL(surface.url()).pathname === '/studio/canvas').then(async response => {
      const body = await response.json(), auth = response.request().headers().authorization ?? ''
      const diagnostic = selfDiagnostic(response.status(), body, /^Bearer [^\r\n]+$/i.test(auth))
      assert.ok(diagnostic.success && diagnostic.user.id === identity.owner && diagnostic.user.role === 1 && diagnostic.user.status === 1 && diagnostic.bearerPresent)
      report.identities ??= []; report.identities.push({ owner: identity.owner, source: 'New API /api/user/self after native cookie login', ...diagnostic })
      return auth.slice(7)
    }).then(value => ({ value }), error => ({ error }))
    const loginRead = surface.waitForResponse(response => new URL(response.url()).pathname === '/api/user/login' && response.request().method() === 'POST').then(async response => {
      const intent = response.request().postDataJSON(), diagnostic = loginDiagnostic(response.status(), null, intent)
      report.login ??= []; report.login.push({ owner: identity.owner, ...diagnostic })
      assert.equal(response.status(), 200); assert.ok(diagnostic.encryptedPasswordPresent && !diagnostic.plaintextPasswordFieldPresent)
      const body = await response.json().then(value => value, error => { report.loginBodyObservation ??= []; report.loginBodyObservation.push(failureDiagnostic(error)); return null })
      assert.ok(body === null || body.success === true)
    })
    await ui(() => Promise.all([loginRead, surface.locator('form button[type="submit"]').click()]))
    await ui(() => expect(surface).toHaveURL(state.origin + canvasPath))
    const authenticated = await ui(() => selfRead); if (authenticated.error) throw new Error('Authenticated ordinary self proof unavailable')
    await ui(() => expect(surface.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled())
    return authenticated.value
  }
  async function rawScene(surface) {
    return surface.evaluate(({ owner, canvasId }) => new Promise((done, reject) => {
      const open = indexedDB.open('keyval-store'); open.onerror = () => reject(new Error('IDB observation unavailable'))
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction('keyval', 'readonly'), read = transaction.objectStore('keyval').get('gouo:loomic:v1:local:' + owner + ':' + canvasId)
        read.onsuccess = () => { const content = read.result?.canvas?.content; done(content ? { canvasId, ...content } : null) }; read.onerror = () => reject(new Error('IDB observation unavailable')); transaction.oncomplete = () => db.close()
      }
    }), { owner: account.owner, canvasId })
  }
  async function scene(stage) { const value = sceneSummary(await ui(() => rawScene(page)), account.owner, canvasId, tag); report.scenes.push({ stage, ...value }); await persist(); return value }
  async function screenshot(stage) { if (!safeScreenshot || page.isClosed()) return; const path = join(dirname(reportPath), tag + '-' + stage + '.png'); await page.screenshot({ path, fullPage: true }); report.screenshots.push({ stage, path }); await persist() }
  async function until(operation, label, timeout = 20000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { const result = await ui(operation); if (result) return result; await pause(150) } throw new Error(label) }
  async function get(path, bearer, expected) {
    if (report.rateLimited) throw new Error('Observed 429; no subsequent HTTP continuation')
    const response = await fetch(state.origin + path, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Origin: state.origin, ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) } })
    report.requests.push({ method: 'GET', path, status: response.status, identity: bearer === foreignToken ? 'foreign' : bearer ? 'owner' : 'anonymous' })
    if (response.status === 429) { rateLimit('GET', path, Object.fromEntries(response.headers)); throw new Error('Observed 429') }
    assert.equal(response.status, expected); const body = await response.json(); assert.equal(body.success, expected < 400)
    return body.data
  }
  try {
    check((await docker('new-api', '', true)).split(/\s+/)[0] === binarySha256, 'Actual Native binary equals the fixed approved version')
    const before = await snapshot('before-generation')
    check(before.native.account?.id === account.owner && before.native.account.username === account.username && before.native.account.role === 1 && before.native.account.status === 1, 'Prepared synthetic owner is enabled ordinary account')
    check(before.native.channels.length > 0 && before.native.channels.every(row => row.localOnly), 'All actual Native channels are explicit local suppliers')
    check(before.provider.imageControl?.version === 1 && before.provider.imageControl.instanceId === state.instanceId, 'Running local supplier loaded the controlled image fixture for the same instance before generation')
    check(before.studio.requests.length === 0 && before.studio.jobs.length === 0 && before.studio.assets.length === 0 && before.studio.reservations.length === 0, 'Fresh ordinary owner has zero original requests, jobs, assets or reservations')
    const { chromium, expect } = await import('@playwright/test')
    browser = await chromium.launch({ headless: true }); context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); page = await context.newPage(); page.setDefaultTimeout(15000)
    // Observe actual IDB completion and the same realm's original fetch call.
    // Native methods execute immediately with unmodified values/arguments;
    // this records causal order, never routes, delays or mocks HTTP responses.
    await page.addInitScript(({ owner, canvasId }) => {
      window.__n2Commits = []; window.__n2Fetches = []; window.__n2Sequence = 0
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function(value, key) {
        const result = put.call(this, value, key)
        if (key === 'gouo:loomic:v1:local:' + owner + ':' + canvasId && value?.canvas?.content) {
          const rows = value.canvas.content.elements.filter(element => !element.isDeleted && element.customData?.executionMode === 'job').map(element => {
            const data = element.customData; return { jobId: data.jobId, requestId: data.requestId, mode: data.executionMode, owner: data.requestOwner, canvasId, parameters: JSON.stringify(data.requestParameters) }
          })
          this.transaction.addEventListener('complete', () => { for (const row of rows) window.__n2Commits.push({ ...row, sequence: ++window.__n2Sequence, completedAt: performance.now() }) }, { once: true })
        }
        return result
      }
      const fetch = window.fetch
      window.fetch = function(...args) {
        const [input, init] = args, url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href)
        if (url.origin === location.origin && url.pathname === '/api/studio/image-jobs' && (init?.method ?? input?.method ?? 'GET').toUpperCase() === 'POST') {
          const jobId = new Headers(init?.headers ?? input?.headers).get('Idempotency-Key')
          window.__n2Fetches.push({ jobId, sequence: ++window.__n2Sequence, parameters: typeof init?.body === 'string' ? init.body : null,
            commitPresentAtFetch: window.__n2Commits.some(row => row.jobId === jobId), calledAt: performance.now() })
        }
        return Reflect.apply(fetch, this, args)
      }
    }, { owner: account.owner, canvasId })
    report.stage = 'ordinary-native-ui-login'; await persist(); token = await nativeUiLogin(page, account, expect); safeScreenshot = true
    const catalog = await get('/api/studio/models', token, 200)
    check(catalog.generationEnabled === true && catalog.imageJobsEnabled === true && catalog.models.some(model => model.id === 'fixture-image' && model.kind === 'image' && model.accessible === true), 'Actual catalog approves the configured persistent local image model')
    const imageModel = catalog.models.find(model => model.kind === 'image' && model.accessible === true)
    check(imageModel.id === 'fixture-image', 'Fresh UI default is the approved local image model before any POST')
    report.stage = 'unique-ui-image-send'; await persist(); await control('hold'); armed = true
    await ui(() => page.getByRole('button', { name: 'AI 生成图片', exact: true }).click())
    await ui(() => page.getByPlaceholder('今天我们要创作什么', { exact: true }).fill(expectedPrompt))
    await ui(() => expect(page.getByRole('button', { name: imageModel.displayName, exact: true })).toBeVisible())
    await ui(() => expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled())
    await ui(() => page.getByRole('button', { name: '生成图片', exact: true }).click())
    await until(async () => { await Promise.allSettled(tasks); return report.accepted }, 'Original UI 202 acceptance was not observed')
    const post = report.browserRequests.find(row => row.path === '/api/studio/image-jobs' && row.method === 'POST')
    const observations = await ui(() => page.evaluate(() => ({ commits: window.__n2Commits, fetches: window.__n2Fetches })))
    const originalFetch = observations.fetches.find(row => row.jobId === report.jobId)
    Object.assign(post, { fetchSequence: originalFetch?.sequence, commitPresentAtFetch: originalFetch?.commitPresentAtFetch,
      fetchParametersHash: originalFetch?.parameters ? hash(JSON.parse(originalFetch.parameters)) : null })
    const commit = observations.commits.find(row => row.jobId === report.jobId && row.sequence < post.fetchSequence)
    report.persistence = validatePersistence(commit ? { ...commit, parametersHash: hash(JSON.parse(commit.parameters)), parameters: undefined } : null, post, account.owner, canvasId)
    check(report.accepted.jobId === report.jobId && report.accepted.status === 'accepted', 'Actual UI received 202 for the persisted original UUID')
    await until(async () => (await providerObservation()).requests.some(row => row.roleTag === tag && row.outcome === 'waiting-image-control'), 'Local supplier did not reach the explicit image hold')
    const held = await snapshot('accepted-provider-held'); validateHeld(before, held, report.jobId, tag)
    const pendingScene = await scene('accepted-persisted-before-close')
    check(pendingScene.placeholders.length === 1 && pendingScene.placeholders[0].jobId === report.jobId && pendingScene.placeholders[0].owner === 'local:' + account.owner && pendingScene.placeholders[0].parametersHash === post.parametersHash, 'The actual original placeholder remains persisted while supplier is held')
    await screenshot('accepted-held'); report.stage = 'original-page-close'; await persist()
    await page.close(); report.originalPageClosedAt = new Date().toISOString()
    const closed = await snapshot('page-closed-provider-held'); validateHeld(before, closed, report.jobId, tag)
    check(closed.studio.processStartTicks === held.studio.processStartTicks, 'Page close kept the original API process running')
    await control('continue'); released = true; report.supplierReleasedAt = new Date().toISOString(); report.stage = 'original-backend-completion'; await persist()
    const completed = await until(async () => { const current = await snapshot('backend-completion-observation'); return current.studio.jobs[0]?.status === 'completed' ? current : null }, 'Original backend task did not complete; never send another POST')
    validateOriginalJob(before, completed)
    check(completed.studio.jobs[0].key === report.jobId && completed.studio.processStartTicks === held.studio.processStartTicks, 'The original job completed in the same API process')
    check(completed.studio.jobReservations.length === 1 && completed.studio.jobReservations[0].status === 'used' && completed.studio.reservations.length === 1 && completed.studio.reservations[0].status === 'used', 'Completion consumed only the original image reservation')
    const original = completed.studio.assets[0]; report.originalPngSha256 = original.sha256; report.assetId = original.id
    check(completed.provider.requests.filter(row => row.roleTag === tag).length === 1 && completed.provider.requests.find(row => row.roleTag === tag).outcome === 'completed' && completed.provider.requests.find(row => row.roleTag === tag).imageSha256 === original.sha256, 'One local image call produced the exact saved private PNG')
    const recoveryIndex = report.browserRequests.length; report.stage = 'new-tab-cookie-original-get'; await persist()
    page = await context.newPage(); page.setDefaultTimeout(15000); observe(page, account)
    const newSelf = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user/self' && response.status() === 200).then(async response => {
      const body = await response.json(), auth = response.request().headers().authorization ?? ''
      return selfDiagnostic(response.status(), body, /^Bearer [^\r\n]+$/i.test(auth))
    }).then(value => ({ value }), error => ({ error }))
    await ui(() => page.goto(state.origin + canvasPath)); await ui(() => expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled())
    const recoveredSelf = await ui(() => newSelf); check(!recoveredSelf.error, 'New-tab authenticated self response remains observable')
    report.newTabIdentity = recoveredSelf.value
    check(report.newTabIdentity.success && report.newTabIdentity.user.id === account.owner && report.newTabIdentity.user.role === 1 && report.newTabIdentity.user.status === 1 && report.newTabIdentity.bearerPresent, 'A new tab recovered the same enabled ordinary owner through the HttpOnly cookie')
    const reopened = await scene('new-tab-original-placeholder')
    check(reopened.placeholders.length === 1 && reopened.placeholders[0].jobId === report.jobId && reopened.placeholders[0].mode === 'job' && reopened.placeholders[0].parametersHash === post.parametersHash, 'New tab recovered the original mode, UUID and parameters in the same canvas')
    // A real offline GET is the negative read path. It cannot alter Native or
    // retry POST; online recovery reads this same ID and inserts its saved PNG.
    await context.setOffline(true); check(await page.evaluate(() => navigator.onLine) === false, 'New-tab browser is actually offline for the original GET failure')
    const box = await ui(() => page.locator('.excalidraw .interactive').boundingBox()), placeholder = reopened.placeholders[0], stateView = reopened.appState
    await ui(() => page.mouse.click(box.x + (placeholder.x + placeholder.width / 2 + stateView.scrollX) * stateView.zoom, box.y + (placeholder.y + placeholder.height / 2 + stateView.scrollY) * stateView.zoom))
    await ui(() => expect(page.getByText(/读取或加入画布失败，原请求 ID 和已有结果保留；未重新生成/)).toBeVisible())
    check(report.failedRequests?.some(row => row.method === 'GET' && row.path === '/api/studio/image-jobs/' + report.jobId && /^net::ERR_/.test(row.error)), 'Actual browser transport rejected the offline original-job GET')
    const failedRead = await scene('offline-get-preserves-original')
    check(failedRead.placeholders.length === 1 && failedRead.placeholders[0].jobId === report.jobId && failedRead.images.length === 0, 'Failed GET preserved the original placeholder and did not invent an image')
    await screenshot('offline-read'); await context.setOffline(false)
    await until(async () => { const raw = await rawScene(page); if (!raw) return false; const summary = sceneSummary(raw, account.owner, canvasId, tag); return summary.images.length === 1 ? summary : false }, 'Online same-ID GET did not insert the original saved image')
    const inserted = await scene('restored-original-image')
    check(inserted.placeholders.length === 0 && inserted.images.length === 1 && inserted.images[0].jobId === report.jobId && inserted.images[0].assetId === original.id && inserted.images[0].imageSha256 === original.sha256, 'Online read inserted the exact original PNG and asset once')
    await Promise.allSettled(tasks)
    check((report.responseObservationFailures ?? []).every(failure => failure.acceptablePageCloseObservationLimit), 'Every observed task DTO is valid; only an actual closed-page body limitation is retained')
    check(report.jobResponses.some(row => row.method === 'GET' && row.jobId === report.jobId && row.status === 'completed' && row.imageSha256 === original.sha256), 'Actual UI GET returned the original completed job and exact PNG')
    await screenshot('restored'); report.stage = 'canvas-download-and-reload'; await persist()
    await ui(() => page.getByRole('button', { name: '菜单', exact: true }).click())
    const downloaded = page.waitForEvent('download').then(value => ({ value }), error => ({ error })); await ui(() => page.getByRole('menuitem', { name: '导出画布文件', exact: true }).click())
    const download = await ui(() => downloaded); check(!download.error, 'Actual canvas export download completed')
    const exportPath = await download.value.path(), exported = JSON.parse(await readFile(exportPath, 'utf8'))
    const exportSummary = sceneSummary({ canvasId, ...exported }, account.owner, canvasId, tag)
    check(exportSummary.images.length === 1 && exportSummary.images[0].imageSha256 === original.sha256, 'Downloaded canvas contains the exact original PNG once')
    report.download = { format: 'excalidraw', originalPngSha256: original.sha256, imageCount: 1, temporaryPathExcluded: true }
    await ui(() => page.reload()); await ui(() => expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled())
    const reloaded = await scene('reload-original-image')
    check(reloaded.images.length === 1 && reloaded.images[0].imageSha256 === original.sha256 && reloaded.placeholders.length === 0, 'Full reload preserved one exact image without a second generation')
    validateReadOnly(completed, await snapshot('recovery-readonly-proof'))
    report.browserRecovery = validateBrowserRecovery(report.browserRequests, report.jobId, recoveryIndex)
    report.stage = 'independent-read-authorization'; await persist()
    foreignContext = await browser.newContext(); const foreignPage = await foreignContext.newPage(); foreignPage.setDefaultTimeout(15000)
    foreignToken = await nativeUiLogin(foreignPage, foreignAccount, expect)
    const authBefore = await snapshot('before-read-authorization')
    const asset = await get('/api/studio/assets/' + original.id, token, 200)
    check(asset.sha256 === original.sha256 && hash(Buffer.from(asset.dataURL.split(',')[1], 'base64')) === original.sha256, 'Owner asset GET returned the exact private original')
    for (const path of ['/api/studio/image-jobs/' + report.jobId, '/api/studio/assets/' + original.id]) { await get(path, foreignToken, 404); await get(path, undefined, 401) }
    validateReadOnly(authBefore, await snapshot('authorization-readonly-proof'))
    await Promise.allSettled(tasks)
    check((report.responseObservationFailures ?? []).every(failure => failure.acceptablePageCloseObservationLimit), 'Final response observations contain no masked invalid task DTO')
    report.browserRecovery = validateBrowserRecovery(report.browserRequests, report.jobId, recoveryIndex)
    report.state = 'passed'; report.stage = 'completed'; report.completedAt = new Date().toISOString(); await screenshot('reloaded'); await persist()
    console.log(JSON.stringify({ state: report.state, report: reportPath, jobId: report.jobId, originalPngSha256: original.sha256, providerImageDelta: 1, providerChatDelta: 0, realPaidProviderCalls: 0 }))
  } catch (error) {
    if (!report.rateLimited) report.state = 'failed'
    report.failure = failureDiagnostic(error, report.failedCheck ?? 'B3-N2 stage ' + report.stage); report.noRetryAfterFailure = true
    try { await snapshot('failure-readonly-observation') } catch { report.failureSnapshotUnavailable = true }
    try { await screenshot('failed') } catch {}
    await persist(); console.error(JSON.stringify({ state: report.state, stage: report.stage, failure: report.failure, report: reportPath, originalPostMayHaveCompleted: !!report.jobId })); process.exitCode = 1
  } finally {
    if (armed && !released && report.jobId) try {
      const provider = await providerObservation()
      if (provider.requests.some(row => row.roleTag === tag && row.kind === 'image' && ['started', 'waiting-image-control'].includes(row.outcome))) {
        await control('continue'); report.cleanup = { continuedOnlyOriginalAcceptedSupplier: true, newModelSubmission: false, backendMayCompleteAfterFailure: true }; await persist()
      }
    } catch { report.cleanup = { originalReleaseUnavailable: true, noModelReplay: true }; await persist() }
    await Promise.allSettled(tasks)
    if (foreignContext) await foreignContext.close()
    if (context) { try { await context.setOffline(false) } catch {}; await context.close() }
    if (browser) await browser.close()
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const input = await inputs(process.argv.slice(2))
    if (input.validateOnly) console.log(JSON.stringify({ state: 'scope-validated-only', origin: input.state.origin, scenario: 'image-job-ui-close-recovery', nativeOperations: 0, browserOperations: 0, modelSubmissions: 0 }))
    else await run(input)
  } catch { console.error('Image job browser acceptance scope rejected before Native/HTTP/browser operations; preserve inputs and reports'); process.exitCode = 1 }
}
