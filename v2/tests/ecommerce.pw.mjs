import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection } from './workspace-account-fixture.mjs'

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const png = await sharp({ create: { width: 160, height: 100, channels: 4, background: '#55aadd' } }).png().toBuffer()
const dataURL = `data:image/png;base64,${png.toString('base64')}`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const live = doc => doc.elements.filter(element => !element.isDeleted)
// Native history increments versions; native restore normalizes empty bindings. Compare every visible field and drawing seed.
const visual = doc => live(doc).map(({ version, versionNonce, updated, index, boundElements, ...element }) => ({ ...element, boundElements: boundElements ?? [] }))
const roles = doc => Object.fromEntries(live(doc).filter(element => element.type === 'text').map(element => [element.customData?.ecommerceRole, element.originalText]))
const panel = page => page.getByRole('dialog', { name: '电商版式与导出', exact: true })

async function fixtures(page, authenticated = false) {
  const state = { modelCalls: 0, conflict: false, writes: [], project: { id: projectId, title: '电商协议测试项目', revision: 1, document: { elements: [], appState: {}, files: {} } } }
  // All API traffic stays in the browser fixture, including unmatched requests.
  await page.route('**/api/**', route => {
    if (/\/api\/studio\/(images|runs|agent|image-jobs|threads\/[^/]+\/runs)/.test(new URL(route.request().url()).pathname) && route.request().method() !== 'GET') state.modelCalls++
    return route.fulfill({ status: 401, json: { success: false, message: '本地测试拦截' } })
  })
  if (authenticated) { state.account = await mockAccount(page); state.account.active = true }
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { models: [], generationEnabled: false } } }))
  await page.route('**/api/studio/projects**', route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); state.writes.push(body)
      if (state.conflict) return route.fulfill({ status: 409, json: { success: false, message: '版本冲突测试' } })
      expect(body.expectedRevision).toBe(state.project.revision)
      state.project = { ...state.project, ...body, revision: state.project.revision + 1 }
    }
    return route.fulfill({ json: { success: true, data: state.project } })
  })
  return state
}

async function openPanel(page) {
  if (await panel(page).isVisible()) return panel(page)
  await expect(page.locator('.ecommerce-entry')).toBeAttached()
  if (await page.locator('.canvas-more').count() && await page.locator('.canvas-more').getAttribute('open') === null) await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '电商版式', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '电商版式', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  return panel(page)
}

async function documentCopy(page) {
  const dialog = await openPanel(page), download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出画布文档备份', exact: true }).click()
  return JSON.parse(await readFile(await (await download).path(), 'utf8'))
}
async function pngCopy(page) {
  const dialog = await openPanel(page), download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '导出所选画框 PNG', exact: true }).click()
  const file = await download
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) }
}
async function closePanel(page) { await panel(page).getByRole('button', { name: '关闭电商版式', exact: true }).click() }
async function selectFrame(page, frame) {
  await closePanel(page)
  if (await page.locator('.canvas-more').count() && await page.locator('.canvas-more').getAttribute('open') !== null) await page.getByText('更多操作', { exact: true }).click()
  await page.getByText(frame.name, { exact: true }).click()
}
async function create(page, width = 400, height = 400) {
  const dialog = await openPanel(page)
  await dialog.getByLabel('版式宽度', { exact: true }).fill(String(width))
  await dialog.getByLabel('版式高度', { exact: true }).fill(String(height))
  await dialog.getByLabel('版式标题', { exact: true }).fill('商品测试标题')
  await dialog.getByLabel('版式价格', { exact: true }).fill('¥ 88')
  await dialog.getByLabel('版式卖点', { exact: true }).fill('耐用 · 轻便')
  await dialog.getByLabel('版式品牌', { exact: true }).fill('测试品牌')
  await dialog.getByRole('button', { name: '创建可编辑版式', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('已创建')
}
async function nativeUndo(page, redo = false) {
  await closePanel(page)
  if (await page.getByRole('button', { name: redo ? '重做' : '撤销', exact: true }).isVisible()) await page.getByRole('button', { name: redo ? '重做' : '撤销', exact: true }).click()
  else await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z')
}
async function savedLab(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('gouo-canvas-lab-v1'); request.onsuccess = () => resolve(request.result); request.onerror = reject })
    const raw = await new Promise((resolve, reject) => { const request = db.transaction('documents', 'readonly').objectStore('documents').get('local:guest:active'); request.onsuccess = () => resolve(request.result); request.onerror = reject })
    db.close(); return raw ? JSON.parse(raw) : { elements: [] }
  })
}

