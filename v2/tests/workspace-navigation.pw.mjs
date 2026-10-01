import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

async function fixture(page, active = false) {
  const account = await mockAccount(page); account.active = active
  const state = { writes: 0 }
  await page.route('**/api/studio/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() !== 'GET') state.writes++
    if (path.endsWith('/models')) return route.fulfill({ json: { success: true, data: { generationEnabled: false, models: [] } } })
    if (path.endsWith('/threads') || path.endsWith('/projects')) return route.fulfill({ json: { success: true, data: { items: active ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '本人导航会话' }] : [], nextOffset: null } } })
    return route.fulfill({ status: 503, json: { success: false, message: '明确导航测试 fixture，不进行生成' } })
  })
  return state
}
const nav = page => page.getByRole('navigation', { name: '主导航' })

test('bare root opens the complete chat and fixed desktop navigation returns through all workspaces', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
  await expect(nav(page)).toBeVisible()
  await nav(page).getByRole('link', { name: '画布', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/canvas-lab$/)
  await expect(page.locator('.excalidraw .App-toolbar')).toBeVisible()
  await nav(page).getByRole('link', { name: '项目库', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/projects$/)
  await expect(nav(page)).toBeVisible()
  await nav(page).getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
  expect(state.writes).toBe(0)
})

for (const path of ['', 'editor', 'board']) test(`legacy ${path || 'root'} canvas preserves the entire search and hash`, async ({ page }) => {
  const state = await fixture(page)
  const suffix = '?id=legacy-fixture&session=session-fixture&extra=a%2Fb#kept-fragment'
  await page.goto(`./${path}${suffix}`)
  await expect(page.getByTitle('New Chat', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(url => url.pathname === '/studio/canvas' && url.searchParams.get('id') === 'legacy-fixture' && url.searchParams.get('extra') === 'a/b' && Boolean(url.searchParams.get('session')) && url.hash === '#kept-fragment')
  await expect(nav(page)).toBeVisible()
  expect(state.writes).toBe(0)
})

test('Loomic initial and new session preserve unknown parameters and hash while removing prompt', async ({ page }) => {
  const state = await fixture(page)
  const canvasId = 'fixture-encoded'
  const params = new URLSearchParams({ id: canvasId, session: 'missing-legacy-session', extra: 'a/b & 中文', prompt: '' })
  await page.goto(`./?${params}#session-fragment`)
  await expect(page.getByTitle('New Chat', { exact: true })).toBeVisible()
  const preserved = url => url.pathname === '/studio/canvas' && url.searchParams.get('id') === canvasId && url.searchParams.get('extra') === 'a/b & 中文' && !url.searchParams.has('prompt') && url.hash === '#session-fragment'
  await expect(page).toHaveURL(url => preserved(url) && url.searchParams.get('session') !== 'missing-legacy-session')
  const firstSession = new URL(page.url()).searchParams.get('session')
  await page.getByTitle('New Chat', { exact: true }).click()
  await expect(page).toHaveURL(url => preserved(url) && Boolean(url.searchParams.get('session')) && url.searchParams.get('session') !== firstSession)
  expect(state.writes).toBe(0)
})

test('mobile drawer stays open for denied save and closes only after successful navigation', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./canvas-lab')
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '插入测试素材', exact: true })).toBeEnabled()
  await page.evaluate(() => { window.fixtureOriginalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('explicit fixture quota failure', 'QuotaExceededError') } })
  await page.getByRole('button', { name: '插入测试素材', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('保存失败')
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await nav(page).getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/canvas-lab$/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.fixtureOriginalPut })
  // Keyboard activation completes without a pointer-action retry after the Sheet unmounts.
  await nav(page).getByRole('link', { name: '聊天', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
})

test('independent owner and guest browser contexts do not share sidebar threads', async ({ browser, baseURL }) => {
  const ownerContext = await browser.newContext({ baseURL }), guestContext = await browser.newContext({ baseURL })
  try {
    const owner = await ownerContext.newPage(), guest = await guestContext.newPage()
    await fixture(owner, true); await fixture(guest)
    await owner.goto('./chat'); await guest.goto('./chat')
    await expect(owner.getByRole('button', { name: '本人导航会话', exact: true })).toBeVisible()
    await expect(guest.getByText('本人导航会话', { exact: true })).toHaveCount(0)
    await nav(owner).getByRole('link', { name: '画布', exact: true }).click()
    await nav(owner).getByRole('link', { name: '聊天', exact: true }).click()
    await expect(owner.getByRole('button', { name: '本人导航会话', exact: true })).toBeVisible()
    await expect(guest.getByText('本人导航会话', { exact: true })).toHaveCount(0)
  } finally { await ownerContext.close(); await guestContext.close() }
})
