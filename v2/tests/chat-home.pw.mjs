// Explicit browser contract fixtures: no real provider, funds or account writes.
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='
const models = [{ id: 'chat-a', displayName: '聊天 A', kind: 'chat', accessible: true }, { id: 'image-a', displayName: '图片 A', kind: 'image', accessible: true }]
const envelope = data => ({ success: true, data })
const history = status => ({ id: threadId, title: '本人历史会话', updatedAt: '', runs: [{ runId: 'saved-run', prompt: '本人已发送的商品图需求', status, events: [
  { type: 'message.delta', delta: '本人已收到的部分回复' },
  { type: 'tool.completed', toolName: 'generate_image', toolCallId: 'saved-tool', outputSummary: '明确浏览器 fixture', artifacts: [{ type: 'image', url: image }] },
] }] })

async function fixture(page, { active = true, threads = [], generationEnabled = true } = {}) {
  const account = await mockAccount(page); account.active = active
  const state = { account, threads, models: structuredClone(models), generationEnabled, creates: 0, sends: [], listReads: 0, detailReads: 0, detailFails: false }
  await page.route('**/api/studio/**', route => route.fulfill({ status: 503, json: { success: false, message: '明确未配置的本地浏览器 fixture' } }))
  // The broad fixture is registered first; these specific handlers own all
  // paths exercised here, including billing queried in the account dialog.
  await page.route('**/api/studio/billing', route => route.fulfill({ json: envelope(account.billing) }))
  await page.route('**/api/studio/models', route => route.fulfill({ json: envelope({ generationEnabled: state.generationEnabled, models: state.models }) }))
  await page.route(/\/api\/studio\/threads(?:\?.*)?$/, route => {
    if (route.request().method() === 'POST') {
      state.creates++
      const thread = { id: crypto.randomUUID(), title: '新会话', updatedAt: '', runs: [] }; state.threads.push(thread)
      return route.fulfill({ json: envelope(thread) })
    }
    state.listReads++
    return route.fulfill({ json: envelope({ items: state.threads, nextOffset: null }) })
  })
  await page.route(/\/api\/studio\/threads\/[^/?]+(?:\?.*)?$/, route => {
    state.detailReads++
    const id = new URL(route.request().url()).pathname.split('/').at(-1)
    const thread = state.threads.find(item => item.id === id)
    if (state.detailFails || !thread) return route.fulfill({ status: thread ? 503 : 404, json: { success: false, message: thread ? '明确只读刷新失败' : '会话不存在或无权访问' } })
    return route.fulfill({ json: envelope(thread) })
  })
  await page.route('**/api/studio/runs/stream', route => {
    const payload = route.request().postDataJSON(); state.sends.push(payload)
    expect(route.request().headers()['idempotency-key']).toBe(payload.runId)
    const events = [{ type: 'message.delta', delta: '一次明确发送的回复' }, { type: 'run.completed' }]
    state.threads.find(thread => thread.id === payload.threadId)?.runs.push({ runId: payload.runId, prompt: payload.prompt, status: 'completed', events })
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify({ ...event, runId: payload.runId })}\n\n`).join('') })
  })
  return state
}

test('signed-in home and repeated New conversation only prepare a real composer without creating a thread', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('./chat')
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
  await expect(page.getByText('从商品图、海报文案或创作灵感开始。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await page.getByLabel('消息', { exact: true }).fill('尚未发送的商品图需求')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
  await page.getByRole('button', { name: '＋ 新会话', exact: true }).click()
  await page.getByRole('button', { name: '＋ 新会话', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('')
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
})

for (const gesture of ['button', 'Enter']) test(`guest ${gesture} opens login and keeps the draft without submitting a thread or run`, async ({ page }) => {
  const state = await fixture(page, { active: false })
  await page.goto('./')
  await page.getByLabel('消息', { exact: true }).fill('访客先整理创作需求')
  if (gesture === 'button') await page.getByRole('button', { name: '发送', exact: true }).click()
  else await page.getByLabel('消息', { exact: true }).press('Enter')
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).toBeVisible()
  await closeAccount(page)
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('访客先整理创作需求')
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
})

for (const enabled of [false, true]) test(`home with generationEnabled=${enabled} and no accessible chat explains refusal before any write`, async ({ page }) => {
  const state = await fixture(page, { generationEnabled: enabled }); state.models = []
  await page.goto('./chat')
  await expect(page.getByLabel('消息', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await expect(page.getByText(enabled ? '当前暂无已配置并验证的可用聊天模型，请联系管理员核对。' : '生成服务尚未开放，请联系管理员；当前不能发送模型请求。', { exact: true })).toBeVisible()
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
})

test('first explicit send creates one thread and one run despite repeated Enter while creation is delayed', async ({ page }) => {
  const state = await fixture(page)
  let release
  await page.route(/\/api\/studio\/threads$/, async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.creates++
    await new Promise(resolve => { release = resolve })
    const thread = { id: threadId, title: '新会话', updatedAt: '', runs: [] }; state.threads.push(thread)
    await route.fulfill({ json: envelope(thread) })
  })
  await page.goto('./chat')
  const input = page.getByLabel('消息', { exact: true })
  await input.fill('为这件商品准备主图')
  await page.getByLabel('本次允许使用本人 New API 余额', { exact: true }).check()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.creates).toBe(1)
  await input.press('Enter'); await input.press('Enter')
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
  release()
  await expect(page).toHaveURL(new RegExp(`chat\\?thread=${threadId}$`))
  await expect(page.getByText('一次明确发送的回复', { exact: true })).toBeVisible()
  await expect(input).toBeEnabled()
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(1)
  expect(state.sends[0]).toMatchObject({ threadId, sessionId: threadId, conversationId: threadId, model: 'chat-a', prompt: '为这件商品准备主图', payWithBalance: true })
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).not.toBeChecked()
  await input.fill('再整理一句卖点'); await input.press('Enter')
  await expect.poll(() => state.sends.length).toBe(2)
  expect(state.creates).toBe(1)
  expect(state.sends[1]).not.toHaveProperty('payWithBalance')
  expect(new Set(state.sends.map(payload => payload.runId)).size).toBe(2)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '聊天', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await expect(page.getByRole('heading', { name: '今天有什么可以帮你？', exact: true })).toBeVisible()
  await expect(input).toHaveValue('')
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(2)
})

test('a lost creation response preserves the draft and locks repeated creation; list refresh is read-only', async ({ page }) => {
  const state = await fixture(page)
  await page.route(/\/api\/studio\/threads$/, route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.creates++
    state.threads.push({ id: threadId, title: '已创建但响应丢失的会话', updatedAt: '', runs: [] })
    return route.abort('connectionfailed')
  })
  await page.goto('./chat')
  const input = page.getByLabel('消息', { exact: true })
  await input.fill('失败后保留的海报需求'); await input.press('Enter')
  await expect(page.getByText('会话创建未确认，已保留输入。请刷新会话列表核对；不会自动创建或发送。', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('失败后保留的海报需求')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '刷新会话列表', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '会话列表' }).getByRole('button', { name: '已创建但响应丢失的会话', exact: true })).toBeVisible()
  await expect(input).toHaveValue('失败后保留的海报需求')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
  await page.getByRole('button', { name: '已创建但响应丢失的会话', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`thread=${threadId}`))
  await expect(input).toBeEnabled()
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
})

for (const kind of ['chat', 'image']) test(`fresh first-send ${kind} permission loss preserves B intent and draft without sending A or consuming balance`, async ({ page }) => {
  const state = await fixture(page)
  state.models.push({ id: `${kind}-b`, displayName: kind === 'chat' ? '聊天 B' : '图片 B', kind, accessible: true })
  let release
  await page.route(/\/api\/studio\/threads$/, async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.creates++
    await new Promise(resolve => { release = resolve })
    state.models.find(item => item.id === `${kind}-b`).accessible = false
    const thread = { id: threadId, title: '新会话', updatedAt: '', runs: [] }; state.threads.push(thread)
    await route.fulfill({ json: envelope(thread) })
  })
  await page.goto('./chat')
  const selector = page.getByRole('combobox', { name: kind === 'chat' ? '聊天模型' : '图片模型', exact: true })
  await selector.selectOption(`${kind}-b`)
  await page.getByLabel('消息', { exact: true }).fill('权限丢失后保留的首次需求')
  await page.getByLabel('本次允许使用本人 New API 余额', { exact: true }).check()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.creates).toBe(1); release()
  await expect(page.getByText(kind === 'chat' ? '此前选择的聊天模型当前不可用，请重新选择聊天模型；不会自动切换或发送。' : '此前选择的图片模型当前不可用，请重新选择图片模型后发送；不会自动切换或发送。', { exact: true })).toBeVisible()
  await expect(selector).toHaveValue('')
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('权限丢失后保留的首次需求')
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).not.toBeChecked()
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
  await selector.selectOption(`${kind}-a`)
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.sends.length).toBe(1)
  expect(state.sends[0].model).toBe('chat-a'); expect(state.sends[0]).not.toHaveProperty('payWithBalance')
  expect(state.sends[0].imageGenerationPreference.models).toEqual(['image-a'])
  expect(state.creates).toBe(1)
})

test('failed same-thread refresh retains history and original bytes; only a successful completed snapshot releases the barrier', async ({ page }) => {
  const saved = history('unknown')
  const state = await fixture(page, { threads: [saved] })
  await page.goto(`./chat?thread=${threadId}`)
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toBeVisible()
  const input = page.getByLabel('消息', { exact: true })
  // A read-only unresolved history must remain blocked before and after a read.
  await expect(input).toBeDisabled()
  await input.evaluate(element => { element.dataset.runtimeEvidence = 'same-thread-runtime' })
  state.detailFails = true
  await page.getByRole('button', { name: '刷新任务记录', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '明确只读刷新失败' })).toBeVisible()
  await expect(input).toHaveAttribute('data-runtime-evidence', 'same-thread-runtime')
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toBeVisible()
  const link = page.getByRole('link', { name: '下载原图', exact: true })
  await expect(link).toHaveAttribute('href', image)
  const downloading = page.waitForEvent('download'); await link.click()
  const download = await downloading
  expect(await readFile(await download.path())).toEqual(Buffer.from(image.split(',')[1], 'base64'))
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  state.detailFails = false; saved.runs[0].status = 'completed'
  await page.getByRole('button', { name: '刷新任务记录', exact: true }).click()
  await expect(input).toBeEnabled()
  await expect(input).toHaveAttribute('data-runtime-evidence', 'same-thread-runtime')
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toBeVisible()
  await expect(link).toHaveAttribute('href', image)
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
})

test('a partial first stream keeps text, image and original draft through a failed refresh without another run', async ({ page }) => {
  const state = await fixture(page)
  await page.route('**/api/studio/runs/stream', route => {
    const payload = route.request().postDataJSON(); state.sends.push(payload)
    const events = [{ type: 'message.delta', delta: '已接收但连接中断的回复' }, { type: 'tool.completed', toolCallId: 'partial-tool', toolName: 'generate_image', outputSummary: 'fixture 原图', artifacts: [{ type: 'image', url: image }] }]
    state.threads.find(thread => thread.id === payload.threadId).runs.push({ runId: payload.runId, prompt: payload.prompt, status: 'unknown', events })
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify({ ...event, runId: payload.runId })}\n\n`).join('') })
  })
  await page.goto('./chat')
  const input = page.getByLabel('消息', { exact: true })
  await input.fill('请保留商品图和创作需求'); await input.press('Enter')
  await expect(page.getByText('已接收但连接中断的回复', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveAttribute('href', image)
  await expect(input).toHaveValue('请保留商品图和创作需求')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  state.detailFails = true
  await page.getByRole('button', { name: '刷新任务记录', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '明确只读刷新失败' })).toBeVisible()
  await expect(page.getByText('已接收但连接中断的回复', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片')).toHaveAttribute('src', image)
  await expect(input).toHaveValue('请保留商品图和创作需求')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  state.detailFails = false
  await page.getByRole('button', { name: '刷新任务记录', exact: true }).click()
  await expect(page.getByText('服务中断后任务结果未知，无法自动恢复。可新建会话继续；原任务费用仍需核对，刷新仅查询。', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('请保留商品图和创作需求')
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveAttribute('href', image)
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(1)
})

test('unknown old run blocks only its thread; new conversation sends once after a new explicit user gesture', async ({ page }) => {
  const state = await fixture(page, { threads: [history('unknown')] })
  await page.goto(`./chat?thread=${threadId}`)
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '＋ 新会话', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('消息', { exact: true })).toBeEnabled()
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
  await page.getByLabel('消息', { exact: true }).fill('在新会话明确继续'); await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => state.sends.length).toBe(1)
  expect(state.sends[0].threadId).not.toBe(threadId)
  expect(state.threads[0].runs[0].status).toBe('unknown')
  expect(state.creates).toBe(1)
})

test('switching away from failed refresh hides the old content even when the next thread is unauthorized', async ({ page }) => {
  const state = await fixture(page, { threads: [history('unknown'), { id: otherId, title: '无权访问的地址', updatedAt: '', runs: [] }] })
  await page.goto(`./chat?thread=${threadId}`)
  await expect(page.getByAltText('生成图片')).toBeVisible()
  state.detailFails = true
  await page.getByRole('button', { name: '刷新任务记录', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '明确只读刷新失败' })).toBeVisible()
  state.threads = state.threads.filter(item => item.id !== otherId)
  await page.getByRole('button', { name: '无权访问的地址', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '会话不存在或无权访问' })).toBeVisible()
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('消息', { exact: true })).toHaveCount(0)
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
})