test('native empty frame, editable text, undo/redo, exact PNG and local reload', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  await create(page)
  const before = await documentCopy(page), frame = live(before).find(element => element.type === 'frame')
  expect(frame).toMatchObject({ width: 400, height: 400, name: '电商空版式 400 × 400' })
  expect(live(before).filter(element => element.type === 'image')).toHaveLength(0)
  expect(live(before).filter(element => element.type === 'text').every(element => !element.locked && element.frameId === frame.id)).toBe(true)
  expect(roles(before)).toMatchObject({ title: '商品测试标题', price: '¥ 88', points: '耐用 · 轻便', brand: '测试品牌' })
  const exported = await pngCopy(page)
  expect(exported.name).toBe('ecommerce-400x400.png')
  expect(await sharp(exported.bytes).metadata()).toMatchObject({ width: 400, height: 400, format: 'png' })
  await nativeUndo(page)
  expect(live(await documentCopy(page))).toHaveLength(0)
  await nativeUndo(page, true)
  expect(live(await documentCopy(page)).map(element => element.id)).toEqual(live(before).map(element => element.id))
  await expect.poll(async () => live(await savedLab(page)).filter(element => element.type === 'frame').length).toBe(1)
  await closePanel(page)
  await page.getByRole('button', { name: '保存本机画布', exact: true }).click()
  await page.reload()
  expect(roles(await documentCopy(page))).toEqual(roles(before))
  const restored = await documentCopy(page)
  expect(visual(restored)).toEqual(visual(before))
  await selectFrame(page, frame)
  expect(hash(await sharp((await pngCopy(page)).bytes).raw().toBuffer())).toBe(hash(await sharp(exported.bytes).raw().toBuffer()))
  expect(state.modelCalls).toBe(0)
})

test('native double-click text editing and native undo/redo remain editable after reload', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  await create(page)
  const before = await documentCopy(page), frame = live(before).find(element => element.type === 'frame'), title = live(before).find(element => element.customData?.ecommerceRole === 'title')
  await closePanel(page)
  await page.getByText('更多操作', { exact: true }).click()
  const box = await page.locator('.excalidraw .interactive').boundingBox(), zoom = Number((await page.getByRole('button', { name: '重置缩放', exact: true }).innerText()).replace('%', '')) / 100
  await page.mouse.dblclick(box.x + box.width / 2 + (title.x + title.width / 2 - frame.x - frame.width / 2) * zoom, box.y + box.height / 2 + (title.y + title.height / 2 - frame.y - frame.height / 2) * zoom)
  const editor = page.locator('.excalidraw-wysiwyg')
  await expect(editor).toBeVisible()
  await editor.fill('手动修改商品标题')
  await page.keyboard.press('Escape')
  expect(roles(await documentCopy(page)).title).toBe('手动修改商品标题')
  await nativeUndo(page)
  expect(roles(await documentCopy(page)).title).toBe('商品测试标题')
  await nativeUndo(page, true)
  const after = await documentCopy(page)
  expect(roles(after).title).toBe('手动修改商品标题')
  await expect.poll(async () => roles(await savedLab(page)).title).toBe('手动修改商品标题')
  await page.reload()
  const restored = await documentCopy(page)
  expect(roles(restored)).toEqual(roles(after))
  expect(visual(restored)).toEqual(visual(after))
  expect(state.modelCalls).toBe(0)
})

test('an export finishing after logout and unmount cannot download the previous owner scene', async ({ page }) => {
  const state = await fixtures(page, true)
  await page.goto('./canvas-lab')
  await create(page)
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) { window.finishEcommerceExport = () => toBlob.call(this, callback, ...args) }
    const click = HTMLAnchorElement.prototype.click
    window.ecommercePNGDownloads = 0
    HTMLAnchorElement.prototype.click = function () { if (this.download.endsWith('.png')) window.ecommercePNGDownloads++; return click.call(this) }
  })
  await panel(page).getByRole('button', { name: '导出所选画框 PNG', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof window.finishEcommerceExport)).toBe('function')
  await closePanel(page)
  const account = await openAccountSection(page)
  await account.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  await page.evaluate(async () => { window.finishEcommerceExport(); await new Promise(resolve => setTimeout(resolve, 100)) })
  expect(await page.evaluate(() => window.ecommercePNGDownloads)).toBe(0)
  expect(live(await documentCopy(page))).toHaveLength(0)
  expect(state.modelCalls).toBe(0)
})

