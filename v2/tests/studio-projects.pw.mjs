import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { mockAccount } from './account-fixture.mjs'
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const dataURL = 'data:image/png;base64,' + (await sharp({ create: { width: 160, height: 100, channels: 4, background: '#55aadd' } }).png().toBuffer()).toString('base64')
async function fixture(page) {
  const account = await mockAccount(page); account.active = true
  const state = { conflict: false, failSave: false, rejectAsset: false, reads: 0, writes: [], project: { id: projectId, title: '持久项目', revision: 1, document: { elements: [], appState: {}, files: {} }, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' } }
  await page.route('**/api/studio/projects**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    expect(request.headers().authorization).toBe(`Bearer ${account.token}`)
    if (path === `/api/studio/projects/${projectId}`) {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON(); state.writes.push(body)
        if (state.failSave) return route.fulfill({ status: 503, json: { success: false, message: '保存服务暂不可用' } })
        if (state.conflict || body.expectedRevision !== state.project.revision) return route.fulfill({ status: 409, json: { success: false, message: '项目已在其他窗口更新' } })
        state.project = { ...state.project, ...body, revision: state.project.revision + 1 }
      }
      return route.fulfill({ json: { success: true, data: state.project } })
    }
    if (path === '/api/studio/projects') {
      if (request.method() === 'POST') return route.fulfill({ json: { success: true, data: state.project } })
      return route.fulfill({ json: { success: true, data: { items: [state.project], nextOffset: null } } })
    }
    return route.fulfill({ status: 404, json: { success: false, message: '项目不存在' } })
  })
  await page.route('**/api/studio/assets/*', route => {
    state.reads++
    if (state.rejectAsset) return route.fulfill({ status: 404, json: { success: false, message: '素材不存在' } })
    return route.fulfill({ json: { success: true, data: { id: assetId, mimeType: 'image/png', width: 160, height: 100, dataURL } } })
  })
  return state
}
async function exported(page, name = '导出文档备份') {
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  return JSON.parse(await readFile(await (await waiting).path(), 'utf8'))
}
const live = doc => doc.elements.filter(e => !e.isDeleted)
test('server asset insertion persists bytes and processed marker; delete plus reload never resurrects', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存到 Studio')
  const before = await exported(page)
  expect(live(before)).toHaveLength(1)
  expect(live(before)[0].customData.assetId).toBe(assetId)
  expect(before.files[assetId].dataURL).toBe(dataURL)
  expect(before.files[assetId].assetId).toBe(assetId)
  expect(before.processedSourceIds).toEqual([assetId])
  await page.reload()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  expect(live(await exported(page))).toHaveLength(1)
  const box = await page.locator('.excalidraw .interactive').boundingBox()
  await page.mouse.click(box.x + live(before)[0].x + live(before)[0].width / 2, box.y + live(before)[0].y + live(before)[0].height / 2)
  await page.keyboard.press('Delete')
  expect(live(await exported(page))).toHaveLength(0)
  await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
  await expect.poll(() => state.project.document.elements.filter(e => !e.isDeleted).length).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  expect(live(await exported(page))).toHaveLength(0)
  expect(state.project.document.processedSourceIds).toEqual([assetId])
  for (let index = 1; index < state.writes.length; index++) expect(state.writes[index].expectedRevision).toBe(state.writes[index-1].expectedRevision + 1)
})
test('revision conflict pauses writes and recovery export retains unsaved image', async ({ page }) => {
  const state = await fixture(page); state.conflict = true
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('alert')).toContainText('版本冲突')
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeDisabled()
  expect(live(await exported(page, '下载本机备份'))).toHaveLength(1)
  expect(state.writes).toHaveLength(1)
  expect(state.project.document.elements).toHaveLength(0)
  state.conflict = false
  await page.goto(`./canvas-lab?project=${projectId}`)
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存到 Studio')
  expect(live(await exported(page, '下载本机备份'))).toHaveLength(1)
})
test('foreign asset and foreign project fail without writes; anonymous server route requires login', async ({ page }) => {
  const state = await fixture(page); state.rejectAsset = true
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('status')).toContainText('素材不存在')
  expect(state.writes).toHaveLength(0)
  await page.goto('./canvas-lab?project=cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  await expect(page.getByRole('status')).toContainText('项目不存在')
  expect(state.writes).toHaveLength(0)
  await page.unroute('**/api/user/**')
  await page.route('**/api/user/**', route => route.fulfill({ status: 401, json: { success: false } }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('请先登录')
})
test('Studio project library opens and renames with revision; local project section remains', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('./projects')
  await expect(page.getByRole('region', { name: 'Studio 项目', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '持久项目', exact: true })).toHaveAttribute('href', `/studio/canvas-lab?project=${projectId}`)
  page.once('dialog', dialog => dialog.accept('新的项目名'))
  await page.getByRole('button', { name: '重命名 持久项目' }).click()
  await expect(page.getByRole('link', { name: '新的项目名', exact: true })).toBeVisible()
  expect(state.writes[0]).toEqual({ expectedRevision: 1, title: '新的项目名' })
  await expect(page.getByText('画布保存在当前浏览器', { exact: false })).toBeVisible()
})

test('native crop in server project retains original asset bytes through save and reopen', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  const before = await exported(page), image = live(before)[0]
  const box = await page.locator('.excalidraw .interactive').boundingBox()
  await page.mouse.click(box.x + image.x + image.width / 2, box.y + image.y + image.height / 2)
  await page.keyboard.press('Enter')
  await page.mouse.move(box.x + image.x + image.width + 4, box.y + image.y + image.height + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + image.x + image.width - 30, box.y + image.y + image.height - 20, { steps: 8 })
  await page.mouse.up(); await page.keyboard.press('Enter')
  const cropped = await exported(page)
  expect(live(cropped)[0].crop).toBeTruthy()
  expect(cropped.files[assetId].dataURL).toBe(dataURL)
  await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
  await expect.poll(() => state.project.document.elements[0]?.crop).toEqual(live(cropped)[0].crop)
  await page.reload()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  const reopened = await exported(page)
  expect(live(reopened)[0].crop).toEqual(live(cropped)[0].crop)
  expect(reopened.files[assetId].dataURL).toBe(dataURL)
})
test('failed remote save pauses without replay and offers independent local recovery', async ({ page }) => {
  const state = await fixture(page); state.failSave = true
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('alert')).toContainText('保存服务暂不可用')
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeDisabled()
  const recovered = await exported(page, '下载本机备份')
  expect(live(recovered)).toHaveLength(1)
  expect(recovered.files[assetId].dataURL).toBe(dataURL)
  expect(state.writes).toHaveLength(1)
})
