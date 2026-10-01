import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

async function setup(page, entry) {
  const account = await mockAccount(page); account.active = true
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { models: [{ id: 'chat', kind: 'chat', displayName: 'Fixture', accessible: true }] } } }))
  const thread = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Fixture', runs: [] }
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: [thread], nextOffset: null } } }))
  await page.route('**/api/studio/threads/*', route => route.fulfill({ json: { success: true, data: thread } }))
  let state = 'expired', reads = 0, writes = 0, generations = 0
  await page.route('**/api/studio/access', route => { reads++; return route.fulfill({ json: { success: true, data: { state, message: state === 'ready' ? '有限生成权限可用' : '生成权限已到期', canRenew: state === 'expired', version: 'a'.repeat(64) } } }) })
  await page.route('**/api/studio/access/renew', route => {
    writes++; expect(route.request().method()).toBe('POST')
    expect(route.request().headers().authorization).toBe(`Bearer ${account.token}`)
    expect(route.request().headers()['idempotency-key']).toMatch(/^[\da-f-]{36}$/)
    expect(route.request().postDataJSON()).toEqual({ version: 'a'.repeat(64), confirm: true })
    state = 'ready'
    return route.fulfill({ json: { success: true, data: { state: 'ready', message: '有限生成权限已续用；没有充值、重新领取试用或发送模型请求' } } })
  })
  await page.route('**/api/studio/runs/stream', route => { generations++; return route.abort() })
  await page.route('**/api/studio/images', route => { generations++; return route.abort() })
  await page.goto(entry)
  return { account, counts: () => ({ reads, writes, generations }) }
}

for (const entry of ['./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', './']) {
  test(`one explicit renewal clears prior consent without generation in ${entry}`, async ({ page }) => {
    const f = await setup(page, entry)
    const consent = page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额' })
    await consent.check()
    // An unrelated owner 71 must not clear owner 7's consent.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('gouo:clear-balance-consent', { detail: { owner: 'local:71' } })))
    await expect(consent).toBeChecked()
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    const panel = page.getByRole('region', { name: '生成权限' })
    await expect(panel).toContainText('不会清除 New API 钱包余额')
    await panel.getByRole('button', { name: '续用有限生成权限' }).click()
    await expect(panel).toContainText('没有充值、重新领取试用或发送模型请求')
    await expect(panel.getByRole('button', { name: '续用有限生成权限' })).toHaveCount(0)
    await page.getByRole('button', { name: entry.startsWith('./chat') ? '关闭账号' : '关闭账号窗口', exact: true }).click()
    await expect(consent).not.toBeChecked()
    expect(f.counts().writes).toBe(1); expect(f.counts().generations).toBe(0)
    expect(f.counts().reads).toBeGreaterThanOrEqual(2)
  })
}

for (const outcome of ['network', '401']) {
  test(`renewal ${outcome} is never resubmitted by refresh`, async ({ page }) => {
    const f = await setup(page, './chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    let writes = 0
    await page.route('**/api/studio/access/renew', route => { writes++; return outcome === 'network' ? route.abort() : route.fulfill({ status: 401, json: { success: false, message: 'fixture session expired' } }) })
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    const panel = page.getByRole('region', { name: '生成权限' })
    await panel.getByRole('button', { name: '续用有限生成权限' }).click()
    await expect(panel.getByRole('alert')).toContainText('请勿再次提交')
    await panel.getByRole('button', { name: '刷新生成权限' }).click()
    await expect(panel.getByRole('button', { name: '续用有限生成权限' })).toBeDisabled()
    expect(writes).toBe(1); expect(f.counts().generations).toBe(0)
  })
}

test('display name update sends only Unicode name, then confirms same owner; unknown writes stay blocked', async ({ page }) => {
  const f = await setup(page, './')
  let owner = 7, displayName = '测试用户', writes = 0, fail = false
  await page.route('**/api/user/self', route => {
    if (route.request().method() === 'PUT') {
      writes++; expect(Object.keys(route.request().postDataJSON())).toEqual(['display_name'])
      if (fail) return route.abort()
      displayName = route.request().postDataJSON().display_name
      return route.fulfill({ json: { success: true, message: '' } })
    }
    return route.fulfill({ json: { success: true, data: { id: owner, username: 'studio-user', display_name: displayName } } })
  })
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  const input = page.getByLabel('显示名称', { exact: true })
  await input.fill('😀'.repeat(21)); await page.getByRole('button', { name: '更新显示名称' }).click()
  await expect(page.getByText('显示名称需为 1–20 个字符')).toBeVisible(); expect(writes).toBe(0)
  await input.fill('😀'.repeat(20)); await page.getByRole('button', { name: '更新显示名称' }).click()
  await expect(page.getByText('显示名称已更新', { exact: true })).toBeVisible()
  await expect(page.getByText('当前账号：' + '😀'.repeat(20))).toBeVisible()
  fail = true
  await input.fill('新的名称'); await page.getByRole('button', { name: '更新显示名称' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '显示名称更新未确认' })).toBeVisible()
  await expect(page.getByRole('button', { name: '更新显示名称' })).toBeDisabled()
  expect(writes).toBe(2)
  await page.getByRole('button', { name: '退出登录' }).click()
  owner = 11; displayName = '另一个用户'
  await page.route('**/api/user/login', route => {
    f.account.token = 'fixture-other-owner'
    f.account.active = true
    return route.fulfill({ json: { success: true, data: { access_token: f.account.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'fixture-other-session' }, user: { id: owner, username: 'studio-user' } } } })
  })
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('fixture-other')
  await page.getByLabel('密码', { exact: true }).fill('fixture-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(input).toBeEnabled()
  await expect(page.getByText('当前账号：另一个用户')).toBeVisible()
  await expect(page.getByText('显示名称更新未确认', { exact: false })).toHaveCount(0)
  expect(writes).toBe(2)
})

test('disabled, incompatible, unknown and unavailable access never offer renewal', async ({ page }) => {
  const f = await setup(page, './chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  let state = 'disabled'
  await page.route('**/api/studio/access', route => route.fulfill({ json: { success: true, data: { state, message: `权限状态：${state}`, canRenew: false } } }))
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  const panel = page.getByRole('region', { name: '生成权限' })
  for (const next of ['disabled', 'incompatible', 'unknown', 'unavailable']) {
    state = next
    await panel.getByRole('button', { name: '刷新生成权限' }).click()
    await expect(panel).toContainText(`权限状态：${state}`)
    await expect(panel.getByRole('button', { name: '续用有限生成权限' })).toHaveCount(0)
  }
  expect(f.counts().writes).toBe(0); expect(f.counts().generations).toBe(0)
})
