import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

// F only: actual React + IndexedDB + HTTP boundaries, with deterministic local
// responses. No Native/provider/paid model or background Worker is simulated.
const canvasId = 'image-job-fixture', at = '2026-10-02T00:00:00.000Z'
const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#79b7d2' } }).png().toBuffer()
const image = { url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32, prompt: 'job 原图 fixture' }
const assetId = '72007e63-e55b-405a-a05f-906b05c8f5c0'
const models = [{ id: 'fixture-image', displayName: '图片任务 fixture', kind: 'image', accessible: true, provider: 'Fixture', qualities: [], aspectRatios: [], operations: ['generate'] }]
const liveImages = scene => scene.elements.filter(element => !element.isDeleted && element.type === 'image')
const envelope = data => ({ success: true, data })
const summary = (id, status, complete = false) => ({ kind: 'image', jobId: id, requestId: id, status, createdAt: at, updatedAt: at,
  ...(status === 'completed' || status === 'output_saved' ? { assetId } : {}), ...(complete ? { result: image } : {}) })
async function draft(page) {
  return page.evaluate(async id => (await import('/studio/src/loomic/lib/local-drafts.ts')).readDraft('local:7', id), canvasId)
}
async function exportScene(page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出画布文件', exact: true }).click()
  return JSON.parse(await readFile(await (await download).path(), 'utf8'))
}
async function setup(page, state = {}) {
  const account = await mockAccount(page); account.active = true
  const fixture = { enabled: true, status: 'unknown', creates: 0, sync: 0, reads: [], actions: [], ...state, account }
  for (const endpoint of ['trial', 'access']) await page.route(`**/api/studio/${endpoint}`, route => route.fulfill({ status: 503, json: { success: false, message: 'fixture 不提供领取或续用' } }))
  await page.route('**/api/studio/models', route => route.fulfill({ json: envelope({ generationEnabled: true, imageJobsEnabled: fixture.enabled, models }) }))
  await page.route('**/api/studio/images', route => { fixture.sync++; return route.abort() })
  await page.route('**/api/studio/image-jobs', async route => {
    fixture.creates++; fixture.id = route.request().headers()['idempotency-key']; fixture.payload = route.request().postDataJSON()
    const stored = (await draft(page)).canvas.content.elements.find(element => element.customData?.jobId === fixture.id)
    expect(stored.customData.executionMode).toBe('job'); expect(stored.customData.requestId).toBe(fixture.id); expect(stored.customData.requestOwner).toBe('local:7')
    expect(stored.customData.requestParameters).toEqual(fixture.payload)
    expect(JSON.stringify(stored.customData)).not.toContain('test-refresh-token')
    if (fixture.postError) return route.fulfill({ status: 503, json: { success: false, message: 'fixture 202 响应不明' } })
    return route.fulfill({ status: 202, json: envelope(summary(fixture.id, 'accepted')) })
  })
  await page.route('**/api/studio/image-jobs/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET') {
      fixture.reads.push({ path, authorization: route.request().headers().authorization })
      if (fixture.gate) await fixture.gate
      if (fixture.getError) return route.fulfill({ status: 503, json: { success: false, message: 'fixture 原任务只读不可用' } }).catch(() => {})
      const value = summary(fixture.id, fixture.status, fixture.status === 'completed')
      if (fixture.legacyGeometry && value.result) value.result = { url: image.url, prompt: image.prompt }
      return route.fulfill({ json: envelope(value) }).catch(() => {})
    }
    fixture.actions.push({ path, body: route.request().postDataJSON() })
    const action = path.split('/').at(-1)
    if (action === 'authorize') { fixture.status = 'unknown'; return route.fulfill({ status: 202, json: envelope(summary(fixture.id, 'accepted')) }) }
    if (action === 'cancel') { fixture.status = 'cancelled_before_submission'; return route.fulfill({ json: envelope(summary(fixture.id, fixture.status)) }) }
    if (action === 'finalize') { fixture.status = 'completed'; return route.fulfill({ json: envelope(summary(fixture.id, 'completed')) }) }
    throw new Error('unexpected fixture job action')
  })
  await page.goto(`./canvas?id=${canvasId}`)
  await expect(page.getByRole('button', { name: 'AI 生成图片', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'AI 生成图片', exact: true }).click()
  await page.getByPlaceholder('今天我们要创作什么', { exact: true }).fill('原图片任务参数 fixture')
  await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeEnabled()
  return fixture
}
async function start(page) { await page.getByRole('button', { name: '生成图片', exact: true }).click() }
async function selectOriginal(page) {
  const scene = (await draft(page)).canvas.content, placeholder = scene.elements.find(element => element.customData?.type === 'image-generator')
  const box = await page.locator('.excalidraw .interactive').boundingBox(), state = scene.appState, zoom = state.zoom?.value ?? 1
  await page.mouse.click(box.x + (placeholder.x + placeholder.width / 2 + (state.scrollX ?? 0)) * zoom,
    box.y + (placeholder.y + placeholder.height / 2 + (state.scrollY ?? 0)) * zoom)
}

