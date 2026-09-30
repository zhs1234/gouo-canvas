import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'
async function setup(page) {
  const account = await mockAccount(page)
  account.active = true
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'chat', displayName: '测试聊天', kind: 'chat', accessible: true }, { id: 'image', displayName: '测试图片', kind: 'image', accessible: true }] } } }))
}
test('assistant-ui adapter renders structured tools/images and isolated in-memory threads', async ({ page }) => {
  await setup(page)
  let calls = 0
  await page.route('**/api/studio/runs/stream', route => {
    calls++
    const payload = route.request().postDataJSON()
    expect(route.request().headers()['idempotency-key']).toBe(payload.runId)
    expect(payload.imageGenerationPreference.models).toEqual(['image'])
    const events = [ { type: 'message.delta', delta: '正在生成' }, { type: 'tool.started', toolName: 'generate_image', toolCallId: 'tool-1' }, { type: 'tool.completed', toolCallId: 'tool-1', outputSummary: '完成', artifacts: [{ type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==' }] }, { type: 'message.delta', delta: '图片已准备好' }, { type: 'run.completed' } ]
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(e => `data: ${JSON.stringify({ ...e, runId: payload.runId })}\n\n`).join('') })
  })
  await page.goto('./chat-lab')
  await page.getByLabel('消息', { exact: true }).fill('生成测试图片')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('图片已准备好', { exact: true })).toBeVisible()
  await expect(page.getByText('图片生成工具', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片')).toBeVisible()
  await page.getByRole('button', { name: '＋ 新会话' }).click()
  await expect(page.getByAltText('生成图片')).toHaveCount(0)
  expect(calls).toBe(1)
})
test('assistant-ui error is visible without retry', async ({ page }) => {
  await setup(page)
  let calls = 0
  await page.route('**/api/studio/runs/stream', route => { calls++; return route.fulfill({ status: 503, json: { success: false, message: 'fixture failure' } }) })
  await page.goto('./chat-lab')
  await page.getByLabel('消息', { exact: true }).fill('测试错误')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不会自动重试')
  expect(calls).toBe(1)
})
test('Stop only stops reception with an explicit billing caveat', async ({ page }) => {
  await setup(page)
  await page.route('**/api/studio/runs/stream', async route => { await new Promise(r => setTimeout(r, 3000)); await route.abort().catch(() => {}) })
  await page.goto('./chat-lab')
  await page.getByLabel('消息', { exact: true }).fill('测试停止')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止接收', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('费用可能继续')
})
