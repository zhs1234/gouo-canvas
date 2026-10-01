import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

// F only: deterministic local HTTP responses exercise the actual React/SSE/GET
// code. These tests do not verify Native execution, paid billing or a Worker.
const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#a8cf74' } }).png().toBuffer()
const image = { url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32, prompt: '本地恢复 fixture' }
const models = [{ id: 'fixture-chat', displayName: '恢复聊天 fixture', kind: 'chat', accessible: true, provider: 'Fixture' },
  { id: 'fixture-image', displayName: '恢复图片 fixture', kind: 'image', accessible: true, provider: 'Fixture', qualities: [], aspectRatios: [], operations: ['generate'] }]
const frame = event => `data: ${JSON.stringify(event)}\n\n`
const saved = (kind, requestId, status, result) => ({ success: true, data: { kind, requestId, status, createdAt: '2026-10-02T00:00:00.000Z', ...(result ? { result } : {}) } })

async function setup(page) {
  const account = await mockAccount(page); account.active = true
  for (const endpoint of ['trial', 'access']) await page.route(`**/api/studio/${endpoint}`, route => route.fulfill({ status: 503, json: { success: false, message: '本浏览器fixture不提供试用/续用服务' } }))
  await page.addInitScript(() => localStorage.setItem('loomic:agent-model:local:7', 'fixture-chat'))
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models } } }))
  await page.goto('./canvas?id=sys-r2-fixture')
  await expect(page.getByLabel('输入消息', { exact: true })).toBeEnabled()
  return account
}
async function send(page, prompt) {
  await page.getByLabel('输入消息', { exact: true }).fill(prompt)
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
}
async function exportScene(page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出画布文件', exact: true }).click()
  return JSON.parse(await readFile(await (await download).path(), 'utf8'))
}
const liveImages = document => document.elements.filter(element => !element.isDeleted && element.type === 'image')

test('Loomic EOF restores the original failed terminal and image through GET, without duplicated text/image or new POST', async ({ page }) => {
  let posts = 0, runId, complete = false, events, reads = []
  await page.route('**/api/studio/runs/stream', route => {
    posts++; const payload = route.request().postDataJSON(); runId = payload.runId
    expect(route.request().headers()['idempotency-key']).toBe(runId)
    expect(payload).not.toHaveProperty('accessToken')
    const base = { runId, timestamp: new Date().toISOString() }
    events = [{ ...base, type: 'message.delta', delta: '已收到部分文本' },
      { ...base, type: 'tool.started', toolCallId: 'original-image', toolName: 'generate_image' },
      { ...base, type: 'tool.completed', toolCallId: 'original-image', toolName: 'generate_image', artifacts: [{ type: 'image', ...image }] }]
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(frame).join('') })
  })
  await page.route('**/api/studio/requests/agent/*/result', route => {
    expect(route.request().method()).toBe('GET'); reads.push(new URL(route.request().url()).pathname)
    return route.fulfill({ json: saved('agent', runId, complete ? 'completed' : 'running', complete ? { events: [...events,
      { type: 'message.delta', runId, delta: '，原请求后续文本' }, { type: 'run.failed', runId, error: { code: 'summary_failed', message: '原请求总结失败 fixture' } }] } : undefined) })
  })
  await setup(page); await send(page, '只发送一次的恢复 fixture')
  await expect(page.getByText('已收到部分文本', { exact: true })).toBeVisible()
  await expect(page.getByText('后台仍在处理；可再次读取原请求，未重新生成。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toHaveCount(0)
  expect(liveImages(await exportScene(page))).toHaveLength(1)
  complete = true
  await page.getByRole('button', { name: '读取原请求结果', exact: true }).click()
  await expect(page.getByText('已收到部分文本', { exact: true })).toHaveCount(1)
  await expect(page.getByText('，原请求后续文本', { exact: true })).toHaveCount(1)
  await expect(page.getByText('原请求总结失败 fixture', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '读取原请求结果', exact: true }).click()
  await expect.poll(() => reads.length).toBeGreaterThanOrEqual(3)
  const restored = await exportScene(page)
  expect(liveImages(restored)).toHaveLength(1)
  expect(Object.values(restored.files).map(file => file.dataURL)).toContain(image.url)
  expect(reads.every(path => path === `/api/studio/requests/agent/${runId}/result`)).toBe(true)
  expect(posts).toBe(1)
})

test('failed Loomic recovery reads retain partial text and original ID, with no automatic or manual model retry', async ({ page }) => {
  let posts = 0, runId, reads = []
  await page.route('**/api/studio/runs/stream', route => {
    posts++; runId = route.request().postDataJSON().runId
    return route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'message.delta', runId, delta: '读失败仍保留的内容' }) })
  })
  await page.route('**/api/studio/requests/agent/*/result', route => {
    expect(route.request().method()).toBe('GET'); reads.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 503, json: { success: false, message: 'fixture 只读恢复暂不可用' } })
  })
  await setup(page); await send(page, '读取失败 fixture')
  await expect(page.getByText('读失败仍保留的内容', { exact: true })).toBeVisible()
  await expect(page.getByText('读取失败，已收到内容保留；未重新生成。 fixture 只读恢复暂不可用', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '读取原请求结果', exact: true }).click()
  await expect.poll(() => reads.length).toBe(2)
  await expect(page.getByText('读失败仍保留的内容', { exact: true })).toBeVisible()
  expect(reads).toEqual(Array(2).fill(`/api/studio/requests/agent/${runId}/result`))
  expect(posts).toBe(1)
  await page.reload()
  await expect(page.getByText('读失败仍保留的内容', { exact: true })).toBeVisible()
  await expect(page.getByText('接收尚未完成，结果和费用待确认；请检查 New API 记录，不要重复提交。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '读取原请求结果', exact: true })).toHaveCount(0)
  expect(posts).toBe(1)
})

