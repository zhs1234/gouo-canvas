import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

async function openLab(page) {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { success: false } }))
  await page.goto('./canvas-lab')
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
  await expect(page.locator('.excalidraw .App-toolbar')).toBeVisible()
}
async function exported(page, button = '导出文档副本') {
  if (await page.locator('.canvas-more').getAttribute('open') === null) await page.getByText('更多操作', { exact: true }).click()
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  return readFile(await (await waiting).path(), 'utf8')
}
const live = scene => scene.elements.filter(element => !element.isDeleted)

test('official canvas lab preserves isolated image files, deduplicates artifacts and reopens saved scenes', async ({ page }) => {
  await openLab(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('未重复插入')
  const before = JSON.parse(await exported(page))
  expect(live(before)).toHaveLength(1)
  expect(Object.keys(before.files)).toHaveLength(1)
  await page.getByRole('button', { name: '保存对照草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.reload()
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
  const after = JSON.parse(await exported(page))
  expect(live(after).map(element => element.id)).toEqual(live(before).map(element => element.id))
  expect(after.files).toEqual(before.files)
  expect(errors).toEqual([])
})

test('official canvas lab imports document copies, retains original payload and rejects Fabric', async ({ page }) => {
  await openLab(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const original = JSON.parse(await exported(page))
  original.futureMetadata = { preserve: 'original bytes' }
  const raw = JSON.stringify(original, null, 2)
  await page.getByLabel('导入文档副本', { exact: true }).setInputFiles({ name: 'copy.excalidraw', mimeType: 'application/json', buffer: Buffer.from(raw) })
  await expect(page.getByRole('status')).toContainText('原始文档快照已保留')
  expect(await exported(page, '下载原始导入文件')).toBe(raw)
  const restored = JSON.parse(await exported(page))
  expect(live(restored)).toHaveLength(1)
  expect(restored.files).toEqual(original.files)
  await page.getByLabel('导入文档副本', { exact: true }).setInputFiles({ name: 'fabric.json', mimeType: 'application/json', buffer: Buffer.from('{"version":"7","objects":[]}') })
  await expect(page.getByRole('alert')).toContainText('不支持直接导入 Fabric')
  expect(live(JSON.parse(await exported(page)))).toHaveLength(1)
  expect(await exported(page, '下载原始导入文件')).toBe(raw)
})

test('local canvas navigation refuses a failed draft save and keeps the current image exportable', async ({ page }) => {
  await openLab(page)
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('fixture quota full', 'QuotaExceededError') }
  })
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  await page.getByRole('link', { name: '返回创作画布', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('保存失败')
  await expect(page).toHaveURL(/\/studio\/canvas-lab$/)
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented
  })).toBe(true)
  const scene = JSON.parse(await exported(page))
  expect(live(scene)).toHaveLength(1)
  expect(Object.keys(scene.files)).toHaveLength(1)
})

test('official tools draw text and shapes with native undo and redo', async ({ page }) => {
  await openLab(page)
  await page.locator('.excalidraw .interactive').click({ position: { x: 400, y: 240 } })
  await page.keyboard.press('r')
  await page.mouse.move(320, 350)
  await page.mouse.down()
  await page.mouse.move(490, 450)
  await page.mouse.up()
  expect(live(JSON.parse(await exported(page))).filter(element => element.type === 'rectangle')).toHaveLength(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(live(JSON.parse(await exported(page)))).toHaveLength(0)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(live(JSON.parse(await exported(page))).filter(element => element.type === 'rectangle')).toHaveLength(1)
  await page.locator('.excalidraw .interactive').click({ position: { x: 650, y: 400 } })
  await page.keyboard.press('t')
  await page.mouse.click(570, 350)
  await page.keyboard.type('Canvas lab text')
  await page.keyboard.press('Escape')
  expect(live(JSON.parse(await exported(page))).some(element => element.type === 'text' && element.text === 'Canvas lab text')).toBe(true)
})

test('official canvas imports a dropped local PNG without generation', async ({ page }) => {
  await openLab(page)
  const transfer = await page.evaluateHandle(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), character => character.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'local.png', { type: 'image/png' }))
    return data
  })
  await page.locator('.excalidraw .interactive').dispatchEvent('drop', { dataTransfer: transfer, clientX: 420, clientY: 370 })
  await expect.poll(async () => live(JSON.parse(await exported(page))).filter(element => element.type === 'image').length).toBe(1)
  const scene = JSON.parse(await exported(page))
  expect(Object.keys(scene.files)).toHaveLength(1)
  await transfer.dispose()
})