test('selected product copy preserves original bytes, crop, flips, ratio and source element', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  await openPanel(page); await closePanel(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const doc = await documentCopy(page)
  const original = live(doc).find(element => element.type === 'image')
  original.x = 150; original.y = 180; original.width = 240; original.height = 100; original.scale = [-1, 1]; original.angle = Math.PI / 12
  original.crop = { x: 20, y: 10, width: 120, height: 50, naturalWidth: 160, naturalHeight: 100 }
  doc.files[original.fileId].dataURL = dataURL
  await closePanel(page)
  await page.getByLabel('导入文档副本', { exact: true }).setInputFiles({ name: 'product.excalidraw', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await expect(page.getByRole('status')).toContainText('原始文档快照已保留')
  const source = live(await documentCopy(page)).find(element => element.id === original.id)
  await closePanel(page)
  await page.getByText('更多操作', { exact: true }).click()
  const box = await page.locator('.excalidraw .interactive').boundingBox()
  await page.mouse.click(box.x + source.x + source.width / 2, box.y + source.y + source.height / 2)
  await create(page, 1200, 1600)
  const after = await documentCopy(page), copy = live(after).find(element => element.customData?.ecommerceRole === 'product')
  expect(copy).toBeTruthy()
  expect(copy.fileId).toBe(source.fileId)
  expect(copy.width / copy.height).toBeCloseTo(source.width / source.height, 10)
  expect(copy.crop).toEqual(source.crop)
  expect(copy.scale).toEqual(source.scale)
  expect(copy.angle).toBe(source.angle)
  const frame = live(after).find(element => element.type === 'frame'), boundsWidth = copy.width * Math.abs(Math.cos(copy.angle)) + copy.height * Math.abs(Math.sin(copy.angle)), boundsHeight = copy.width * Math.abs(Math.sin(copy.angle)) + copy.height * Math.abs(Math.cos(copy.angle))
  expect(boundsWidth).toBeLessThanOrEqual(frame.width * .88 + 1e-6)
  expect(boundsHeight).toBeLessThanOrEqual(frame.height * .49 + 1e-6)
  expect(live(after).find(element => element.id === source.id)).toEqual(source)
  expect(after.files[source.fileId].dataURL).toBe(dataURL)
  expect(hash(Buffer.from(after.files[source.fileId].dataURL.split(',')[1], 'base64'))).toBe(hash(png))
  expect(Object.keys(after.files)).toHaveLength(1)
  expect(await sharp((await pngCopy(page)).bytes).metadata()).toMatchObject({ width: 1200, height: 1600 })
  expect(state.modelCalls).toBe(0)
})

test('invalid sizes and failed PNG never change the document or disable backup', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  const before = await documentCopy(page), dialog = panel(page)
  for (const invalid of ['0', '99', '4097', '100.5', '']) {
    await dialog.getByLabel('版式宽度', { exact: true }).fill(invalid)
    await dialog.getByRole('button', { name: '创建可编辑版式', exact: true }).click()
    expect(live(await documentCopy(page))).toEqual(live(before))
  }
  await create(page, 1024, 1024)
  const saved = await documentCopy(page)
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null) } })
  await dialog.getByRole('button', { name: '导出所选画框 PNG', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('操作失败')
  expect(await documentCopy(page)).toEqual(saved)
  expect(state.modelCalls).toBe(0)
})

