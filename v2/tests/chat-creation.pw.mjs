import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

async function creationFixture(page, id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') {
  const account = await mockAccount(page)
  account.active = true
  const metadata = { id, title: '新会话', createdAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T01:00:00Z' }
  const state = { creates: 0, sends: [], details: [], runs: [], pageErrors: [] }
  page.on('pageerror', error => state.pageErrors.push(error.message))
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: {
    generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '明确本地创建协议测试', kind: 'chat', accessible: true }],
  } } }))
  await page.route('**/api/studio/trial', route => route.fulfill({ json: { success: true, data: {
    state: 'disabled', message: '明确本地创建协议测试：试用关闭',
    chat: { limit: 0, used: 0, held: 0, remaining: 0 }, image: { limit: 0, used: 0, held: 0, remaining: 0 },
  } } }))
  await page.route('**/api/studio/access', route => route.fulfill({ json: { success: true, data: { state: 'disabled', message: '明确本地创建协议测试：权限关闭', canRenew: false } } }))
  await page.route('**/api/studio/threads', route => {
    if (route.request().method() === 'POST') {
      state.creates++
      expect(route.request().postDataJSON()).toEqual({ title: '新会话' })
      // Match history.create(): a successful new thread has metadata only.
      return route.fulfill({ json: { success: true, data: metadata } })
    }
    return route.fulfill({ json: { success: true, data: { items: state.creates ? [metadata] : [], nextOffset: null } } })
  })
  await page.route('**/api/studio/threads/*', route => {
    state.details.push({ pathname: new URL(route.request().url()).pathname, sends: state.sends.length })
    return route.fulfill({ json: { success: true, data: { ...metadata, runs: state.runs, nextOffset: null } } })
  })
  await page.route('**/api/studio/runs/stream', route => {
    const payload = route.request().postDataJSON()
    state.sends.push(payload)
    expect(payload.threadId).toBe(metadata.id)
    expect(route.request().headers()['idempotency-key']).toBe(payload.runId)
    const events = [
      { runId: payload.runId, type: 'message.delta', delta: '元信息创建后的完整回答' },
      { runId: payload.runId, type: 'run.completed' },
    ]
    state.runs.push({ runId: payload.runId, prompt: payload.prompt, status: 'completed', events })
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
  })
  return { metadata, state }
}

test('metadata-only creation sends once and restores the complete original history', async ({ page }) => {
  const { metadata, state } = await creationFixture(page)
  await page.goto('./chat')
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
  expect(state.creates).toBe(0)
  expect(state.sends).toEqual([])
  const prompt = '从真实元信息响应开始的首次明确发送'
  await page.getByLabel('消息', { exact: true }).fill(prompt)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('元信息创建后的完整回答', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`thread=${metadata.id}`))
  await expect.poll(() => state.details.length).toBeGreaterThan(0)
  expect(state.details.every(detail => detail.sends === 1)).toBe(true)
  expect(state.creates).toBe(1)
  expect(state.sends).toHaveLength(1)
  expect(state.sends[0].prompt).toBe(prompt)
  expect(state.runs).toHaveLength(1)
  expect(state.runs[0].events.at(-1).type).toBe('run.completed')
  expect(state.pageErrors).toEqual([])
  await page.reload()
  await expect(page.getByText(prompt, { exact: true })).toBeVisible()
  await expect(page.getByText('元信息创建后的完整回答', { exact: true })).toBeVisible()
  expect(state.creates).toBe(1)
  expect(state.sends).toHaveLength(1)
  expect(state.details.every(detail => detail.pathname.endsWith(metadata.id))).toBe(true)
  expect(state.pageErrors).toEqual([])
})

for (const id of ['', 'invalid-thread-id']) {
  test(`creation without a valid new thread ID preserves input and never sends (${id || 'empty'})`, async ({ page }) => {
    const { state } = await creationFixture(page, id)
    await page.goto('./chat')
    const prompt = '编号未确认时必须保留的原输入'
    await page.getByLabel('消息', { exact: true }).fill(prompt)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('会话创建未确认，已保留输入')
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue(prompt)
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
    expect(state.creates).toBe(1)
    expect(state.sends).toEqual([])
    expect(state.details).toEqual([])
    expect(state.pageErrors).toEqual([])
  })
}
