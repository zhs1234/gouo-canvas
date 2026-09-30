import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openLab(page) {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { success: false } }))
  await page.goto('./canvas-lab')
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
  await expect(page.locator('.excalidraw .App-toolbar')).toBeVisible()
}
async function exported(page, button = '导出文档副本') {
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
  await expect(page.getByRole('status')).toContainText('不支持直接导入 Fabric')
  expect(live(JSON.parse(await exported(page)))).toHaveLength(1)
  expect(await exported(page, '下载原始导入文件')).toBe(raw)
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
