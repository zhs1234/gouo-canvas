import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

for (const entry of ['./chat', './canvas']) {
  test(`trial panel queries only and preserves native billing in ${entry}`, async ({ page }) => {
    const account = await mockAccount(page)
    account.active = true
    let reads = 0, fail = false
    const trial = { state: 'eligible', message: '符合试用条件', chat: { limit: 4, remaining: 4, used: 0, held: 0 }, image: { limit: 1, remaining: 1, used: 0, held: 0 }, pendingReconciliation: false }
    await page.route('**/api/studio/trial', route => {
      expect(route.request().method()).toBe('GET')
      expect(route.request().headers().authorization).toBe(`Bearer ${account.token}`)
      reads++
      return route.fulfill({ status: fail ? 503 : 200, json: fail ? { success: false, message: '暂不可用' } : { success: true, data: trial } })
    })
    await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { models: [] } } }))
    await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
    await page.goto(entry)
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    const panel = page.getByRole('region', { name: '新用户试用' })
    await expect(panel.getByText(/首条发送满足开通条件/)).toBeVisible()
    await expect(page.getByLabel('账户用量')).toContainText('可用余额')
    trial.state = 'active'; trial.chat.remaining = 3; trial.chat.used = 1
    await panel.getByRole('button').click()
    await expect(panel).toContainText('聊天 3/4 次 · 图片 1/1 次')
    trial.state = 'pending'; trial.pendingReconciliation = true; trial.chat.remaining = 2; trial.chat.held = 1
    await panel.getByRole('button').click()
    await expect(panel).toContainText('已占用的次数暂不退回')
    trial.state = 'exhausted'; trial.pendingReconciliation = false; trial.chat.remaining = 0; trial.image.remaining = 0
    await panel.getByRole('button').click()
    await expect(panel.getByRole('link', { name: '前往 New API 充值' })).toHaveAttribute('href', '/wallet')
    for (const state of ['disabled', 'unavailable', 'ineligible']) {
      trial.state = state; trial.message = `试用状态：${state}`
      await panel.getByRole('button').click()
      await expect(panel).toContainText(trial.message)
      await expect(panel).not.toContainText('试用剩余')
      await expect(panel.getByRole('link')).toHaveCount(0)
    }
    trial.chat.preservedRemaining = 2; trial.image.preservedRemaining = 1
    trial.state = 'disabled'; trial.message = '原试用暂不可用'
    await panel.getByRole('button').click()
    await expect(panel).toContainText('原试用记录保留：聊天 2/4 次 · 图片 1/1 次，当前不可使用。余额付款不会扣除这些次数。')
    delete trial.chat.preservedRemaining; delete trial.image.preservedRemaining
    fail = true
    await panel.getByRole('button').click()
    await expect(panel.getByRole('alert')).toContainText('试用状态暂时无法读取')
    const failedReads = reads
    await page.waitForTimeout(1200)
    expect(reads).toBe(failedReads)
    fail = false; trial.state = 'active'
    await panel.getByRole('button').click()
    await expect(panel.getByRole('alert')).toHaveCount(0)
  })
}

test('switching native accounts never reuses previous trial counts', async ({ page }) => {
  let id = 7
  await page.route('**/api/user/**', route => {
    const path = new URL(route.request().url()).pathname
    const user = { id, username: `fixture-${id}`, display_name: `账号${id}` }
    return route.fulfill({ json: { success: true, data: path.endsWith('/self') ? user : { access_token: `fixture-owner-${id}`, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: `fixture-session-${id}` }, user } } })
  })
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { models: [] } } }))
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
  await page.route('**/api/studio/trial', route => {
    expect(route.request().headers().authorization).toBe(`Bearer fixture-owner-${id}`)
    return route.fulfill({ json: { success: true, data: { state: 'active', message: `本人试用${id}`, chat: { limit: 4, remaining: id === 7 ? 1 : 4, used: id === 7 ? 3 : 0, held: 0 }, image: { limit: 1, remaining: 1, used: 0, held: 0 }, pendingReconciliation: false } } })
  })
  await page.goto('./chat')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('region', { name: '新用户试用' })).toContainText('聊天 1/4 次')
  // Restore a different account after its native session changes.
  await page.evaluate(async () => {
    const api = await import('/studio/src/api.ts')
    await api.logout()
  })
  id = 11
  await page.evaluate(async () => {
    const api = await import('/studio/src/api.ts')
    await api.login('fixture-11', 'fixture-password')
  })
  // Reload exercises the native-cookie account restoration boundary.
  await page.reload()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  const panel = page.getByRole('region', { name: '新用户试用' })
  await expect(panel).toContainText('聊天 4/4 次')
  await expect(panel).not.toContainText('本人试用7')
})