test('all user presets export exact pixels with white background and no model request', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  for (const [label, width, height] of [['方形', 1024, 1024], ['竖版', 1200, 1600], ['横版', 1600, 900]]) {
    const dialog = await openPanel(page)
    await dialog.getByRole('button', { name: `${label} ${width} × ${height}`, exact: true }).click()
    await dialog.getByRole('button', { name: '创建可编辑版式', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('已创建空版式')
    const { bytes } = await pngCopy(page)
    expect(await sharp(bytes).metadata()).toMatchObject({ width, height })
    expect([...(await sharp(bytes).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())]).toEqual([255, 255, 255, 255])
  }
  expect(state.modelCalls).toBe(0)
})

test('export requires selected native frame; valid custom edge sizes remain exact', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  const dialog = await openPanel(page)
  await dialog.getByRole('button', { name: '导出所选画框 PNG', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('选择一个画框')
  expect(live(await documentCopy(page))).toHaveLength(0)
  for (const [width, height] of [[100, 100], [4096, 100]]) {
    await create(page, width, height)
    expect(await sharp((await pngCopy(page)).bytes).metadata()).toMatchObject({ width, height })
  }
  expect(state.modelCalls).toBe(0)
})

test('image decode failure prevents creation and preserves source bytes and document backup', async ({ page }) => {
  const state = await fixtures(page)
  await page.goto('./canvas-lab')
  await openPanel(page); await closePanel(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const before = await documentCopy(page)
  await closePanel(page); await page.getByText('更多操作', { exact: true }).click()
  const box = await page.locator('.excalidraw .interactive').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const dialog = await openPanel(page)
  await page.evaluate(() => { Image.prototype.decode = () => Promise.reject(new Error('explicit failed source decode fixture')) })
  await dialog.getByRole('button', { name: '创建可编辑版式', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('不能解码')
  expect(live(await documentCopy(page))).toEqual(live(before))
  expect((await documentCopy(page)).files).toEqual(before.files)
  expect(state.modelCalls).toBe(0)
})

test('Studio project uses existing CAS save, reload and blocked creation with export preserved', async ({ page }) => {
  const state = await fixtures(page, true)
  state.project.document.processedSourceIds = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']
  await page.goto(`./canvas-lab?project=${projectId}`)
  await create(page, 1600, 900)
  const saved = await documentCopy(page)
  expect(saved.processedSourceIds).toEqual(state.project.document.processedSourceIds)
  await closePanel(page)
  await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
  await expect.poll(() => state.project.document.elements.filter(element => element.type === 'frame').length).toBe(1)
  await page.reload()
  expect(roles(await documentCopy(page))).toEqual(roles(saved))
  state.conflict = true
  await create(page, 320, 240)
  await expect(page.getByRole('alert').filter({ hasText: '版本冲突' })).toBeVisible()
  const dialog = await openPanel(page)
  await expect(dialog.getByRole('button', { name: '创建可编辑版式', exact: true })).toBeDisabled()
  const retained = await documentCopy(page), count = state.writes.length
  expect(retained.processedSourceIds).toEqual(saved.processedSourceIds)
  expect(live(retained).filter(element => element.type === 'frame')).toHaveLength(2)
  expect(await sharp((await pngCopy(page)).bytes).metadata()).toMatchObject({ width: 320, height: 240 })
  expect(state.writes).toHaveLength(count)
  expect(state.modelCalls).toBe(0)
})

test('Loomic narrow mobile entry preserves layout and local native frame fields on reload', async ({ page }) => {
  const state = await fixtures(page)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('./canvas?id=ecommerce-mobile')
  await create(page, 320, 480)
  const doc = await documentCopy(page)
  expect(live(doc).filter(element => element.type === 'frame')).toHaveLength(1)
  const box = await panel(page).boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320)
  expect(await sharp((await pngCopy(page)).bytes).metadata()).toMatchObject({ width: 320, height: 480 })
  await closePanel(page)
  const entry = await page.getByRole('button', { name: '电商版式', exact: true }).boundingBox(), save = await page.getByRole('button', { name: '本地保存', exact: true }).boundingBox()
  expect(entry.x).toBeGreaterThanOrEqual(0); expect(entry.x + entry.width).toBeLessThanOrEqual(save.x)
  // Native local persistence is debounced; navigation uses the existing flush guard.
  await page.getByRole('button', { name: '电商版式', exact: true }).click()
  await closePanel(page)
  await page.waitForTimeout(1800)
  await page.reload()
  expect(roles(await documentCopy(page))).toEqual(roles(doc))
  expect(live(await documentCopy(page)).map(element => element.id)).toEqual(live(doc).map(element => element.id))
  expect(state.modelCalls).toBe(0)
})