test('202 stores original mode/ID/parameters before POST; close/reload and flag-off read only original job, exact PNG inserts once', async ({ page }) => {
  const f = await setup(page); await start(page)
  await expect(page.getByRole('button', { name: '读取原图片任务', exact: true })).toBeEnabled()
  await expect.poll(() => f.reads.length).toBe(1)
  await page.getByRole('button', { name: '读取原图片任务', exact: true }).click(); await expect.poll(() => f.reads.length).toBe(2)
  await expect(page.getByRole('button', { name: '重新授权原图片任务', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '取消确定未提交任务', exact: true })).toHaveCount(0)
  const box = await page.locator('.excalidraw .interactive').boundingBox(); await page.mouse.click(box.x + 10, box.y + 100)
  await expect(page.getByPlaceholder('今天我们要创作什么', { exact: true })).toHaveCount(0)
  await selectOriginal(page); await expect.poll(() => f.reads.length).toBe(3)
  f.enabled = false; await page.reload(); await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await selectOriginal(page); await expect.poll(() => f.reads.length).toBe(4)
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(f.actions).toHaveLength(0)
  f.status = 'completed'; await page.getByRole('button', { name: '读取原图片任务', exact: true }).click()
  await expect(page.getByPlaceholder('今天我们要创作什么', { exact: true })).toHaveCount(0)
  await expect.poll(async () => liveImages((await draft(page)).canvas.content).length).toBe(1)
  const scene = await exportScene(page); expect(liveImages(scene)).toHaveLength(1)
  expect(Object.values(scene.files).map(file => file.dataURL)).toContain(image.url)
  expect(liveImages(scene)[0].customData.assetId).toBe(assetId)
  await page.reload(); await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  expect(liveImages(await exportScene(page))).toHaveLength(1)
  expect(f.reads.every(read => read.path === `/api/studio/image-jobs/${f.id}`)).toBe(true); expect(f.creates).toBe(1); expect(f.sync).toBe(0)
})

test('IDB completion wait holds zero POST and rapid duplicate Generate still produces one original job', async ({ page }) => {
  const f = await setup(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      const result = put.call(this, value, key)
      if (!window.fixtureHeld && value?.canvas?.content?.elements?.some(element => element.customData?.executionMode === 'job')) {
        this.transaction.addEventListener('complete', event => { event.stopImmediatePropagation(); const transaction = this.transaction; window.fixtureHeld = true; window.fixtureRelease = () => transaction.oncomplete?.call(transaction, event) }, { once: true, capture: true })
      }
      return result
    }
  })
  await page.getByRole('button', { name: '生成图片', exact: true }).evaluate(button => { button.click(); button.click() })
  await expect.poll(() => page.evaluate(() => window.fixtureHeld)).toBe(true)
  expect(f.creates).toBe(0); expect(f.sync).toBe(0)
  await page.evaluate(() => window.fixtureRelease()); await expect.poll(() => f.creates).toBe(1)
  await expect(page.getByRole('button', { name: '读取原图片任务', exact: true })).toBeEnabled()
  expect(f.creates).toBe(1); expect(f.sync).toBe(0)
})

test('IDB refusal preserves prompt and sends neither job nor sync POST', async ({ page }) => {
  const f = await setup(page)
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (value?.canvas?.content?.elements?.some(element => element.customData?.executionMode === 'job')) throw new DOMException('fixture IDB full', 'QuotaExceededError')
      return put.call(this, value, key)
    }
  })
  await start(page)
  await expect(page.getByText('本地画布保存失败或准备未通过，原请求未发送。fixture IDB full', { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('今天我们要创作什么', { exact: true })).toHaveValue('原图片任务参数 fixture')
  expect(f.creates).toBe(0); expect(f.sync).toBe(0); expect(f.reads).toHaveLength(0)
})

