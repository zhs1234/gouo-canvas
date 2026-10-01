import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'
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
  await page.goto('./canvas')
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

test('Loomic menu opens the official canvas without matching its legacy canvas alias', async ({ page }) => {
  await localOnly(page)
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'route-fixture.png', mimeType: 'image/png', buffer: png })
  await saveDraft(page)
  const before = await exportScene(page)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '官方画布对照（保留旧草稿）', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/canvas-lab$/)
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '查看旧草稿（只读）', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '查看旧草稿（只读）', exact: true }).click()
  const importCopy = page.getByRole('button', { name: /^导入副本：/ }).first()
  await expect(importCopy).toBeVisible()
  await importCopy.click()
  await expect(page.getByRole('status')).toContainText('完整原始草稿快照已保留')
  const waiting = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出文档副本', exact: true }).click()
  const after = JSON.parse(await readFile(await (await waiting).path(), 'utf8'))
  expect(after.elements.filter(e => !e.isDeleted).map(e => e.id)).toEqual(before.elements.filter(e => !e.isDeleted).map(e => e.id))
  expect(after.files).toEqual(before.files)
})

test('image-only channels stay in image preferences and cannot submit an Agent request', async ({ page }) => {
  await mockAccount(page)
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: {
    generationEnabled: true, conversationMode: 'image', models: [{ id: 'fixture-image', displayName: '图片协议 fixture', kind: 'image', accessible: true, provider: 'Fixture', qualities: [], aspectRatios: [], operations: ['generate'] }],
  } } }))
  let calls = 0
  await page.route(/\/api\/studio\/(runs|images)$/, route => {
    calls++
    return route.abort()
  })
  await page.goto('./canvas')
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(page.getByText('Agent Model', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Auto (workspace default)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /图片协议 fixture/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByTitle('Image model', { exact: true }).click()
  await expect(page.getByRole('button', { name: '图片协议 fixture', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByLabel('输入消息', { exact: true }).fill('本地图片协议测试，不调用真实模型')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('尚未配置可用的对话模型，请先接通 New API 对话渠道', { exact: false })).toBeVisible()
  expect((await exportScene(page)).elements.filter(e => !e.isDeleted)).toHaveLength(0)
  expect(calls).toBe(0)
})

test('local project list reopens drafts and new projects start with an empty canvas', async ({ page }) => {
  await localOnly(page)
  await page.getByRole('button', { name: '矩形 (R)', exact: true }).click()
  const drawingArea = await page.locator('.excalidraw .interactive').boundingBox()
  expect(drawingArea).not.toBeNull()
  await page.mouse.move(drawingArea.x + 120, drawingArea.y + 220); await page.mouse.down()
  await page.mouse.move(drawingArea.x + 280, drawingArea.y + 350); await page.mouse.up()
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
  // 错误已显示不代表异步持久化完成；停止控件在 finally 等待写入后移除。
  await expect(page.getByRole('button', { name: '停止接收', exact: true })).toHaveCount(0)
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
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('fixture:seeded')) {
      localStorage.setItem('loomic:agent-model', 'fixture-image')
      localStorage.setItem('loomic:image-model-preference', JSON.stringify({ mode: 'manual', models: ['fixture-image'] }))
      sessionStorage.setItem('fixture:seeded', 'true')
    }
  })
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [
    { id: 'fixture-chat', displayName: '本地协议测试', kind: 'chat', accessible: true, provider: 'Fixture', description: '仅用于测试' },
    { id: 'fixture-image', displayName: '图片协议 fixture', kind: 'image', accessible: true, provider: 'Fixture', qualities: [], aspectRatios: [], operations: ['generate'] },
    { id: 'disabled-chat', displayName: '未验证对话模型', kind: 'chat', accessible: false, provider: 'Fixture' },
  ] } } }))
  let calls = 0
  await page.route('**/api/studio/runs/stream', route => {
    calls++
    account.billing.balance = 99.75; account.billing.spent = 0.25; account.billing.requestCount = 3
    const payload = route.request().postDataJSON()
    expect(payload.model).toBe('fixture-chat')
    expect(payload.imageGenerationPreference).toEqual({ mode: 'manual', models: ['fixture-image'] })
    expect(payload).not.toHaveProperty('accessToken')
    expect(route.request().headers().authorization).toBe(`Bearer ${account.token}`)
    expect(route.request().headers()['idempotency-key']).toBe(payload.runId)
    const base = { runId: payload.runId, timestamp: new Date().toISOString() }
    return route.fulfill({ contentType: 'text/event-stream', body: [
      { ...base, type: 'tool.started', toolCallId: 'fixture-call', toolName: 'generate_image' },
      { ...base, type: 'tool.completed', toolCallId: 'fixture-call', toolName: 'generate_image', artifacts: [{ type: 'image', url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32 }] },
      { ...base, type: 'message.delta', messageId: 'fixture-message', delta: '本地测试结果，未调用 AI。' },
      { ...base, type: 'run.completed', usage: { state: 'settled', currency: 'CNY', cost: 0.25, requestCount: 3 } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
  })
  await page.goto('./canvas')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('loomic:agent-model'))).toBeNull()
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(page.getByText('Agent Model', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /图片协议 fixture|未验证对话模型|生图 ·/ })).toHaveCount(0)
  await page.getByRole('button', { name: '本地协议测试', exact: true }).click()
  await page.getByTitle('Image model', { exact: true }).click()
  await expect(page.getByRole('button', { name: '图片协议 fixture', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manual', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '矩形 (R)', exact: true }).click()
  await page.mouse.move(200, 200); await page.mouse.down(); await page.mouse.move(420, 350); await page.mouse.up()
  await saveDraft(page)
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await openAccountSection(page)
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  await openAccountSection(page, 'billing')
  await expect(page.getByLabel('账户用量')).toContainText('100.00')
  await page.getByText('查看模型单价', { exact: true }).click()
  await expect(page.getByText('输入 ¥36.50 · 输出 ¥219.00 / 100万 token', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '关闭账号窗口', exact: true }).click()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  expect((await exportScene(page)).elements.filter(e => !e.isDeleted)).toHaveLength(0)
  await page.getByLabel('输入消息', { exact: true }).fill('只做本地协议测试')
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
  await expect(page.getByText('本地测试结果，未调用 AI。', { exact: true })).toBeVisible()
  await openAccountSection(page, 'billing')
  await expect(page.getByLabel('账户用量')).toContainText('¥99.75')
  await expect(page.getByText('调用记录折算：¥0.25（3 次模型调用）；实扣待核对。', { exact: true })).toBeVisible()
  await expect(page.getByText('New API 用量记录 · 1 倍 · 已调用 3 次', { exact: true })).toBeVisible()
  const reads = account.billingReads
  await page.getByRole('button', { name: '刷新用量', exact: true }).click()
  await expect.poll(() => account.billingReads).toBeGreaterThan(reads)
  await page.getByRole('button', { name: '关闭账号窗口', exact: true }).click()
  await expect(page.getByText('输入你的想法开始创作', { exact: true })).toHaveCount(0)
  await saveDraft(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '本地协议测试', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('loomic:agent-model'))).toBe('fixture-chat')
  await expect(page.getByText('本地测试结果，未调用 AI。', { exact: true })).toBeVisible()
  expect((await exportScene(page)).elements.filter(e => !e.isDeleted && e.type === 'image')).toHaveLength(1)
  expect(calls).toBe(1)
})

test('native image panel switches verified model parameters, preserves references and output aspect ratio', async ({ page }) => {
  const account = await mockAccount(page)
  const models = [
    { id: 'fixture-image-a', displayName: '协议模型 A', kind: 'image', accessible: true, provider: 'Fixture', qualities: ['xhigh'], aspectRatios: ['21:9'], operations: ['generate'] },
    { id: 'fixture-image-b', displayName: '协议模型 B', kind: 'image', accessible: true, provider: 'Fixture', qualities: ['max'], aspectRatios: ['1:1'], operations: ['generate', 'edit'] },
  ]
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models } } }))
  let calls = 0
  await page.route('**/api/studio/images', route => {
    calls++
    account.billing.balance = 99.56; account.billing.spent = 0.44; account.billing.requestCount = 1
    const payload = route.request().postDataJSON()
    expect(payload.payWithBalance).toBe(true)
    expect(payload.model).toBe('fixture-image-b')
    expect(payload.quality).toBe('max')
    expect(payload.aspectRatio).toBe('1:1')
    expect(payload.inputImages).toHaveLength(1)
    expect(payload.inputImages[0]).toMatch(/^data:image\/png;base64,/)
    return route.fulfill({ json: { success: true, data: { url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32, usage: { state: 'settled', currency: 'CNY', cost: 0.44, requestCount: 1 } } } })
  })
  await page.goto('./canvas')
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
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
  await page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额' }).last().check()
  await page.getByRole('button', { name: '生成图片', exact: true }).click()
  await expect(page.getByPlaceholder('今天我们要创作什么')).toHaveCount(0)
  const scene = await exportScene(page)
  const image = scene.elements.find(e => e.type === 'image' && !e.isDeleted)
  expect(image).toBeTruthy()
  expect(image.width / image.height).toBeCloseTo(1.5)
  expect(calls).toBe(1)
  await openAccountSection(page, 'billing')
  await expect(page.getByLabel('账户用量')).toContainText('¥99.56')
  await expect(page.getByText('调用记录折算：¥0.44（1 次模型调用）；实扣待核对。', { exact: true })).toBeVisible()
})

