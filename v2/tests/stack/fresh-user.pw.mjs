import { test, expect } from '@playwright/test'

// No browser interception. Real edge/Studio/SQLite/SDK, explicitly fake New API.
// Registration policy, email, prices and payments are NOT live verified here.
test('fresh ordinary accounts with zero quota, own model/token/charges and canvas recovery stay isolated', async ({ page, request }) => {
  const origin = new URL(process.env.GOUO_STACK_URL).origin
  const native = { origin }
  const register = async username => {
    const response = await request.post('/api/user/register', { headers: native, data: { username, password: 'test-password' } })
    expect(response.status()).toBe(200)
  }
  await register('fresh-user')
  expect((await request.get('/api/user/self')).status()).toBe(401)
  expect((await request.get('/api/studio/models')).status()).toBe(401)
  const login = await request.post('/api/user/login', { headers: native, data: { username: 'fresh-user', password: 'test-password' } })
  const first = (await login.json()).data
  expect(first.user).toMatchObject({ role: 1, group: 'default', quota: 0 })
  const headers = { origin, authorization: `Bearer ${first.access_token}` }
  const zero = await request.post('/api/studio/images', { headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, data: { prompt: 'zero quota test', model: 'fixture-image' } })
  expect(zero.status()).toBe(402)
  expect((await (await request.get('/api/studio/billing', { headers })).json()).data).toMatchObject({ balance: 0, spent: 0, requestCount: 0 })
  // This endpoint only exists in the fixture build, not in New API or Studio.
  await request.post('/api/fixture/account', { headers: native, data: { id: first.user.id, quota: 1000 } })
  await page.goto('/studio/chat')
  await page.getByRole('button', { name: '登录账号', exact: true }).first().click()
  await page.getByLabel('用户名', { exact: true }).fill('fresh-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：新普通测试用户', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭账号窗口', exact: true }).click()
  await page.getByRole('button', { name: '新会话', exact: true }).click()
  await expect(page).toHaveURL(/thread=/)
  const sent = page.waitForRequest(r => r.url().endsWith('/api/studio/runs/stream') && r.method() === 'POST')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('生成图片，测试新用户自己的账单')
  await page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额', exact: true }).check()
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const run = await sent
  await expect(page.getByText('协议替身已完成图片，未调用真实供应商。', { exact: true })).toBeVisible()
  const billing = (await (await request.get('/api/studio/billing', { headers })).json()).data
  expect(billing).toMatchObject({ balance: 0.7, spent: 0.3, requestCount: 3 })
  const replayHeaders = { ...headers, 'idempotency-key': run.headers()['idempotency-key'] }
  const replay = await request.post('/api/studio/runs', { headers: replayHeaders, data: run.postDataJSON() })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).data.usage).toMatchObject({ state: 'recorded', settlementState: 'unconfirmed', requestCount: 3, cost: 0.3 })
  expect((await (await request.get('/api/studio/requests/agent/' + run.headers()['idempotency-key'], { headers })).json()).data.attempts).toHaveLength(3)
  await page.getByRole('button', { name: '打开画布', exact: true }).click()
  await expect(page).toHaveURL(/canvas-lab/)
  await expect(page.getByText('已保存到 Studio 项目', { exact: true })).toBeVisible()
  const canvasURL = page.url()
  const projectId = new URL(canvasURL).searchParams.get('project')
  expect(projectId).toBeTruthy()
  const saved = (await (await request.get('/api/studio/projects/' + projectId, { headers })).json()).data
  await page.reload()
  await expect(page.getByRole('status')).toContainText('Studio 项目已打开')
  await page.waitForTimeout(1200)
  const project = (await (await request.get('/api/studio/projects/' + projectId, { headers })).json()).data
  expect(project).toEqual(saved)
  expect(project.document.elements.filter(e => e.type === 'image' && !e.isDeleted)).toHaveLength(1)
  await register('fresh-other')
  const other = (await (await request.post('/api/user/login', { headers: native, data: { username: 'fresh-other', password: 'test-password' } })).json()).data
  const otherHeaders = { origin, authorization: `Bearer ${other.access_token}` }
  await request.post('/api/fixture/account', { headers: native, data: { id: other.user.id, quota: 1000 } })
  expect((await request.get('/api/studio/projects/' + projectId, { headers: otherHeaders })).status()).toBe(404)
  expect((await request.get('/api/studio/threads/' + run.postDataJSON().threadId, { headers: otherHeaders })).status()).toBe(404)
  expect((await request.get('/api/studio/requests/agent/' + run.headers()['idempotency-key'], { headers: otherHeaders })).status()).toBe(404)
  const otherImage = await request.post('/api/studio/images', { headers: { ...otherHeaders, 'idempotency-key': crypto.randomUUID(), 'new-api-user': String(first.user.id) }, data: { prompt: 'other owner', model: 'fixture-image', payWithBalance: true } })
  expect(otherImage.status()).toBe(200)
  expect((await (await request.get('/api/studio/billing', { headers: otherHeaders })).json()).data).toMatchObject({ spent: 0.1, requestCount: 1 })
  expect((await (await request.get('/api/studio/billing', { headers })).json()).data).toMatchObject({ spent: 0.3, requestCount: 3 })
  await request.post('/api/fixture/account', { headers: native, data: { id: other.user.id, group: 'blocked' } })
  expect((await (await request.get('/api/studio/models', { headers: otherHeaders })).json()).data.models.every(m => !m.accessible)).toBe(true)
  expect((await request.post('/api/studio/images', { headers: { ...otherHeaders, 'idempotency-key': crypto.randomUUID() }, data: { prompt: 'blocked', model: 'fixture-image', payWithBalance: true } })).status()).toBe(403)
  await request.post('/api/fixture/account', { headers: native, data: { id: other.user.id, status: 2 } })
  expect((await request.get('/api/studio/projects', { headers: otherHeaders })).status()).toBe(403)
  await request.post('/api/fixture/account', { headers: native, data: { id: other.user.id, status: 1, group: 'default' } })
  expect((await request.post('/api/user/auth/logout', { headers: { ...otherHeaders, 'x-auth-session': other.session.sid } })).status()).toBe(200)
  expect((await request.get('/api/user/self', { headers: otherHeaders })).status()).toBe(401)
})