test('ambiguous 202 error keeps original job mode/key and never falls back; failed GET preserves placeholder for manual read', async ({ page }) => {
  const f = await setup(page, { postError: true, getError: true }); await start(page)
  await expect(page.getByRole('button', { name: '读取原图片任务', exact: true })).toBeEnabled()
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(f.reads).toHaveLength(0)
  const stored = (await draft(page)).canvas.content.elements.find(element => element.customData?.jobId === f.id)
  expect(stored.customData.executionMode).toBe('job')
  await page.getByRole('button', { name: '读取原图片任务', exact: true }).click()
  await expect(page.getByText(/fixture 原任务只读不可用/)).toBeVisible()
  expect(liveImages(await exportScene(page))).toHaveLength(0)
  f.enabled = false; f.getError = false
  await page.reload(); await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled(); await selectOriginal(page)
  await expect.poll(() => f.reads.length).toBe(2)
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(f.actions).toHaveLength(0)
})

for (const status of ['output_received', 'output_saved']) test(`${status} only offers explicit local finalize; no hidden authorize, cancel or model retry`, async ({ page }) => {
  const f = await setup(page, { status }); await start(page)
  await expect(page.getByRole('button', { name: '仅完成原图本地保存', exact: true })).toBeEnabled()
  expect(f.actions).toHaveLength(0)
  await expect(page.getByRole('button', { name: '重新授权原图片任务', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '取消确定未提交任务', exact: true })).toHaveCount(0)
  f.enabled = false
  await page.getByRole('button', { name: '仅完成原图本地保存', exact: true }).click()
  await expect.poll(async () => liveImages((await draft(page)).canvas.content).length).toBe(1)
  expect(f.actions).toEqual([{ path: `/api/studio/image-jobs/${f.id}/finalize`, body: null }])
  expect(f.creates).toBe(1); expect(f.sync).toBe(0)
})

