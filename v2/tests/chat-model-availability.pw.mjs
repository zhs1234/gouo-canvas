import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
async function setup(page, catalog, status = 200) {
  const account = await mockAccount(page); account.active = true
  let writes = 0
  page.on('request', request => { if (request.url().includes('/api/studio/') && request.method() !== 'GET') writes++ })
  await page.route('**/api/studio/models', route => route.fulfill({ status, json: status === 200 ? { success: true, data: catalog } : { success: false, message: 'private-channel/internal-group/secret-price must not render' } }))
  const thread = { id: threadId, title: '模型权限测试会话', runs: [] }
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: [thread], nextOffset: null } } }))
  await page.route('**/api/studio/threads/*', route => route.fulfill({ json: { success: true, data: thread } }))
  await page.goto(`./chat?thread=${threadId}`)
  return () => writes
}

for (const fixture of [
  { name: 'group permission', description: '当前账号分组没有此模型权限，请联系管理员', enabled: true, message: '当前账号没有可用聊天模型的使用权限，请联系管理员核对。' },
  { name: 'generation disabled', description: '尚未配置或验证', enabled: false, message: '生成服务尚未开放，请联系管理员；当前不能发送模型请求。' },
  { name: 'unverified model', description: 'private-channel/internal-group/secret-price must not render', enabled: true, message: '当前暂无已配置并验证的可用聊天模型，请联系管理员核对。' },
  { name: 'catalog failure', description: '', enabled: true, status: 503, message: '聊天模型目录读取失败，请稍后刷新页面重新查询；不会自动发送。' },
]) test(`unavailable chat ${fixture.name} explains refusal without enabling controls or sending writes`, async ({ page }) => {
  const writes = await setup(page, { generationEnabled: fixture.enabled, models: [{ id: 'fixture-chat', displayName: '本地模型', kind: 'chat', accessible: false, description: fixture.description }] }, fixture.status)
  await expect(page.getByText(fixture.message, { exact: true })).toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).toBeDisabled()
  await expect(page.getByText('private-channel/internal-group/secret-price must not render', { exact: true })).toHaveCount(0)
  expect(writes()).toBe(0)
})

test('available chat keeps the normal composer and does not show an unavailable notice', async ({ page }) => {
  const writes = await setup(page, { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '本地模型', kind: 'chat', accessible: true, description: '已配置并经过渠道验证' }] })
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await page.getByLabel('消息', { exact: true }).fill('准备消息，不发送')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await expect(page.locator('.studio-chat-notice')).toHaveCount(0)
  expect(writes()).toBe(0)
})

test('failed SPA catalog refresh disables cached successful models without discarding history or posting', async ({ page }) => {
  const writes = await setup(page, { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '本地模型', kind: 'chat', accessible: true, description: '已配置并经过渠道验证' }] })
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await page.evaluate(() => { window.t17SameDocument = 'catalog-cache-test' })
  await page.route('**/api/studio/models', route => route.fulfill({ status: 503, json: { success: false, message: 'Synthetic catalog read failure' } }))
  await page.route('**/api/studio/projects', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
  await page.getByRole('link', { name: '项目库', exact: true }).click()
  // The real app uses a 15-second staleTime. Remount within the same SPA only
  // after that boundary, retaining the previous successful QueryClient data.
  await page.waitForTimeout(15100)
  const failedRead = page.waitForResponse(response => response.url().endsWith('/api/studio/models') && response.status() === 503)
  await page.goBack()
  await failedRead
  await expect(page.getByText('聊天模型目录读取失败，请稍后刷新页面重新查询；不会自动发送。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: '聊天模型' }).getByRole('option', { name: '本地模型' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '会话列表' }).getByText('模型权限测试会话', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.t17SameDocument)).toBe('catalog-cache-test')
  expect(writes()).toBe(0)
})