test('logout during a held read and a new owner login cannot restore the previous owner text or image', async ({ page }) => {
  const state = await fixture(page, { threads: [history('unknown')] })
  await page.goto(`./chat?thread=${threadId}`)
  await expect(page.getByAltText('生成图片')).toBeVisible()
  let held = false, release
  await page.route(/\/api\/studio\/threads\/[^/?]+(?:\?.*)?$/, async route => {
    held = true
    await new Promise(resolve => { release = resolve })
    await route.fulfill({ json: envelope(history('unknown')) }).catch(() => {})
  })
  await page.getByRole('button', { name: '刷新任务记录', exact: true }).click()
  await expect.poll(() => held).toBe(true)
  await openAccountSection(page)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveCount(0)
  state.threads = []
  const otherUser = { id: 8, username: 'owner-b', display_name: '另一位 fixture 用户' }
  await page.route('**/api/user/login', route => {
    state.account.active = true; state.account.token = 'fixture-owner-b-token'
    return route.fulfill({ json: envelope({ access_token: state.account.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'test-session' }, user: otherUser }) })
  })
  await page.route('**/api/user/self', route => route.fulfill({ json: envelope(otherUser) }))
  // B owns no matching thread. A's delayed read still returns its old snapshot,
  // but cancellation/identity epoch must fence it from the newly mounted view.
  await page.route(/\/api\/studio\/threads\/[^/?]+(?:\?.*)?$/, route => route.fulfill({ status: 404, json: { success: false, message: '会话不存在或无权访问' } }))
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('owner-b'); await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await closeAccount(page)
  release()
  await expect(page.getByRole('alert').filter({ hasText: '会话不存在或无权访问' })).toBeVisible()
  await expect(page.getByText('本人已收到的部分回复', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '会话列表' }).getByRole('button', { name: '本人历史会话', exact: true })).toHaveCount(0)
  expect(state.creates).toBe(0); expect(state.sends).toHaveLength(0)
})