test('needs_authorization uses original parameters and requires explicit confirmation, then unknown blocks all paid actions', async ({ page }) => {
  const f = await setup(page, { status: 'needs_authorization' }); await start(page)
  await expect(page.getByRole('button', { name: '重新授权原图片任务', exact: true })).toBeEnabled()
  await page.getByPlaceholder('今天我们要创作什么', { exact: true }).fill('修改输入不能改变原任务')
  await page.getByRole('button', { name: '重新授权原图片任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认授权原图片任务', exact: true })).toBeVisible(); expect(f.actions).toHaveLength(0)
  await page.getByRole('button', { name: '确认授权原图片任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '重新授权原图片任务', exact: true })).toHaveCount(0)
  expect(f.actions).toEqual([{ path: `/api/studio/image-jobs/${f.id}/authorize`, body: { confirm: true } }])
  expect((await draft(page)).canvas.content.elements.find(element => element.customData?.jobId === f.id).customData.requestParameters).toEqual(f.payload)
  expect(f.creates).toBe(1); expect(f.sync).toBe(0)
})

test('pre-submit cancellation needs explicit confirmation and retains the original cancelled ID without refund/new generation', async ({ page }) => {
  const f = await setup(page, { status: 'needs_authorization' }); await start(page)
  await expect(page.getByRole('button', { name: '取消确定未提交任务', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '取消确定未提交任务', exact: true }).click(); expect(f.actions).toHaveLength(0)
  await page.getByRole('button', { name: '确认取消原图片任务', exact: true }).click()
  await expect(page.getByText('原图片任务已确定在外发前取消；没有生成结果，未请求退款。', { exact: true })).toBeVisible()
  expect(f.actions).toEqual([{ path: `/api/studio/image-jobs/${f.id}/cancel`, body: { confirm: true } }])
  await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeDisabled()
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(liveImages(await exportScene(page))).toHaveLength(0)
})

test('late A job DTO cannot add files or display private output in B; stale A write verifier makes zero POSTs', async ({ page }) => {
  let release; const gate = new Promise(resolve => { release = resolve })
  const f = await setup(page); await start(page); await expect.poll(() => f.reads.length).toBe(1)
  f.status = 'completed'; f.gate = gate
  await page.getByRole('button', { name: '读取原图片任务', exact: true }).click(); await expect.poll(() => f.reads.length).toBe(2)
  const box = await page.locator('.excalidraw .interactive').boundingBox(); await page.mouse.click(box.x + 10, box.y + 100)
  await openAccountSection(page); await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  const next = { id: 8, username: 'owner-eight', display_name: 'B 图片任务 fixture' }
  await page.route('**/api/user/login', route => { f.account.active = true; f.account.token = 'owner-eight-fixture'; return route.fulfill({ json: envelope({ access_token: f.account.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'owner-eight-session' }, user: next }) }) })
  await page.route('**/api/user/self', route => route.request().headers().authorization === 'Bearer owner-eight-fixture' ? route.fulfill({ json: envelope(next) }) : route.fallback())
  await openAccountSection(page); await page.getByLabel('用户名', { exact: true }).fill('owner-eight'); await page.getByLabel('密码', { exact: true }).fill('test-password'); await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：B 图片任务 fixture', { exact: true })).toBeVisible(); await closeAccount(page); release()
  expect(liveImages(await exportScene(page))).toHaveLength(0)
  const result = await page.evaluate(async () => {
    const { createImageJobClient } = await import('/studio/src/loomic/lib/image-jobs.ts'), { currentUser, getIdentityEpoch, request } = await import('/studio/src/api.ts')
    const client = createImageJobClient({ transport: request, getOwner: () => 'local:7', getEpoch: getIdentityEpoch, verifyOwner: async owner => owner === `local:${(await currentUser())?.id}` })
    try { await client.start('local:7', crypto.randomUUID(), { prompt: '旧 A 原参数', model: 'fixture-image', inputImages: [] }); return 'unexpected' } catch (error) { return error.message }
  })
  expect(result).toContain('未发送图片任务请求'); expect(f.creates).toBe(1); expect(f.sync).toBe(0)
  expect(Object.values((await exportScene(page)).files)).toHaveLength(0)
})

test('canvas decode failure keeps original completed download and placeholder; later read inserts once with zero model retries', async ({ page }) => {
  const f = await setup(page, { status: 'completed', legacyGeometry: true })
  await page.evaluate(() => {
    const decode = createImageBitmap
    window.createImageBitmap = () => Promise.reject(new Error('fixture local canvas decode unavailable'))
    window.fixtureRestoreDecoder = () => { window.createImageBitmap = decode }
  })
  await start(page)
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveAttribute('href', image.url)
  await expect(page.getByText(/fixture local canvas decode unavailable/)).toBeVisible()
  expect(liveImages(await exportScene(page))).toHaveLength(0)
  expect((await draft(page)).canvas.content.elements.filter(element => element.customData?.jobId === f.id)).toHaveLength(1)
  await page.evaluate(() => window.fixtureRestoreDecoder())
  await page.getByRole('button', { name: '读取原图片任务', exact: true }).click()
  await expect.poll(async () => liveImages((await draft(page)).canvas.content).length).toBe(1)
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(f.actions).toHaveLength(0)
})

test('completed status IDB failure keeps validated original download before insertion; storage recovery only rereads same job', async ({ page }) => {
  const f = await setup(page, { status: 'completed' })
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (value?.canvas?.content?.elements?.some(element => element.customData?.jobStatus === 'completed')) throw new DOMException('fixture completed status cannot save', 'QuotaExceededError')
      return put.call(this, value, key)
    }
    window.fixtureRestorePut = () => { IDBObjectStore.prototype.put = put }
  })
  await start(page)
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveAttribute('href', image.url)
  await expect(page.getByText(/fixture completed status cannot save/)).toBeVisible()
  expect(liveImages(await exportScene(page))).toHaveLength(0)
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(f.actions).toHaveLength(0)
  await page.evaluate(() => window.fixtureRestorePut())
  await page.getByRole('button', { name: '读取原图片任务', exact: true }).click()
  await expect.poll(async () => liveImages((await draft(page)).canvas.content).length).toBe(1)
  expect(f.creates).toBe(1); expect(f.sync).toBe(0); expect(f.actions).toHaveLength(0)
})