// 合成旧 Loomic 草稿，仅测试数据库副本边界，不读取开发者或生产数据。
test('legacy Loomic copies retain full snapshots without writes to the old database', async ({ page }) => {
  await openLab(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const scene = JSON.parse(await exported(page))
  const draft = { canvas: { id: 'old-fixture', name: '旧画布 fixture', projectId: 'old-fixture', content: { elements: scene.elements, appState: scene.appState, files: scene.files } }, sessions: [{ id: 'session', title: '保留旧会话' }], messages: { session: [{ id: 'message', role: 'user', content: '合成测试' }] }, unknownField: { retain: true } }
  await page.evaluate(async draft => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('keyval-store')
      r.onupgradeneeded = () => r.result.createObjectStore('keyval')
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite')
      tx.objectStore('keyval').put({ ...draft, thumbnail: new Blob(['synthetic-thumbnail']) }, 'gouo:loomic:v1:local:guest:old-fixture')
      tx.objectStore('keyval').put({ ...draft, canvas: { ...draft.canvas, name: '其他账号不可见' } }, 'gouo:loomic:v1:local:2:private')
      tx.oncomplete = resolve; tx.onerror = reject
    })
    db.close()
    window.legacyWrites = 0
    const original = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (this.name === 'keyval-store' && mode === 'readwrite') window.legacyWrites++
      return original.call(this, names, mode, options)
    }
  }, draft)
  await page.getByRole('button', { name: '查看旧草稿（只读）', exact: true }).click()
  await expect(page.getByRole('button', { name: '导入副本：旧画布 fixture', exact: true })).toBeVisible()
  await expect(page.getByText('其他账号不可见')).toHaveCount(0)
  await page.getByRole('button', { name: '导入副本：旧画布 fixture', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('完整原始草稿快照已保留')
  expect(live(JSON.parse(await exported(page)))).toHaveLength(1)
  const originalPayload = JSON.parse(await exported(page, '下载原始导入文件'))
  expect(originalPayload.messages).toEqual(draft.messages)
  expect(originalPayload.unknownField).toEqual(draft.unknownField)
  const preserved = await page.evaluate(async () => {
    async function entries(name, store) {
      const db = await new Promise(resolve => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result) })
      const values = await new Promise(resolve => { const r = db.transaction(store, 'readonly').objectStore(store).getAll(); r.onsuccess = () => resolve(r.result) })
      db.close(); return values
    }
    const old = await entries('keyval-store', 'keyval')
    const snapshots = await entries('gouo-canvas-lab-v1', 'documents')
    const snapshot = snapshots.find(value => value?.sourceDraft?.canvas?.id === 'old-fixture')
    return { writes: window.legacyWrites, oldCount: old.length, messages: old[0].messages, thumbnail: await snapshot.sourceDraft.thumbnail.text() }
  })
  expect(preserved).toEqual({ writes: 0, oldCount: 2, messages: draft.messages, thumbnail: 'synthetic-thumbnail' })
})