test('leaving a held first-create for another thread fences the late creation without sending or restoring its draft', async ({ page }) => {
  const target = { id: otherId, title: '明确切换到的目标会话', updatedAt: '', runs: [] }
  const state = await fixture(page, { threads: [target] })
  let release, finishResponse
  const responseFinished = new Promise(resolve => { finishResponse = resolve })
  await page.route(/\/api\/studio\/threads$/, async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    state.creates++
    const created = { id: threadId, title: '已接收的旧创建请求', updatedAt: '', runs: [] }
    state.threads.push(created)
    await new Promise(resolve => { release = resolve })
    await route.fulfill({ json: envelope(created) }).catch(() => {})
    finishResponse()
  })
  await page.goto('./chat')
  const input = page.getByLabel('消息', { exact: true })
  await input.fill('旧会话尚未完成创建的需求'); await input.press('Enter')
  await expect.poll(() => state.creates).toBe(1)
  const targetButton = page.getByRole('navigation', { name: '会话列表' }).getByRole('button', { name: target.title, exact: true })
  await targetButton.click()
  await expect(page).toHaveURL(new RegExp(`thread=${otherId}$`))
  // history commits before React's destination render. aria-current proves
  // that render hid the old runtime before we resolve the target composer.
  await expect(targetButton).toHaveAttribute('aria-current', 'page')
  await expect(input).toBeEnabled()
  await input.evaluate(element => { element.dataset.runtimeEvidence = 'held-create-target-runtime' })
  await input.fill('新目标会话自己的未发送输入')
  await expect(input).toHaveValue('新目标会话自己的未发送输入')
  release(); await responseFinished
  await expect(page).toHaveURL(new RegExp(`thread=${otherId}$`))
  await expect(input).toHaveAttribute('data-runtime-evidence', 'held-create-target-runtime')
  await expect(input).toHaveValue('新目标会话自己的未发送输入')
  await expect(page.getByText('旧会话尚未完成创建的需求', { exact: true })).toHaveCount(0)
  await expect(page.getByText('会话创建未确认，已保留输入。请刷新会话列表核对；不会自动创建或发送。', { exact: true })).toHaveCount(0)
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
})

