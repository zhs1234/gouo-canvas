import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import { mockAccount } from './account-fixture.mjs'
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const dataURL = 'data:image/png;base64,' + (await sharp({ create: { width: 160, height: 100, channels: 4, background: '#55aadd' } }).png().toBuffer()).toString('base64')
async function fixture(page) {
  const account = await mockAccount(page); account.active = true
  const state = { account, conflict: false, failSave: false, rejectAsset: false, reads: 0, writes: [], project: { id: projectId, title: '持久项目', revision: 1, document: { elements: [], appState: {}, files: {} }, createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z' } }
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
  if (name === '下载本机备份' && await page.locator('.canvas-more').getAttribute('open') === null) await page.getByText('更多操作', { exact: true }).click()
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  return JSON.parse(await readFile(await (await waiting).path(), 'utf8'))
}
const live = doc => doc.elements.filter(e => !e.isDeleted)
async function drawRectangle(page) {
  const box = await page.locator('.excalidraw .interactive').boundingBox()
  await page.mouse.click(box.x + 650, box.y + 350)
  await page.keyboard.press('r')
  await page.mouse.move(box.x + 650, box.y + 350)
  await page.mouse.down()
  await page.mouse.move(box.x + 760, box.y + 430, { steps: 5 })
  await page.mouse.up()
}
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
test('reopening an already saved project does not write a revision; a real edit still saves', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('status')).toContainText('已保存到 Studio 项目')
  const saved = structuredClone(state.project), writes = state.writes.length
  await page.reload()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  // Observe past the actual 500ms debounce: opening must not manufacture a write.
  await page.waitForTimeout(900)
  expect(state.writes).toHaveLength(writes)
  expect(state.project).toEqual(saved)
  expect(live(await exported(page))).toHaveLength(1)
  await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
  expect(state.writes).toHaveLength(writes)
  await drawRectangle(page)
  await expect.poll(() => state.writes.length).toBe(writes + 1)
  expect(live(state.project.document).map(element => element.type).sort()).toEqual(['image', 'rectangle'])
  expect(state.project.document.files[assetId].dataURL).toBe(dataURL)
  expect(state.project.revision).toBe(saved.revision + 1)
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
  await expect(page.getByRole('status')).toContainText('Studio 项目已打开')
  expect(live(await exported(page, '下载本机备份'))).toHaveLength(1)
  expect(state.writes).toHaveLength(1)
  expect(state.project.document.elements).toHaveLength(0)
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
  await page.getByRole('button', { name: '重命名 持久项目' }).click()
  await page.getByRole('dialog', { name: '重命名项目' }).getByLabel('项目名称').fill('新的项目名')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(page.getByRole('link', { name: '新的项目名', exact: true })).toBeVisible()
  expect(state.writes[0]).toEqual({ expectedRevision: 1, title: '新的项目名' })
  await expect(page.getByText('画布保存在当前浏览器', { exact: false })).toBeVisible()
})

test('internal project navigation saves pending edits and preserves the in-memory account', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  await page.evaluate(() => { window.navigationWitness = 'same-document' })
  const refreshes = state.account.refreshes
  await drawRectangle(page)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '项目库', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Studio 项目', exact: true })).toBeVisible()
  expect(live(state.project.document).map(e => e.type).sort()).toEqual(['image', 'rectangle'])
  expect(await page.evaluate(() => window.navigationWitness)).toBe('same-document')
  expect(state.account.refreshes).toBe(refreshes)
  await page.getByRole('button', { name: '新建 Studio 项目', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.navigationWitness)).toBe('same-document')
  expect(state.account.refreshes).toBe(refreshes)
  expect(live(await exported(page)).map(e => e.type).sort()).toEqual(['image', 'rectangle'])
})

test('failed save during internal navigation retains the editor and never replays the write', async ({ page }) => {
  const state = await fixture(page)
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('status')).toContainText('已保存到 Studio')
  state.failSave = true
  await drawRectangle(page)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '项目库', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('保存服务暂不可用')
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`))
  const writes = state.writes.length
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '项目库', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`))
  expect(state.writes).toHaveLength(writes)
  expect(live(await exported(page, '下载本机备份')).map(e => e.type).sort()).toEqual(['image', 'rectangle'])
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

test('edits after failed save are in latest recovery copy without another remote write', async ({ page }) => {
  const state = await fixture(page); state.failSave = true
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('alert')).toContainText('保存服务暂不可用')
  await drawRectangle(page)
  // Download immediately, before the debounce has persisted the new edit.
  const recovered = await exported(page, '下载本机备份')
  expect(live(recovered).map(e => e.type).sort()).toEqual(['image', 'rectangle'])
  expect(recovered.files[assetId].dataURL).toBe(dataURL)
  expect(state.writes).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  expect(live(await exported(page, '下载本机备份')).map(e => e.type).sort()).toEqual(['image', 'rectangle'])
  expect(state.project.document.elements).toHaveLength(0)
})

test('local quota failure pauses remote saves while current document remains exportable', async ({ page }) => {
  const state = await fixture(page)
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('fixture quota full', 'QuotaExceededError') }
  })
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('alert')).toContainText('本机备份失败')
  expect(state.writes).toHaveLength(0)
  const document = await exported(page)
  expect(live(document)).toHaveLength(1)
  expect(document.files[assetId].dataURL).toBe(dataURL)
  await drawRectangle(page)
  expect(live(await exported(page))).toHaveLength(2)
  expect(state.writes).toHaveLength(0)
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })).toBe(true)
})

test('edits during an in-flight save survive a subsequent save failure', async ({ page }) => {
  const state = await fixture(page)
  let release, received
  const arrived = new Promise(resolve => { received = resolve })
  const gate = new Promise(resolve => { release = resolve })
  let captured = false
  await page.route(`**/api/studio/projects/${projectId}`, async route => {
    if (route.request().method() !== 'PATCH' || captured) return route.fallback()
    captured = true
    const body = route.request().postDataJSON()
    received()
    await gate
    state.writes.push(body)
    state.project = { ...state.project, ...body, revision: state.project.revision + 1 }
    return route.fulfill({ json: { success: true, data: state.project } })
  })
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await arrived
  await drawRectangle(page)
  await expect(page.getByRole('status')).toContainText('尚未保存')
  // The first PATCH is still held by the gate: backup download must be local.
  expect(live(await exported(page, '下载本机备份'))).toHaveLength(2)
  expect(state.writes).toHaveLength(0)
  state.failSave = true
  release()
  await expect(page.getByRole('alert')).toContainText('保存服务暂不可用')
  expect(live(state.project.document)).toHaveLength(1)
  expect(live(await exported(page, '下载本机备份'))).toHaveLength(2)
  expect(state.writes).toHaveLength(2)
})
