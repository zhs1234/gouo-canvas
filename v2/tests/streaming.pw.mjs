import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

async function openStream(page) {
  await mockAccount(page)
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '流式协议 fixture', kind: 'chat', accessible: true, provider: 'Fixture' }] } } }))
  // 显式浏览器传输替身，保留真实 Fetch Response / ReadableStream 读取与 React 渲染。
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    window.streamFixture = { calls: 0 }
    window.fetch = async (url, init) => {
      if (url !== '/api/studio/runs/stream') return original(url, init)
      const state = window.streamFixture
      state.calls++
      state.payload = JSON.parse(init.body)
      state.authorization = new Headers(init.headers).get('Authorization')
      const base = { runId: state.payload.runId, timestamp: new Date().toISOString() }
      return new Response(new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          state.send = event => {
            const bytes = encoder.encode(`: keepalive\r\n\r\ndata: ${JSON.stringify({ ...base, ...event })}\r\n\r\n`)
            // 每字节分块，覆盖 UTF-8 汉字和 CRLF 帧边界。
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
          }
          state.close = () => controller.close()
          init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New API 账号', exact: true })).toHaveCount(0)
  await page.getByLabel('输入消息', { exact: true }).fill('仅测试流式协议')
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
  await expect.poll(() => page.evaluate(() => window.streamFixture.calls)).toBe(1)
}

test('SSE renders split UTF-8 deltas before completion and saves the complete reply', async ({ page }) => {
  await openStream(page)
  expect(await page.evaluate(() => window.streamFixture.authorization)).toBe('Bearer test-access-token')
  await page.evaluate(() => window.streamFixture.send({ type: 'message.delta', messageId: 'fixture', delta: '第一段汉字' }))
  await expect(page.getByText('第一段汉字', { exact: true })).toBeVisible()
  await page.evaluate(() => window.streamFixture.send({ type: 'message.delta', messageId: 'fixture', delta: '，第二段。' }))
  await expect(page.getByText('第一段汉字，第二段。', { exact: true })).toBeVisible()
  await page.evaluate(() => window.streamFixture.send({ type: 'run.completed', usage: { state: 'settled', currency: 'CNY', cost: 0, requestCount: 1 } }))
  await expect(page.getByLabel('输入消息', { exact: true })).toBeEnabled()
  // 终态渲染先于本地落盘；停止控件在 finally 等待保存完成后移除。
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('第一段汉字，第二段。', { exact: true })).toBeVisible()
})

test('stream EOF preserves partial reply and marks unknown outcome without resubmitting', async ({ page }) => {
  await openStream(page)
  await page.evaluate(() => {
    window.streamFixture.send({ type: 'message.delta', messageId: 'fixture', delta: '已收到的部分内容' })
    window.streamFixture.close()
  })
  await expect(page.getByText('已收到的部分内容', { exact: true })).toBeVisible()
  await expect(page.getByText('连接或生成事件异常，结果和费用待确认；请检查 New API 记录，不要重复提交。', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.streamFixture.calls)).toBe(1)
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('已收到的部分内容', { exact: true })).toBeVisible()
  await expect(page.getByText('连接或生成事件异常，结果和费用待确认；请检查 New API 记录，不要重复提交。', { exact: true })).toBeVisible()
})

test('Stop preserves received content and explicitly leaves provider outcome unconfirmed', async ({ page }) => {
  await openStream(page)
  await page.evaluate(() => window.streamFixture.send({ type: 'message.delta', messageId: 'fixture', delta: '停止前已收到' }))
  await expect(page.getByText('停止前已收到', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止接收', exact: true }).click()
  await expect(page.getByText('已停止接收；后台可能仍在生成，结果和费用待确认，请勿重复提交。', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.streamFixture.calls)).toBe(1)
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('停止前已收到', { exact: true })).toBeVisible()
  await expect(page.getByText('已停止接收；后台可能仍在生成，结果和费用待确认，请勿重复提交。', { exact: true })).toBeVisible()
})

test('refresh during reception retains partial history with an unfinished outcome marker', async ({ page }) => {
  await openStream(page)
  await page.evaluate(() => window.streamFixture.send({ type: 'message.delta', messageId: 'fixture', delta: '刷新前已收到' }))
  await expect(page.getByText('刷新前已收到', { exact: true })).toBeVisible()
  // 等待短节流窗口后，再模拟整个页面被关闭；不是网络自动恢复。
  await page.waitForTimeout(300)
  await page.reload()
  await expect(page.getByText('刷新前已收到', { exact: true })).toBeVisible()
  await expect(page.getByText('接收尚未完成，结果和费用待确认；请检查 New API 记录，不要重复提交。', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.streamFixture.calls)).toBe(0)
})