test('logout and another owner during held first-send catalog verification fence the late model response and old draft', async ({ page }) => {
  const state = await fixture(page)
  let catalogReads = 0, held = false, release, finishResponse
  const responseFinished = new Promise(resolve => { finishResponse = resolve })
  await page.route('**/api/studio/models', async route => {
    catalogReads++
    const catalog = { generationEnabled: state.generationEnabled, models: structuredClone(state.models) }
    if (catalogReads !== 2) return route.fulfill({ json: envelope(catalog) })
    held = true
    await new Promise(resolve => { release = resolve })
    await route.fulfill({ json: envelope(catalog) }).catch(() => {})
    finishResponse()
  })
  await page.goto('./chat')
  await page.getByLabel('消息', { exact: true }).fill('旧账号首次发送的商品图需求')
  await page.getByLabel('本次允许使用本人 New API 余额', { exact: true }).check()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => held).toBe(true)
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
  await expect(page).toHaveURL(/thread=/)
  await openAccountSection(page)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('')
  await expect(page.getByText('旧账号首次发送的商品图需求', { exact: true })).toHaveCount(0)

  state.threads = []
  state.models = [{ id: 'other-owner-chat', displayName: '新账号本人模型', kind: 'chat', accessible: true }]
  const otherUser = { id: 8, username: 'owner-b', display_name: '新账号目录验证用户' }
  await page.route('**/api/user/login', route => {
    state.account.active = true; state.account.token = 'fixture-owner-b-token'
    return route.fulfill({ json: envelope({ access_token: state.account.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'test-session' }, user: otherUser }) })
  })
  await page.route('**/api/user/self', route => route.fulfill({ json: envelope(otherUser) }))
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('owner-b'); await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await closeAccount(page)
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '聊天', exact: true }).click()
  const input = page.getByLabel('消息', { exact: true })
  await expect(input).toBeEnabled()
  await expect(page.getByRole('combobox', { name: '聊天模型', exact: true })).toHaveValue('other-owner-chat')
  await input.fill('新账号自己的未发送需求')
  release(); await responseFinished
  await expect(page).toHaveURL(/\/studio\/chat$/)
  await expect(input).toHaveValue('新账号自己的未发送需求')
  await expect(page.getByRole('combobox', { name: '聊天模型', exact: true })).toHaveValue('other-owner-chat')
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText(otherUser.display_name)
  await expect(page.getByLabel('本次允许使用本人 New API 余额', { exact: true })).not.toBeChecked()
  await expect(page.getByText('旧账号首次发送的商品图需求', { exact: true })).toHaveCount(0)
  expect(state.creates).toBe(1); expect(state.sends).toHaveLength(0)
})
