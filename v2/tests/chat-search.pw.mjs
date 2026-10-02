import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

test('server title search finds unloaded history without writes and does not mix stale pagination', async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  const all = Array.from({ length: 56 }, (_, index) => ({ id: crypto.randomUUID(), title: `历史标记 ${String(55 - index).padStart(2, '0')}`, runs: [] }))
  let writes = 0, generated = 0, releasePage
  const delayedPage = new Promise(resolve => { releasePage = resolve })
  const queries = []
  page.on('request', request => {
    if (request.url().includes('/api/studio/') && request.method() !== 'GET') writes++
    if (request.url().includes('/api/studio/runs')) generated++
  })
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: false, models: [] } } }))
  await page.route('**/api/studio/threads?*', async route => {
    const url = new URL(route.request().url()), search = url.searchParams.get('search') ?? '', offset = Number(url.searchParams.get('offset') ?? 0)
    queries.push({ search, offset })
    if (!search && offset) await delayedPage
    const matches = all.filter(thread => thread.title.includes(search))
    await route.fulfill({ json: { success: true, data: { items: matches.slice(offset, offset + 50), nextOffset: matches.length > offset + 50 ? offset + 50 : null } } }).catch(() => {})
  })
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: all.slice(0, 50), nextOffset: 50 } } }))
  await page.route('**/api/studio/threads/*', route => {
    const thread = all.find(item => new URL(route.request().url()).pathname.endsWith(item.id))
    return route.fulfill({ status: thread ? 200 : 404, json: { success: Boolean(thread), ...(thread ? { data: thread } : { message: '会话不存在或无权访问' }) } })
  })
  await page.goto('./chat')
  const list = page.getByRole('navigation', { name: '会话列表' })
  await expect(list.getByText('历史标记 55', { exact: true })).toBeVisible()
  await expect(list.getByText('历史标记 01', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '更多会话', exact: true }).click()
  await expect.poll(() => queries.some(query => query.offset === 50)).toBe(true)
  await page.getByLabel('搜索会话', { exact: true }).fill('01')
  await expect(list.getByText('历史标记 01', { exact: true })).toBeVisible()
  releasePage()
  await expect(list.getByRole('button')).toHaveCount(2)
  await expect(list.getByText('历史标记 00', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '更多会话', exact: true })).toHaveCount(0)
  await page.getByLabel('搜索会话', { exact: true }).fill('没有匹配')
  await expect(list.getByText('未找到匹配的会话标题')).toBeVisible()
  await expect(page.getByLabel('搜索会话', { exact: true })).toBeVisible()
  await page.getByLabel('搜索会话', { exact: true }).fill('')
  await expect(list.getByText('历史标记 55', { exact: true })).toBeVisible()
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await expect(page.getByRole('alert')).toContainText('会话不存在或无权访问')
  await list.getByText('历史标记 55', { exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible()
  await expect(list.getByText('历史标记 55', { exact: true }).locator('..')).toHaveAttribute('aria-current', 'page')
  expect(queries.some(query => query.search === '01' && query.offset === 0)).toBe(true)
  expect(writes).toBe(0); expect(generated).toBe(0)
})
