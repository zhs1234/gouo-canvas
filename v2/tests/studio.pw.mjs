import { test, expect } from '@playwright/test'

async function mockAccount(page) {
  const user = { id: 7, username: 'studio-user', display_name: '测试用户' }
  const state = { active: false, token: '', refreshes: 0, failLogout: false, rejectProfileOnce: false }
  const bundle = () => ({ access_token: state.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'test-session' }, user })
  await page.route('**/api/user/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = request.headers()
    if (path === '/api/user/login') {
      if (request.postDataJSON().password !== 'test-password') return route.fulfill({ json: { success: false, message: '用户名或密码错误' } })
      state.active = true; state.token = 'test-access-token'
      return route.fulfill({ json: { success: true, data: bundle() } })
    }
    if (path === '/api/user/auth/refresh') {
      state.refreshes += 1
      if (!state.active) return route.fulfill({ status: 401, json: { success: false, message: '未登录' } })
      state.token = `test-refresh-token-${state.refreshes}`
      return route.fulfill({ json: { success: true, data: bundle() } })
    }
    if (path === '/api/user/auth/logout') {
      expect(request.method()).toBe('POST')
      expect(headers.authorization).toBe(`Bearer ${state.token}`)
      expect(headers['x-auth-session']).toBe('test-session')
      if (state.failLogout) return route.fulfill({ status: 500, json: { success: false, message: '退出失败，请重试' } })
      state.active = false
      return route.fulfill({ json: { success: true } })
    }
    if (path === '/api/user/self' && state.rejectProfileOnce) {
      state.rejectProfileOnce = false
      return route.fulfill({ status: 401, json: { success: false, message: '会话已过期' } })
    }
    if (path === '/api/user/self' && state.active && headers.authorization === `Bearer ${state.token}`) {
      return route.fulfill({ json: { success: true, data: user } })
    }
    return route.fulfill({ status: 401, json: { success: false, message: '未登录' } })
  })
  return state
}

test('workspace, editor and export are usable without AI credentials', async ({ page }) => {
  await page.route('**/api/user/auth/refresh', (route) => route.fulfill({ status: 401, json: { success: false, message: '未登录' } }))
  await page.route('**/api/user/self', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, message: '未登录' }) }))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '商品创作工作台' })).toBeVisible()
  await page.getByRole('link', { name: '打开本地编辑器' }).click()
  await expect(page.getByRole('button', { name: '添加文字' })).toBeEnabled()
  await page.getByRole('button', { name: '添加文字' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PNG' }).click()
  expect((await download).suggestedFilename()).toBe('gouo-design-1280.png')
  await page.getByRole('link', { name: '模型接入清单' }).click()
  await expect(page.getByText('gpt-image-2.5-sunburst', { exact: true })).toBeVisible()
})

test('New API login, reload restoration and logout keep access tokens out of browser storage', async ({ page }) => {
  const account = await mockAccount(page)
  await page.goto('./')
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  expect(stored).not.toContain('test-access-token')
  expect(stored).not.toContain('test-password')
  await page.reload()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  expect(account.refreshes).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect(account.active).toBe(false)
})

test('invalid credentials and failed logout are reported without pretending authentication succeeded', async ({ page }) => {
  const account = await mockAccount(page)
  await page.goto('./')
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('用户名或密码错误', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  account.failLogout = true
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByText('退出失败，请重试', { exact: true })).toBeVisible()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
})

test('expired reads recover once while unauthorized writes are never automatically resubmitted', async ({ page }) => {
  const account = await mockAccount(page)
  account.rejectProfileOnce = true
  await page.goto('./')
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  let submissions = 0
  await page.route('**/api/studio/jobs', (route) => {
    submissions += 1
    return route.fulfill({ status: 401, json: { success: false, message: '会话已失效' } })
  })
  const result = await page.evaluate(async () => {
    const api = await import('/studio/src/api.ts')
    try { await api.request('/api/studio/jobs', { method: 'POST', body: '{}' }); return 'unexpected success' }
    catch (error) { return error.message }
  })
  expect(result).toBe('会话已失效')
  expect(submissions).toBe(1)
})

test('a successful envelope without a valid auth session cannot log the user in', async ({ page }) => {
  await mockAccount(page)
  await page.route('**/api/user/login', (route) => route.fulfill({ json: { success: true, data: { user: { id: 7, username: 'studio-user' } } } }))
  await page.goto('./')
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText(/登录响应缺少有效会话/)).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
})