test('switching projects aborts the previous transport so late results cannot enter a new canvas', async ({ page }) => {
  await mockAccount(page)
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '仅限本地协议测试', kind: 'chat', accessible: true, provider: 'Fixture' }] } } }))
  let release; const gate = new Promise(resolve => { release = resolve })
  let received = false
  await page.route('**/api/studio/runs/stream', async route => {
    received = true
    const payload = route.request().postDataJSON()
    await gate
    const base = { runId: payload.runId, timestamp: new Date().toISOString() }
    await route.fulfill({ contentType: 'text/event-stream', body: [
      { ...base, type: 'tool.completed', toolCallId: 'fixture-late', toolName: 'generate_image', artifacts: [{ type: 'image', url: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', width: 48, height: 32 }] },
      { ...base, type: 'run.completed' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') }).catch(() => {}) // The browser aborts this explicit delayed fixture.
  })
  try {
    await page.goto('./canvas')
    await openAccountSection(page)
    await page.getByLabel('用户名', { exact: true }).fill('studio-user')
    await page.getByLabel('密码', { exact: true }).fill('test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
    await page.getByLabel('输入消息', { exact: true }).fill('本地隔离测试，不调用模型')
    await page.getByLabel('输入消息', { exact: true }).press('Enter')
    await expect.poll(() => received).toBe(true)
    const aborted = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith('/api/studio/runs/stream') })
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

test('Loomic Agent uses balance consent once and omits it on the next send', async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '测试聊天', kind: 'chat', accessible: true, provider: 'Fixture' }] } } }))
  const payloads = []
  await page.route('**/api/studio/runs/stream', route => {
    const payload = route.request().postDataJSON(); payloads.push(payload)
    const base = { runId: payload.runId, timestamp: new Date().toISOString() }
    return route.fulfill({ contentType: 'text/event-stream', body: [{ ...base, type: 'message.delta', delta: '同意测试回复' + payloads.length }, { ...base, type: 'run.completed' }].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') })
  })
  await page.goto('./canvas')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  const checkbox = page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额' })
  await expect(checkbox).not.toBeChecked()
  for (let i = 1; i <= 3; i++) {
    if (i === 2) await checkbox.check()
    await page.getByLabel('输入消息', { exact: true }).fill('同意测试' + i)
    await page.getByLabel('输入消息', { exact: true }).press('Enter')
    await expect(page.getByText('同意测试回复' + i, { exact: true })).toBeVisible()
    await expect(checkbox).not.toBeChecked()
  }
  expect(payloads[0]).not.toHaveProperty('payWithBalance')
  expect(payloads[1].payWithBalance).toBe(true)
  expect(payloads[2]).not.toHaveProperty('payWithBalance')
})

test('image client omits false consent and never retries failed paid sends', async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: false, models: [] } } }))
  const bodies = []
  await page.route('**/api/studio/images', route => {
    bodies.push(route.request().postDataJSON())
    return route.fulfill({ status: 503, json: { success: false, message: 'Explicit fixture failure' } })
  })
  await page.goto('./canvas')
  if (await page.getByRole('dialog', { name: '账号与设置', exact: true }).isVisible()) { await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible(); await closeAccount(page) }
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.evaluate(async () => {
    const api = await import('/studio/src/loomic/lib/server-api.ts')
    for (const value of [undefined, false, true]) {
      try { await api.generateImageDirect('local:7', 'fixture', { model: 'fixture', ...(value === undefined ? {} : { payWithBalance: value }) }) } catch {}
    }
  })
  expect(bodies).toHaveLength(3)
  expect(bodies[0]).not.toHaveProperty('payWithBalance')
  expect(bodies[1]).not.toHaveProperty('payWithBalance')
  expect(bodies[2].payWithBalance).toBe(true)
})