test('legacy lookup does not create absent databases and missing image files cannot replace the current scene', async ({ page }) => {
  await openLab(page)
  await page.getByRole('button', { name: '查看旧草稿（只读）', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('没有旧 Loomic 草稿')
  expect(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'keyval-store'))).toBe(false)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const before = JSON.parse(await exported(page))
  const broken = { ...before, files: {} }
  await page.getByLabel('导入文档副本', { exact: true }).setInputFiles({ name: 'missing.excalidraw', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) })
  await expect(page.getByRole('alert')).toContainText('缺少内嵌图片')
  // Later draft saves must not erase the reason the import was refused.
  await page.getByRole('button', { name: '保存对照草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await expect(page.getByRole('alert')).toContainText('缺少内嵌图片')
  const after = JSON.parse(await exported(page))
  expect(live(after)).toEqual(live(before))
  expect(after.files).toEqual(before.files)
})

async function point(page, x, y) {
  const box = await page.locator('.excalidraw .interactive').boundingBox()
  return { x: box.x + x, y: box.y + y }
}
async function drag(page, start, end) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}
test('native image selection resize rotation delete and undo retain image bytes', async ({ page }) => {
  await openLab(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const initial = JSON.parse(await exported(page))
  const originalImage = live(initial)[0]
  const center = await point(page, originalImage.x + originalImage.width / 2, originalImage.y + originalImage.height / 2)
  await page.mouse.click(center.x, center.y)
  await drag(page, await point(page, originalImage.x + originalImage.width + 4, originalImage.y + originalImage.height + 4), await point(page, originalImage.x + originalImage.width + 64, originalImage.y + originalImage.height + 64))
  const resized = JSON.parse(await exported(page))
  expect(live(resized)[0].width).toBeGreaterThan(180)
  expect(resized.files).toEqual(initial.files)
  const image = live(resized)[0]
  // 官方选框的旋转手柄位于上边中央外侧，坐标来自当前导出元素。
  await page.mouse.click((await point(page, image.x + image.width / 2, image.y + image.height / 2)).x, (await point(page, image.x + image.width / 2, image.y + image.height / 2)).y)
  await drag(page, await point(page, image.x + image.width / 2, image.y - 16), await point(page, image.x + image.width + 45, image.y + image.height / 2))
  const rotated = JSON.parse(await exported(page))
  expect(Math.abs(live(rotated)[0].angle)).toBeGreaterThan(0.1)
  const c = await point(page, image.x + image.width / 2, image.y + image.height / 2)
  await page.mouse.click(c.x, c.y)
  await page.keyboard.press('Delete')
  expect(live(JSON.parse(await exported(page)))).toHaveLength(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  const restored = JSON.parse(await exported(page))
  expect(live(restored)).toHaveLength(1)
  expect(restored.files).toEqual(initial.files)
  await page.getByRole('button', { name: '保存对照草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.reload()
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
  const reopened = JSON.parse(await exported(page))
  expect(live(reopened)[0].angle).toBe(live(restored)[0].angle)
  expect(reopened.files).toEqual(initial.files)
  const png = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PNG 副本', exact: true }).click()
  expect((await readFile(await (await png).path())).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
})

test('native image crop preserves original file data through export and reopen', async ({ page }) => {
  await openLab(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const before = JSON.parse(await exported(page))
  const image = live(before)[0]
  await page.getByText('更多操作', { exact: true }).click()
  const center = await point(page, image.x + image.width / 2, image.y + image.height / 2)
  // addFiles 可先显示占位符；必须等画布实际解码并绘出素材，原生裁剪才能使用图片缓存。
  const sourcePixel = [...await sharp(Buffer.from(before.files[image.fileId].dataURL.split(',')[1], 'base64')).resize(1, 1).removeAlpha().raw().toBuffer()]
  await expect.poll(async () => [...await sharp(await page.screenshot({ clip: { ...center, width: 1, height: 1 } })).removeAlpha().raw().toBuffer()]).toEqual(sourcePixel)
  await page.mouse.click(center.x, center.y)
  // 等待 SDK 选中图片后点击原生裁剪控件，避免按键先于选择状态生效。
  await page.getByRole('button', { name: 'Crop image', exact: true }).click()
  await expect(page.locator('.excalidraw .HintViewer')).toContainText('finish cropping')
  const corner = await point(page, image.x + image.width, image.y + image.height)
  await page.mouse.move(corner.x, corner.y)
  await expect(page.locator('.excalidraw .interactive')).toHaveCSS('cursor', 'nwse-resize')
  await drag(page, corner, await point(page, image.x + image.width - 40, image.y + image.height - 20))
  await page.locator('.excalidraw').press('Enter')
  await expect(page.locator('.excalidraw .HintViewer')).not.toContainText('finish cropping')
  const cropped = JSON.parse(await exported(page))
  expect(live(cropped)[0].crop).toBeTruthy()
  expect(live(cropped)[0].width).toBeLessThan(image.width)
  expect(cropped.files).toEqual(before.files)
  await page.getByRole('button', { name: '保存对照草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  // 状态可能仍是上一次自动保存的提示；只读确认本次裁剪已提交，再模拟重开。
  await expect.poll(() => page.evaluate(async id => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('gouo-canvas-lab-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      const raw = await new Promise((resolve, reject) => { const request = db.transaction('documents', 'readonly').objectStore('documents').get('local:guest:active'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      return raw ? JSON.parse(raw).elements.find(element => element.id === id)?.crop : null
    } finally { db.close() }
  }, image.id)).toEqual(live(cropped)[0].crop)
  await page.reload()
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
  const reopened = JSON.parse(await exported(page))
  expect(live(reopened)[0].crop).toEqual(live(cropped)[0].crop)
  expect(reopened.files).toEqual(before.files)
})

test('native image clipboard paste keeps embedded file data', async ({ page }) => {
  await openLab(page)
  await page.locator('.excalidraw .interactive').click({ position: { x: 450, y: 250 } })
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), character => character.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'clipboard-fixture.png', { type: 'image/png' }))
    document.querySelector('.excalidraw').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect.poll(async () => live(JSON.parse(await exported(page))).filter(element => element.type === 'image').length).toBe(1)
  const scene = JSON.parse(await exported(page))
  expect(Object.keys(scene.files)).toHaveLength(1)
})
