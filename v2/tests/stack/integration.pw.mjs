import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// 此套件不拦截浏览器网络；所有请求经过 edge → Studio API → 内存契约替身。
// 不证明真实 New API 初始化、供应商兼容或真实结算。
test('same-origin stack authenticates, streams image tools, attributes usage and rejects cross-account replay', async ({ page, request }) => {
  const root = new URL(process.env.GOUO_STACK_URL).origin
  await page.goto('/studio/')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('协议测试用户')
  const cookies = await page.context().cookies()
  expect(cookies.find(cookie => cookie.name === 'fixture_refresh')).toMatchObject({ httpOnly: true, sameSite: 'Lax' })
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/user/auth/refresh') && response.status() === 200)
  await page.reload()
  await refreshed
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('协议测试用户')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  const sent = page.waitForRequest(req => req.url().endsWith('/api/studio/runs/stream') && req.method() === 'POST')
  await page.getByLabel('输入消息', { exact: true }).fill('生成图片，仅进行隔离协议测试')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const run = await sent
  await expect(page.getByText('协议替身已完成图片，未调用真实供应商。', { exact: true })).toBeVisible()
  const headers = { authorization: run.headers().authorization, 'idempotency-key': run.headers()['idempotency-key'], origin: root }
  expect(headers.authorization).not.toContain('fixture-relay')
  const before = (await (await request.get('/api/studio/billing', { headers })).json()).data
  expect(before.requestCount).toBe(3)
  expect(before.spent).toBeCloseTo(0.3)
  expect(before.recentCalls.map(row => row.model).sort()).toEqual(['fixture-chat', 'fixture-chat', 'fixture-image'])
  const replay = await request.post('/api/studio/runs', { headers, data: run.postDataJSON() })
  expect(replay.status()).toBe(200)
  const replayBody = await replay.json()
  expect(replayBody.data.usage).toMatchObject({ state: 'settled', requestCount: 3, cost: 0.3 })
  const after = (await (await request.get('/api/studio/billing', { headers })).json()).data
  expect(after.requestCount).toBe(3)
  expect(after.spent).toBe(before.spent)

  await page.getByRole('button', { name: '本地保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByText('协议替身已完成图片，未调用真实供应商。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出画布文件', exact: true }).click()
  const scene = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  expect(scene.elements.filter(e => !e.isDeleted && e.type === 'image')).toHaveLength(1)

  const otherLogin = await request.post('/api/user/login', { headers: { origin: root }, data: { username: 'other-user', password: 'test-password' } })
  expect(otherLogin.ok()).toBe(true)
  const other = (await otherLogin.json()).data
  const otherHeaders = { authorization: `Bearer ${other.access_token}`, origin: root, 'idempotency-key': headers['idempotency-key'] }
  const otherBilling = (await (await request.get('/api/studio/billing', { headers: otherHeaders })).json()).data
  expect(otherBilling).toMatchObject({ spent: 0, requestCount: 0, recentCalls: [] })
  expect((await request.post('/api/studio/runs', { headers: otherHeaders, data: run.postDataJSON() })).status()).toBe(403)
  expect((await request.post('/api/studio/runs/stream', { headers: otherHeaders, data: run.postDataJSON() })).status()).toBe(403)
  expect((await request.post('/api/user/auth/logout', { headers: { ...otherHeaders, 'x-auth-session': other.session.sid } })).ok()).toBe(true)
  expect((await request.get('/api/user/self', { headers: otherHeaders })).status()).toBe(401)
  expect((await request.post('/api/user/auth/refresh', { headers: { origin: root } })).status()).toBe(401)
  expect((await request.post('/api/user/login', { headers: { origin: 'https://untrusted.invalid' }, data: { username: 'studio-user', password: 'test-password' } })).status()).toBe(403)
  expect((await request.post('/api/studio/runs/stream', { headers: { ...headers, origin: 'https://untrusted.invalid' }, data: run.postDataJSON() })).status()).toBe(403)
  expect((await request.post('/v1/chat/completions', { headers: { origin: root }, data: {} })).status()).toBe(404)
  expect((await request.post('/v1beta/models/fixture:generateContent', { headers: { origin: root }, data: {} })).status()).toBe(403)
  expect((await request.post('/pg/chat/completions', { headers: { origin: root }, data: {} })).status()).toBe(403)
  expect((await request.get('/setup')).status()).toBe(200)
  expect((await request.get('/console')).status()).toBe(200)
})

test('server-owned assistant threads recover a disconnected stream and survive refresh, account switches and relogin', async ({ page, request }) => {
  const origin = new URL(process.env.GOUO_STACK_URL).origin
  const login = await request.post('/api/user/login', { headers: { origin }, data: { username: 'studio-user', password: 'test-password' } })
  const owner = (await login.json()).data
  const headers = { authorization: `Bearer ${owner.access_token}`, origin }
  const first = (await (await request.post('/api/studio/threads', { headers, data: { title: '断线恢复测试' } })).json()).data
  const second = (await (await request.post('/api/studio/threads', { headers, data: { title: '图片会话测试' } })).json()).data
  // Playwright 的 request fixture 与 page 浏览器会话独立，保留单独的账号观察会话。
  const billing = async () => {
    const response = await request.get('/api/studio/billing', { headers })
    expect(response.status()).toBe(200)
    return (await response.json()).data
  }
  const before = await billing()
  const runId = crypto.randomUUID()
  const payload = { threadId: first.id, runId, prompt: '只回复文字，用于断线恢复测试', model: 'fixture-chat', sessionId: first.id, conversationId: first.id }
  await page.goto('/studio/')
  // 不拦截网络：浏览器收到真实增量后断开接收，服务端继续执行并持久化。
  const partial = await page.evaluate(async ({ headers, payload }) => {
    const controller = new AbortController()
    const response = await fetch('/api/studio/runs/stream', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': payload.runId }, body: JSON.stringify(payload), signal: controller.signal })
    if (!response.ok) throw new Error(`Stream HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (true) {
      const part = await reader.read()
      if (part.done) throw new Error('Stream finished before a delta was received')
      text += decoder.decode(part.value, { stream: true })
      if (text.includes('message.delta')) { controller.abort(); return text }
    }
  }, { headers, payload })
  expect(partial).toContain('message.delta')
  expect(partial).not.toContain('run.completed')
  await expect.poll(async () => (await (await request.get(`/api/studio/runs/${runId}`, { headers })).json()).data.status).toBe('completed')
  const recovered = (await (await request.get(`/api/studio/runs/${runId}`, { headers })).json()).data
  expect(recovered.threadId).toBe(first.id)
  expect(recovered.events.filter(event => event.type === 'message.delta').map(event => event.delta).join('')).toBe('协议替身纯文本回复。')
  expect(recovered.usage).toMatchObject({ state: 'settled', requestCount: 1, cost: 0.1 })
  expect((await billing()).requestCount).toBe(before.requestCount + 1)
  expect((await request.post('/api/studio/runs', { headers: { ...headers, 'idempotency-key': runId }, data: payload })).status()).toBe(200)
  expect((await billing()).requestCount).toBe(before.requestCount + 1)

  const otherLogin = await request.post('/api/user/login', { headers: { origin }, data: { username: 'other-user', password: 'test-password' } })
  const otherHeaders = { authorization: `Bearer ${(await otherLogin.json()).data.access_token}`, origin }
  expect((await (await request.get('/api/studio/threads', { headers: otherHeaders })).json()).data).toEqual({ items: [], nextOffset: null })
  for (const path of [`/api/studio/threads/${first.id}`, `/api/studio/runs/${runId}`]) expect((await request.get(path, { headers: otherHeaders })).status()).toBe(404)

  async function signIn(username) {
    await page.goto('/studio/')
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill('test-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'New API 账号', exact: true })).toHaveCount(0)
  }
  async function signOut() {
    await page.goto('/studio/')
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: '退出登录', exact: true }).click()])
    await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).not.toContainText('协议测试用户')
  }
  await signIn('studio-user')
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '聊天与会话历史', exact: true }).click()
  await expect(page).toHaveURL(/\/studio\/chat(?:\?|$)/)
  await page.getByRole('button', { name: '断线恢复测试', exact: true }).click()
  await expect(page.getByText('协议替身纯文本回复。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '图片会话测试', exact: true }).click()
  await expect(page.getByText('协议替身纯文本回复。', { exact: true })).toHaveCount(0)
  const imageSent = page.waitForRequest(req => req.url().endsWith('/api/studio/runs/stream') && req.method() === 'POST')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('生成图片，验证持久化会话')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const imageRequest = await imageSent
  expect(imageRequest.postDataJSON().threadId).toBe(second.id)
  await expect(page.getByText('协议替身已完成图片，未调用真实供应商。', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '图片会话测试', exact: true }).click()
  await expect(page.getByText('协议替身已完成图片，未调用真实供应商。', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '断线恢复测试', exact: true }).click()
  await expect(page.getByText('协议替身纯文本回复。', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片', { exact: true })).toHaveCount(0)
  await signOut()
  await signIn('other-user')
  await page.goto('/studio/chat')
  await expect(page.getByRole('button', { name: '断线恢复测试', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '图片会话测试', exact: true })).toHaveCount(0)
  await expect(page.getByText('协议替身纯文本回复。', { exact: true })).toHaveCount(0)
  await signOut()
  await signIn('studio-user')
  await page.goto('/studio/chat')
  await page.getByRole('button', { name: '图片会话测试', exact: true }).click()
  await expect(page.getByAltText('生成图片', { exact: true })).toBeVisible()
  expect((await billing()).requestCount).toBe(before.requestCount + 4)
})
