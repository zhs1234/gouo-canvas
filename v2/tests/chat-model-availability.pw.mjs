import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'

const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
test('model intent survives five minutes away from chat without adopting the first model', async ({ page }) => {
  await page.clock.install()
  const writes = await setup(page, { generationEnabled: true, models: ['a', 'b'].map(id => ({ id: `chat-${id}`, displayName: `聊天 ${id.toUpperCase()}`, kind: 'chat', accessible: true })) })
  await page.getByRole('combobox', { name: '聊天模型', exact: true }).selectOption('chat-b')
  await page.route('**/api/studio/projects', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
  await page.getByRole('link', { name: '项目库', exact: true }).click()
  await page.clock.fastForward(300001)
  await page.goBack()
  await expect(page.getByRole('combobox', { name: '聊天模型', exact: true })).toHaveValue('chat-b')
  expect(writes()).toBe(0)
})
async function setup(page, catalog, status = 200, savedRuns = []) {
  const account = await mockAccount(page); account.active = true
  let writes = 0
  page.on('request', request => { if (request.url().includes('/api/studio/') && request.method() !== 'GET') writes++ })
  await page.route('**/api/studio/models', route => route.fulfill({ status, json: status === 200 ? { success: true, data: catalog } : { success: false, message: 'private-channel/internal-group/secret-price must not render' } }))
  const thread = { id: threadId, title: '模型权限测试会话', runs: savedRuns }
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: [thread], nextOffset: null } } }))
  await page.route('**/api/studio/threads/*', route => route.fulfill({ json: { success: true, data: thread } }))
  await page.goto(`./chat?thread=${threadId}`)
  return () => writes
}

for (const fixture of [
  { name: 'group permission', description: '当前账号分组没有此模型权限，请联系管理员', enabled: true, message: '当前账号没有可用聊天模型的使用权限，请联系管理员核对。' },
  { name: 'generation disabled', description: '尚未配置或验证', enabled: false, message: '生成服务尚未开放，请联系管理员；当前不能发送模型请求。' },
  { name: 'unverified model', description: 'private-channel/internal-group/secret-price must not render', enabled: true, message: '当前暂无已配置并验证的可用聊天模型，请联系管理员核对。' },
  { name: 'catalog failure', description: '', enabled: true, status: 503, message: '聊天模型目录读取失败，请稍后刷新页面重新查询；不会自动发送。' },
]) test(`unavailable chat ${fixture.name} explains refusal without enabling controls or sending writes`, async ({ page }) => {
  const writes = await setup(page, { generationEnabled: fixture.enabled, models: [{ id: 'fixture-chat', displayName: '本地模型', kind: 'chat', accessible: false, description: fixture.description }] }, fixture.status)
  await expect(page.getByText(fixture.message, { exact: true })).toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).toBeDisabled()
  await expect(page.getByText('private-channel/internal-group/secret-price must not render', { exact: true })).toHaveCount(0)
  expect(writes()).toBe(0)
})

test('available chat keeps the normal composer and does not show an unavailable notice', async ({ page }) => {
  const writes = await setup(page, { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '本地模型', kind: 'chat', accessible: true, description: '已配置并经过渠道验证' }] })
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await page.getByLabel('消息', { exact: true }).fill('准备消息，不发送')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await expect(page.locator('.studio-chat-notice')).toHaveCount(0)
  expect(writes()).toBe(0)
})

