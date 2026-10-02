import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

async function fixture(page, signedIn = true) {
  const account = await mockAccount(page); account.active = signedIn
  let writes = 0
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/studio/') && request.method() !== 'GET') writes++ })
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: false, models: [] } } }))
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
  await page.route('**/api/studio/projects', route => route.fulfill({ json: { success: true, data: { items: [] } } }))
  await page.route('**/api/studio/trial', route => route.fulfill({ json: { success: true, data: { state: 'disabled', message: '验收替身：真实试用关闭', chat: { limit: 4, remaining: 0, used: 0, held: 0 }, image: { limit: 1, remaining: 0, used: 0, held: 0 } } } }))
  await page.route('**/api/studio/access', route => route.fulfill({ json: { success: true, data: { state: 'disabled', message: '验收替身：真实生成关闭', canRenew: false } } }))
  return { account, writes: () => writes }
}

for (const entry of ['./chat?fixture=account#keep', './canvas-lab?fixture=account#keep', './projects?fixture=account#keep', './canvas?id=account-layout&fixture=account#keep']) {
  test(`shared account settings keeps route, focus and native authority in ${entry}`, async ({ page }) => {
    const f = await fixture(page)
    await page.goto(entry)
    await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
    if (entry.startsWith('./canvas?')) { await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled(); await expect.poll(() => new URL(page.url()).searchParams.has('session')).toBe(true) }
    const original = page.url()
    const dialog = await openAccountSection(page)
    await expect(dialog.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
    await openAccountSection(page, 'billing')
    await expect(dialog.getByLabel('账户用量')).toContainText('100.00')
    await openAccountSection(page, 'trial')
    await expect(dialog.getByRole('region', { name: '新用户试用' })).toContainText('真实试用关闭')
    await openAccountSection(page, 'security')
    const link = dialog.getByRole('link', { name: '账号安全与登录会话', exact: true })
    await expect(link).toHaveAttribute('href', '/security')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(dialog.getByText('生成令牌管理的是模型访问权限与有限额度', { exact: false })).toBeVisible()
    await closeAccount(page)
    expect(page.url()).toBe(original)
    await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toBeFocused()
    expect(f.writes()).toBe(0)
  })
}

test('guest menu and login settings expose only available native account actions', async ({ page }) => {
  const f = await fixture(page, false)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '余额与用量', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '登录账号', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '账号与设置', exact: true })
  await expect(dialog.getByLabel('用户名', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('region', { name: '新用户试用' })).toHaveCount(0)
  await expect(dialog.getByLabel('账户用量')).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: /管理后台/ })).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: '注册账号', exact: true })).toHaveAttribute('target', '_blank')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toBeFocused()
  expect(f.writes()).toBe(0)
})

test('mobile account menu closes the drawer, traps settings focus and returns to the same canvas', async ({ page }) => {
  const f = await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./canvas-lab?fixture=mobile#keep')
  const original = page.url()
  await page.getByRole('button', { name: '切换侧栏', exact: true }).click()
  await openAccountSection(page, 'security')
  await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).not.toBeVisible()
  const dialog = page.getByRole('dialog', { name: '账号与设置', exact: true })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await closeAccount(page)
  expect(page.url()).toBe(original)
  await expect(page.getByRole('button', { name: '切换侧栏', exact: true })).toBeFocused()
  await expect(page.getByRole('checkbox', { name: '素材库', exact: true })).toBeVisible()
  expect(f.writes()).toBe(0)
})

test('uncertain generation renewal survives settings close and workspace navigation without replay', async ({ page }) => {
  const f = await fixture(page)
  let renewals = 0
  await page.route('**/api/studio/access', route => route.fulfill({ json: { success: true, data: { state: 'expired', canRenew: true, message: '明确过期权限替身', version: 'a'.repeat(64) } } }))
  await page.route('**/api/studio/access/renew', route => { renewals++; return route.abort() })
  await page.goto('./chat')
  await openAccountSection(page, 'access')
  await page.getByRole('button', { name: '续用有限生成权限', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '续用未确认' })).toBeVisible()
  await closeAccount(page)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '项目库', exact: true }).click()
  await expect(page).toHaveURL(/\/projects$/)
  await openAccountSection(page, 'access')
  await expect(page.getByRole('button', { name: '续用有限生成权限', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '刷新生成权限', exact: true }).click()
  await expect(page.getByRole('button', { name: '续用有限生成权限', exact: true })).toBeDisabled()
  expect(renewals).toBe(1)
  expect(f.writes()).toBe(1)
})

test('account menu keyboard navigation and Escape restore the trigger', async ({ page }) => {
  await fixture(page)
  await page.goto('./chat')
  const trigger = page.getByRole('button', { name: 'New API 账号', exact: true })
  await expect(trigger).toContainText('测试用户')
  await trigger.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: '账号与设置', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

for (const width of [996, 390]) {
  test(`short ${width}px settings keep close and categories reachable while the body scrolls`, async ({ page }) => {
    await fixture(page, false)
    await page.setViewportSize({ width, height: 500 })
    await page.goto('./chat')
    await page.getByRole('button', { name: '登录账号', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '账号与设置', exact: true })
    const input = dialog.getByLabel('用户名', { exact: true })
    expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(40)
    expect(await input.evaluate(el => parseFloat(getComputedStyle(el).borderLeftWidth))).toBeGreaterThan(0)
    const body = dialog.locator('.workspace-account-body')
    await body.hover(); await page.mouse.wheel(0, 1800)
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    for (const control of [dialog.getByRole('button', { name: '关闭账号窗口', exact: true }), dialog.getByRole('navigation', { name: '账号设置分类' })]) {
      const bounds = await control.boundingBox()
      expect(bounds.y).toBeGreaterThanOrEqual(0)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(500)
    }
    await dialog.getByRole('navigation', { name: '账号设置分类' }).getByRole('button', { name: '安全与会话', exact: true }).click()
    await expect(dialog.getByRole('region', { name: '安全与会话' })).toBeVisible()
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}
