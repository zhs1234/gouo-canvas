import { test, expect } from '@playwright/test'

import { mockAccount } from './account-fixture.mjs'

test('New API login, reload restoration and logout keep access tokens out of browser storage', async ({ page }) => {
  const account = await mockAccount(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  expect(stored).not.toContain('test-access-token')
  expect(stored).not.toContain('test-password')
  await page.reload()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  expect(account.refreshes).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect(account.active).toBe(false)
})

test('invalid credentials and failed logout are reported without pretending authentication succeeded', async ({ page }) => {
  const account = await mockAccount(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('用户名或密码错误', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
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
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
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
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText(/登录响应缺少有效会话/)).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
})


test('account entry reuses pinned native routes on the same origin', async ({ page }) => {
  await mockAccount(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  for (const [name, path] of [
    ['前往 New API 登录', '/sign-in?redirect=%2Fstudio%2F'],
    ['注册账号', '/sign-up'], ['忘记密码', '/forgot-password'],
    ['账号资料', '/profile'], ['账号安全与登录会话', '/security'],
    ['余额与充值', '/wallet'], ['用量记录', '/usage-logs'],
    ['管理后台（需要管理员权限）', '/users'],
  ]) {
    const link = page.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('href', path)
    expect(await link.evaluate(a => new URL(a.href).origin)).toBe(new URL(page.url()).origin)
  }
})

test('native login return restores the account without a Studio password submission', async ({ page }) => {
  const account = await mockAccount(page)
  account.active = true
  let logins = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/user/login') logins++ })
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  expect(logins).toBe(0)
  expect(account.refreshes).toBeGreaterThan(0)
})

test('logout cannot claim success when upstream preserves a different browser session', async ({ page }) => {
  const account = await mockAccount(page)
  account.active = true
  await page.route('**/api/user/auth/logout', route => route.fulfill({ json: {
    success: true, data: { revoked_sid: 'test-session', cookie_cleared: false },
  } }))
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByText('浏览器会话已切换，请刷新页面后再退出登录', { exact: true })).toBeVisible()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
})

test('disabled or revoked native session restores as anonymous and cannot submit business writes', async ({ page }) => {
  const account = await mockAccount(page)
  account.active = true
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  account.active = false
  await page.reload()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
  let submissions = 0
  await page.route('**/api/studio/jobs', route => { submissions++; return route.fulfill({ json: { success: true } }) })
  const result = await page.evaluate(async () => {
    const api = await import('/studio/src/api.ts')
    try { await api.request('/api/studio/jobs', { method: 'POST', body: '{}' }); return 'unexpected success' }
    catch (error) { return error.message }
  })
  expect(result).toBe('请先登录 New API 账号')
  expect(submissions).toBe(0)
})