test('failed SPA catalog refresh disables cached successful models without discarding history or posting', async ({ page }) => {
  const writes = await setup(page, { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '本地模型', kind: 'chat', accessible: true, description: '已配置并经过渠道验证' }] })
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await page.evaluate(() => { window.t17SameDocument = 'catalog-cache-test' })
  await page.route('**/api/studio/models', route => route.fulfill({ status: 503, json: { success: false, message: 'Synthetic catalog read failure' } }))
  await page.route('**/api/studio/projects', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
  await page.getByRole('link', { name: '项目库', exact: true }).click()
  // The real app uses a 15-second staleTime. Remount within the same SPA only
  // after that boundary, retaining the previous successful QueryClient data.
  await page.waitForTimeout(15100)
  const failedRead = page.waitForResponse(response => response.url().endsWith('/api/studio/models') && response.status() === 503)
  await page.goBack()
  await failedRead
  await expect(page.getByText('聊天模型目录读取失败，请稍后刷新页面重新查询；不会自动发送。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: '聊天模型' }).getByRole('option', { name: '本地模型' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '会话列表' }).getByText('模型权限测试会话', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.t17SameDocument)).toBe('catalog-cache-test')
  expect(writes()).toBe(0)
})

for (const kind of ['chat', 'image']) test(`partial ${kind} permission loss keeps the chosen ID through fresh cache and requires explicit reselection`, async ({ page }) => {
  test.setTimeout(60000)
  const models = [
    { id: 'chat-a', displayName: '聊天 A', kind: 'chat', accessible: true },
    { id: 'chat-b', displayName: '聊天 B', kind: 'chat', accessible: true },
    { id: 'image-a', displayName: '图片 A', kind: 'image', accessible: true },
    { id: 'image-b', displayName: '图片 B', kind: 'image', accessible: true },
  ]
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='
  const writes = await setup(page, { generationEnabled: true, models }, 200, [{ runId: 'completed-fixture', prompt: '已完成的原图', status: 'completed', events: [{ type: 'message.delta', delta: '已完成输出保留' }, { type: 'tool.completed', toolCallId: 'completed-tool', toolName: 'generate_image', outputSummary: '明确历史 fixture', artifacts: [{ type: 'image', url: image }] }, { type: 'run.completed' }] }])
  const selector = page.getByRole('combobox', { name: kind === 'chat' ? '聊天模型' : '图片模型', exact: true })
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await selector.selectOption(`${kind}-b`)
  await page.getByLabel('消息', { exact: true }).fill('保留未发送输入')
  await page.getByLabel('本次允许使用本人 New API 余额', { exact: true }).check()
  await page.route('**/api/studio/projects', route => route.fulfill({ json: { success: true, data: { items: [], nextOffset: null } } }))
  await page.evaluate(() => { window.permissionSameDocument = 'partial-loss' })
  // A route round-trip while the catalog is fresh must keep explicit B,
  // rather than resetting the selection to the first model A.
  await page.getByRole('link', { name: '项目库', exact: true }).click()
  await page.goBack()
  await expect(selector).toHaveValue(`${kind}-b`)
  expect(writes()).toBe(0)
  await page.getByLabel('消息', { exact: true }).fill('权限刷新后仍保留的输入')
  await page.getByLabel('本次允许使用本人 New API 余额', { exact: true }).check()
  let release
  let queried = false
  await page.route('**/api/studio/models', async route => {
    queried = true
    await new Promise(resolve => { release = resolve })
    return route.fulfill({ json: { success: true, data: { generationEnabled: true, models: models.map(model => ({ ...model, accessible: model.id !== `${kind}-b` })) } } })
  })
  await page.getByRole('button', { name: '刷新可用模型', exact: true }).click()
  await expect.poll(() => queried).toBe(true)
  await expect(page.getByLabel('消息', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '刷新可用模型', exact: true })).toBeDisabled()
  await expect(page.getByText('正在核对可用模型，完成前不能发送。', { exact: true })).toBeVisible()
  expect(writes()).toBe(0)
  release()
  const notice = kind === 'chat' ? '此前选择的聊天模型当前不可用，请重新选择聊天模型；不会自动切换或发送。' : '此前选择的图片模型当前不可用，请重新选择图片模型后发送；不会自动切换或发送。'
  await expect(page.getByText(notice, { exact: true })).toBeVisible()
  await expect(selector).toHaveValue('')
  await expect(selector.getByRole('option', { name: kind === 'chat' ? '聊天 A' : '图片 A', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).not.toBeChecked()
  await expect(page.getByRole('navigation', { name: '会话列表' }).getByText('模型权限测试会话', { exact: true })).toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('权限刷新后仍保留的输入')
  await expect(page.getByText('已完成输出保留', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片')).toHaveAttribute('src', image)
  expect(await page.evaluate(() => window.permissionSameDocument)).toBe('partial-loss')
  expect(writes()).toBe(0)
  await selector.selectOption(`${kind}-a`)
  await expect(page.getByText(notice, { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).not.toBeChecked()
  await page.getByLabel('消息', { exact: true }).fill('本人重新选择后的明确发送')
  let sent
  await page.route('**/api/studio/runs/stream', route => {
    sent = route.request().postDataJSON()
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'message.delta', runId: sent.runId, delta: '明确选择后的 fixture 回复' })}\n\ndata: ${JSON.stringify({ type: 'run.completed', runId: sent.runId })}\n\n` })
  })
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => sent?.model).toBe('chat-a')
  expect(sent.imageGenerationPreference.models).toEqual(['image-a'])
  expect(sent).not.toHaveProperty('payWithBalance')
  expect(writes()).toBe(1)
})

test('same model ID recovery restores original intent without new consent, and mobile refresh stays in bounds', async ({ page }) => {
  const original = { generationEnabled: true, models: [
    { id: 'chat-b', displayName: '聊天 B', kind: 'chat', accessible: true },
    { id: 'chat-a', displayName: '聊天 A', kind: 'chat', accessible: true },
    { id: 'image-b', displayName: '图片 B', kind: 'image', accessible: true },
    { id: 'image-a', displayName: '图片 A', kind: 'image', accessible: true },
  ] }
  const writes = await setup(page, original)
  await page.setViewportSize({ width: 390, height: 844 })
  const refresh = page.getByRole('button', { name: '刷新可用模型', exact: true })
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await expect(page.getByRole('combobox', { name: '聊天模型' })).toHaveValue('chat-b')
  await expect(page.getByRole('combobox', { name: '图片模型' })).toHaveValue('image-b')
  await page.getByLabel('消息', { exact: true }).fill('原模型恢复仍未发送')
  await page.getByLabel('本次允许使用本人 New API 余额', { exact: true }).check()
  let denied = true
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { ...original, models: [...original.models].reverse().map(model => ({ ...model, accessible: !denied || !model.id.endsWith('-b') })) } } }))
  await refresh.click()
  await expect(page.getByRole('combobox', { name: '聊天模型' })).toHaveValue('')
  await expect(page.getByRole('combobox', { name: '图片模型' })).toHaveValue('')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  denied = false
  await refresh.click()
  await expect(page.getByRole('combobox', { name: '聊天模型' })).toHaveValue('chat-b')
  await expect(page.getByRole('combobox', { name: '图片模型' })).toHaveValue('image-b')
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('原模型恢复仍未发送')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).not.toBeChecked()
  const bounds = await refresh.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(writes()).toBe(0)
})
