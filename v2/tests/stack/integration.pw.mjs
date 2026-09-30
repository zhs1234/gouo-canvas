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
  expect((await request.get('/setup')).status()).toBe(200)
  expect((await request.get('/console')).status()).toBe(200)
})