test('ambiguous image placeholder stores its original ID across reload and restores exact PNG through GET only', async ({ page }) => {
  let posts = 0, requestId, reads = []
  await page.route('**/api/studio/images', route => {
    posts++; requestId = route.request().headers()['idempotency-key']
    expect(route.request().method()).toBe('POST')
    return route.abort('connectionfailed')
  })
  await page.route('**/api/studio/requests/image/*/result', route => {
    expect(route.request().method()).toBe('GET'); reads.push(new URL(route.request().url()).pathname)
    // The actual bitmap supplies missing legacy geometry, no guessed dimensions.
    return route.fulfill({ json: saved('image', requestId, 'completed', { url: image.url }) })
  })
  await setup(page)
  await page.getByRole('button', { name: 'AI 生成图片', exact: true }).click()
  await page.getByPlaceholder('今天我们要创作什么', { exact: true }).fill('图片原请求 fixture')
  await page.getByRole('button', { name: '生成图片', exact: true }).click()
  await expect.poll(() => posts).toBe(1)
  await expect(page.getByRole('button', { name: '读取原图片结果', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '本地保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  const before = await exportScene(page), placeholder = before.elements.find(element => !element.isDeleted && element.customData?.type === 'image-generator')
  expect(placeholder.customData.requestId).toBe(requestId)
  expect(placeholder.customData.requestOwner).toBe('local:7')
  expect(placeholder.customData.status).toBe('awaiting')
  expect(JSON.stringify(placeholder.customData)).not.toContain('token')
  await page.reload()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  const box = await page.locator('.excalidraw .interactive').boundingBox(), state = before.appState
  const zoom = state.zoom?.value ?? 1
  await page.mouse.click(box.x + (placeholder.x + placeholder.width / 2 + (state.scrollX ?? 0)) * zoom,
    box.y + (placeholder.y + placeholder.height / 2 + (state.scrollY ?? 0)) * zoom)
  await expect.poll(() => reads.length).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('button', { name: '读取原图片结果', exact: true })).toHaveCount(0)
  const restored = await exportScene(page)
  expect(liveImages(restored)).toHaveLength(1)
  expect(Object.values(restored.files).map(file => file.dataURL)).toContain(image.url)
  expect(restored.elements.filter(element => !element.isDeleted && element.customData?.type === 'image-generator')).toHaveLength(0)
  expect(reads.every(path => path === `/api/studio/requests/image/${requestId}/result`)).toBe(true)
  expect(posts).toBe(1)
})

test('late A recovery cannot render or insert into B, and a stale A direct-image handler makes zero B POSTs', async ({ page }) => {
  let runId, posts = 0, release, reading = false
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/api/studio/runs/stream', route => {
    posts++; runId = route.request().postDataJSON().runId
    return route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'message.delta', runId, delta: 'A 本人部分内容' }) })
  })
  await page.route('**/api/studio/requests/agent/*/result', async route => {
    reading = true; await gate
    await route.fulfill({ json: saved('agent', runId, 'completed', { events: [{ type: 'message.delta', runId, delta: 'A 晚到私有结果' },
      { type: 'tool.completed', runId, toolCallId: 'late-image', artifacts: [{ type: 'image', ...image }] }, { type: 'run.completed', runId }] }) }).catch(() => {})
  })
  await page.route('**/api/studio/images', route => { posts++; return route.abort() })
  const account = await setup(page)
  await send(page, 'A 仅一次请求'); await expect.poll(() => reading).toBe(true)
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toHaveCount(0)
  await openAccountSection(page)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  const next = { id: 8, username: 'owner-eight', display_name: 'B 用户 fixture' }
  await page.route('**/api/user/login', route => {
    account.active = true; account.token = 'owner-eight-fixture'
    return route.fulfill({ json: { success: true, data: { access_token: account.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'owner-eight-session' }, user: next } } })
  })
  await page.route('**/api/user/self', route => route.request().headers().authorization === 'Bearer owner-eight-fixture'
    ? route.fulfill({ json: { success: true, data: next } }) : route.fallback())
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('owner-eight')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：B 用户 fixture', { exact: true })).toBeVisible(); await closeAccount(page)
  release()
  await expect(page.getByText('A 晚到私有结果', { exact: true })).toHaveCount(0)
  await expect(page.getByText('A 本人部分内容', { exact: true })).toHaveCount(0)
  const rejection = await page.evaluate(async () => {
    const { generateImageDirect } = await import('/studio/src/loomic/lib/server-api.ts')
    try { await generateImageDirect('local:7', '旧 A 处理器', { model: 'fixture-image' }, undefined, 'stale-owner-request'); return null }
    catch (error) { return { requestId: error.requestId, submitted: error.submitted, message: error.message } }
  })
  expect(rejection.requestId).toBe('stale-owner-request'); expect(rejection.submitted).toBe(false)
  expect(rejection.message).toContain('未发送图片请求')
  expect(liveImages(await exportScene(page))).toHaveLength(0)
  expect(posts).toBe(1)
})
