import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'

// Explicit deterministic transport fixtures. These checks do not generate AI
// images or call a paid model. Real account integration is verified separately.
const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#a8cf74' } }).png().toBuffer()
async function localOnly(page) {
  await page.route('**/api/user/auth/refresh', route => route.fulfill({ status: 401, json: { success: false, message: '未登录' } }))
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: false, models: [] } } }))
  await page.goto('./')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await expect(page.getByText('Loading scene…', { exact: true })).toHaveCount(0)
}
async function exportScene(page) {
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出画布文件', exact: true }).click()
  return JSON.parse(await readFile(await (await download).path(), 'utf8'))
}
async function saveDraft(page) {
  await page.getByRole('button', { name: '本地保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await expect(page.getByText('已保存在当前浏览器', { exact: true }).last()).toBeVisible()
}

test('Loomic canvas imports, saves, reloads and exports without a cloud account', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await localOnly(page)
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'local-fixture.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('输入你的想法开始创作', { exact: true })).toHaveCount(0)
  await saveDraft(page)
  const before = await exportScene(page)
  expect(before.elements.filter(e => !e.isDeleted && e.type === 'image')).toHaveLength(1)
  expect(Object.keys(before.files)).toHaveLength(1)
  await page.reload()
  await expect(page.getByText('Loading scene…', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  const after = await exportScene(page)
  expect(after.elements.filter(e => !e.isDeleted && e.type === 'image')).toHaveLength(1)
  expect(Object.keys(after.files)).toHaveLength(1)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const output = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出 PNG', exact: true }).click()
  expect((await output).suggestedFilename()).toBe('gouo-canvas.png')
  expect(errors).toEqual([])
})

test('local project list reopens drafts and new projects start with an empty canvas', async ({ page }) => {
  await localOnly(page)
  await page.getByRole('button', { name: '矩形 (R)', exact: true }).click()
  await page.mouse.move(200,200); await page.mouse.down(); await page.mouse.move(420,350); await page.mouse.up()
  await saveDraft(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '项目库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本地创作' })).toBeVisible()
  await page.getByRole('link', { name: /未命名创作/ }).first().click()
  const existing = await exportScene(page)
  expect(existing.elements.filter(e => !e.isDeleted && e.type === 'rectangle')).toHaveLength(1)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建项目', exact: true }).click()
  await expect(page.getByText('输入你的想法开始创作', { exact: true })).toBeVisible()
  expect((await exportScene(page)).elements.filter(e => !e.isDeleted)).toHaveLength(0)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除当前项目', exact: true }).click()
  await page.getByRole('menuitem', { name: '确认删除?', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本地创作', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /未命名创作/ })).toHaveCount(1)
})

test('failed agent requests show the actual error and local conversation survives reload', async ({ page }) => {
  await localOnly(page)
  await page.getByLabel('输入消息', { exact: true }).fill('测试请求，不调用付费模型')
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
  await expect(page.getByText('请先登录 New API 账号', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText('测试请求，不调用付费模型', { exact: true })).toBeVisible()
  await expect(page.getByText('请先登录 New API 账号', { exact: false })).toBeVisible()
})

test('canvas and chat remain usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await localOnly(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  await expect(page.getByRole('button', { name: 'AI 生成视频', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'AI 生成图片', exact: true }).click()
  const generationPanel = page.getByPlaceholder('今天我们要创作什么').locator('..')
  const bounds = await generationPanel.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  await page.mouse.click(10, 150)
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.getByText('Loomic Agent', { exact: true })).toBeVisible()
  await expect.poll(async () => { const b = await page.getByLabel('输入消息', { exact: true }).boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= 391 }).toBe(true)
})

test('fixture agent results enter the canvas and persist; requests contain only account authorization', async ({ page }) => {
  const account = await mockAccount(page)
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '本地协议测试', kind: 'chat', accessible: true, provider: 'Fixture', description: '仅用于测试' }] } } }))
  let calls = 0
  await page.route('**/api/studio/runs', route => {
    calls++
    const payload = route.request().postDataJSON()
    expect(payload).not.toHaveProperty('accessToken')
    expect(route.request().headers().authorization).toBe(`Bearer ${account.token}`)
    expect(route.request().headers()['idempotency-key']).toBe(payload.runId)
    const base = { runId: payload.runId, timestamp: new Date().toISOString() }
    return route.fulfill({ json: { success: true, data: { events: [
      { ...base, type: 'tool.started', toolCallId: 'fixture-call', toolName: 'generate_image' },
      { ...base, type: 'tool.completed', toolCallId: 'fixture-call', toolName: 'generate_image', artifacts: [{ type: 'image', url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32 }] },
      { ...base, type: 'message.delta', messageId: 'fixture-message', delta: '本地测试结果，未调用 AI。' },
      { ...base, type: 'run.completed' },
    ] } } })
  })
  await page.goto('./')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '矩形 (R)', exact: true }).click()
  await page.mouse.move(200, 200); await page.mouse.down(); await page.mouse.move(420, 350); await page.mouse.up()
  await saveDraft(page)
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toHaveText('测试用户')
  await expect(page.getByRole('dialog', { name: 'New API 账号', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toHaveText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭账号窗口', exact: true }).click()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  expect((await exportScene(page)).elements.filter(e => !e.isDeleted)).toHaveLength(0)
  await page.getByLabel('输入消息', { exact: true }).fill('只做本地协议测试')
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
  await expect(page.getByText('本地测试结果，未调用 AI。', { exact: true })).toBeVisible()
  await expect(page.getByText('输入你的想法开始创作', { exact: true })).toHaveCount(0)
  await saveDraft(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await expect(page.getByText('本地测试结果，未调用 AI。', { exact: true })).toBeVisible()
  expect((await exportScene(page)).elements.filter(e => !e.isDeleted && e.type === 'image')).toHaveLength(1)
  expect(calls).toBe(1)
})

test('native image panel switches verified model parameters, preserves references and output aspect ratio', async ({ page }) => {
  await mockAccount(page)
  const models = [
    { id: 'fixture-image-a', displayName: '协议模型 A', kind: 'image', accessible: true, provider: 'Fixture', qualities: ['xhigh'], aspectRatios: ['21:9'], operations: ['generate'] },
    { id: 'fixture-image-b', displayName: '协议模型 B', kind: 'image', accessible: true, provider: 'Fixture', qualities: ['max'], aspectRatios: ['1:1'], operations: ['generate', 'edit'] },
  ]
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models } } }))
  let calls = 0
  await page.route('**/api/studio/images', route => {
    calls++
    const payload = route.request().postDataJSON()
    expect(payload.model).toBe('fixture-image-b')
    expect(payload.quality).toBe('max')
    expect(payload.aspectRatio).toBe('1:1')
    expect(payload.inputImages).toHaveLength(1)
    expect(payload.inputImages[0]).toMatch(/^data:image\/png;base64,/)
    return route.fulfill({ json: { success: true, data: { url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32 } } })
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toHaveText('测试用户')
  await expect(page.getByRole('dialog', { name: 'New API 账号', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'AI 生成图片', exact: true }).click()
  await expect(page.getByRole('button', { name: 'xhigh', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '21:9', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加参考图', exact: true }).last()).toBeDisabled()
  await page.getByRole('button', { name: '协议模型 A', exact: true }).click()
  await page.getByRole('button', { name: '协议模型 B', exact: true }).click()
  await expect(page.getByRole('button', { name: 'max', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1:1', exact: true })).toBeVisible()
  await page.locator('input[type="file"][multiple]').last().setInputFiles({ name: 'local-reference.png', mimeType: 'image/png', buffer: png })
  await expect(page.locator('img[alt="ref"]')).toHaveCount(1)
  await page.getByPlaceholder('今天我们要创作什么').fill('本地协议 fixture，不调用付费模型')
  await page.getByRole('button', { name: '生成图片', exact: true }).click()
  await expect(page.getByPlaceholder('今天我们要创作什么')).toHaveCount(0)
  const scene = await exportScene(page)
  const image = scene.elements.find(e => e.type === 'image' && !e.isDeleted)
  expect(image).toBeTruthy()
  expect(image.width / image.height).toBeCloseTo(1.5)
  expect(calls).toBe(1)
})

test('switching projects aborts the previous transport so late results cannot enter a new canvas', async ({ page }) => {
  await mockAccount(page)
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '仅限本地协议测试', kind: 'chat', accessible: true, provider: 'Fixture' }] } } }))
  let release; const gate = new Promise(resolve => { release = resolve })
  let received = false
  await page.route('**/api/studio/runs', async route => {
    received = true
    const payload = route.request().postDataJSON()
    await gate
    const base = { runId: payload.runId, timestamp: new Date().toISOString() }
    await route.fulfill({ json: { success: true, data: { events: [
      { ...base, type: 'tool.completed', toolCallId: 'fixture-late', toolName: 'generate_image', artifacts: [{ type: 'image', url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32 }] },
      { ...base, type: 'run.completed' },
    ] } } }).catch(() => {}) // The browser aborts this explicit delayed fixture.
  })
  try {
    await page.goto('./')
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    await page.getByLabel('用户名', { exact: true }).fill('studio-user')
    await page.getByLabel('密码', { exact: true }).fill('test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toHaveText('测试用户')
  await expect(page.getByRole('dialog', { name: 'New API 账号', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
    await page.getByLabel('输入消息', { exact: true }).fill('本地隔离测试，不调用模型')
    await page.getByLabel('输入消息', { exact: true }).press('Enter')
    await expect.poll(() => received).toBe(true)
    const aborted = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith('/api/studio/runs') })
    const previousId = new URL(page.url()).searchParams.get('id') || 'draft'
    await page.getByRole('button', { name: '菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '新建项目', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('id') || 'draft').not.toBe(previousId)
    await expect(page.getByText('本地隔离测试，不调用模型', { exact: true })).toHaveCount(0)
    // Release intercepted network traffic before awaiting Chromium's failure
    // event: its delivery can wait for the route handler to finish.
    release()
    await aborted
    await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
    expect((await exportScene(page)).elements.filter(e => !e.isDeleted)).toHaveLength(0)
    await expect(page.getByText('本地隔离测试，不调用模型', { exact: true })).toHaveCount(0)
  } finally { release() }
})
