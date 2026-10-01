import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const dataURL = 'data:image/png;base64,' + (await sharp({ create: { width: 160, height: 100, channels: 4, background: '#55aadd' } }).png().toBuffer()).toString('base64')
const live = document => document.elements.filter(element => !element.isDeleted)
async function exported(page, name) {
  if (name === '导出文档副本' && await page.locator('.canvas-more').getAttribute('open') === null) await page.getByText('更多操作', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  return JSON.parse(await readFile(await (await download).path(), 'utf8'))
}
async function local(page, { fromChat = false } = {}) {
  await mockAccount(page)
  if (fromChat) {
    await page.goto('./')
    await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '画布', exact: true }).click()
  } else await page.goto('./canvas-lab')
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
}
async function privateFixture(page) {
  const account = await mockAccount(page); account.active = true
  const state = { failure: null, writes: 0, project: { id: projectId, title: '导航测试项目', sourceAssetId: assetId, revision: 1, document: { elements: [], appState: {}, files: {} } } }
  await page.route('**/api/studio/projects**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === `/api/studio/projects/${projectId}`) {
      if (route.request().method() === 'PATCH') {
        state.writes++
        if (state.failure === 'lost') return route.abort('connectionfailed')
        if (state.failure === 'conflict') return route.fulfill({ status: 409, json: { success: false, message: '导航测试版本冲突' } })
        state.project = { ...state.project, ...route.request().postDataJSON(), revision: state.project.revision + 1 }
      }
      return route.fulfill({ json: { success: true, data: state.project } })
    }
    return route.fulfill({ json: { success: true, data: { items: [state.project], nextOffset: null } } })
  })
  await page.route('**/api/studio/assets/*', route => route.fulfill({ json: { success: true, data: { id: assetId, mimeType: 'image/png', width: 160, height: 100, dataURL } } }))
  return state
}

test('996px shared sidebar leaves the official library toggle fully visible and usable', async ({ page }) => {
  await page.setViewportSize({ width: 996, height: 1040 })
  await mockAccount(page)
  await page.goto('./canvas-lab')
  const library = page.locator('.excalidraw .sidebar-trigger__label-element').filter({ has: page.getByRole('checkbox', { name: '素材库', exact: true }) })
  await expect(library).toBeVisible()
  const editor = await page.locator('.excalidraw').boundingBox()
  const toggle = await library.boundingBox()
  expect(toggle.x).toBeGreaterThanOrEqual(editor.x)
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(editor.x + editor.width)
  await library.click()
  await expect(page.getByRole('checkbox', { name: '素材库', exact: true })).toBeChecked()
  await expect(page.locator('.excalidraw .sidebar')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(996)
})

test('local canvas sidebar leave saves the image before chat and restores it on return', async ({ page }) => {
  await local(page)
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  const before = await exported(page, '导出文档副本')
  await page.getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '画布', exact: true }).click()
  await expect(page.locator('.excalidraw .App-toolbar')).toBeVisible()
  const after = await exported(page, '导出文档副本')
  expect(live(after).map(element => element.id)).toEqual(live(before).map(element => element.id))
  expect(after.files).toEqual(before.files)
})

for (const action of ['sidebar', 'POP']) test(`local failed IDB save blocks ${action} and keeps its image exportable`, async ({ page }) => {
  await local(page, { fromChat: true })
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('fixture quota full', 'QuotaExceededError') } })
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  if (action === 'sidebar') await page.getByRole('link', { name: '聊天', exact: true }).click()
  else await page.evaluate(() => history.back())
  await expect(page.getByRole('status')).toContainText('保存失败')
  await expect(page).toHaveURL(/\/studio\/canvas-lab$/)
  expect(live(await exported(page, '导出文档副本'))).toHaveLength(1)
})

test('private canvas sidebar leave persists its inserted asset and returns without duplication', async ({ page }) => {
  const state = await privateFixture(page)
  await page.goto(`./canvas-lab?project=${projectId}&asset=${assetId}`)
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  await page.getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat$/)
  expect(live(state.project.document)).toHaveLength(1)
  await page.goBack()
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  expect(live(await exported(page, '导出文档备份'))).toHaveLength(1)
})

for (const failure of ['conflict', 'lost']) test(`private ${failure} save blocks sidebar and POP without blind PATCH retry`, async ({ page }) => {
  const state = await privateFixture(page); state.failure = failure
  page.on('dialog', dialog => dialog.dismiss())
  await page.goto('./')
  await page.getByRole('link', { name: '项目库', exact: true }).click()
  await page.getByRole('link', { name: '导航测试项目', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(failure === 'conflict' ? '版本冲突' : '保存失败')
  const writes = state.writes
  await page.getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`canvas-lab[?]project=${projectId}`))
  await page.evaluate(() => history.back())
  await expect(page.locator('.canvas-project-bar')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`canvas-lab[?]project=${projectId}`))
  expect(live(await exported(page, '导出文档备份'))).toHaveLength(1)
  expect(state.writes).toBe(writes)
})

test('paused private canvas refuses leave when confirmed recovery backup fails', async ({ page }) => {
  const state = await privateFixture(page); state.failure = 'conflict'
  await page.goto(`./canvas-lab?project=${projectId}`)
  await expect(page.getByRole('alert')).toContainText('版本冲突')
  const writes = state.writes
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('fixture quota full', 'QuotaExceededError') } })
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('本机恢复副本保存失败')
  await expect(page).toHaveURL(new RegExp(`canvas-lab[?]project=${projectId}`))
  expect(live(await exported(page, '导出文档备份'))).toHaveLength(1)
  expect(state.writes).toBe(writes)
})

test('mobile drawer stays open when local save denies navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await local(page)
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('fixture quota full', 'QuotaExceededError') } })
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/\/studio\/canvas-lab$/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status')).toContainText('保存失败')
  expect(live(await exported(page, '导出文档副本'))).toHaveLength(1)
})
