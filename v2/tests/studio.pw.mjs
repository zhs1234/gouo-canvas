import { test, expect } from '@playwright/test'

import { mockAccount } from './account-fixture.mjs'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

test('confirmed logout gates another tab without refresh or writes until explicit identity recovery', async ({ page, context }) => {
  const first = await mockAccount(page); first.active = true
  const other = await context.newPage(); const second = await mockAccount(other); second.active = true
  await other.route('**/api/studio/models', route => route.fulfill({json:{success:true,data:{models:[],generationEnabled:false,conversationMode:'unavailable'}}}))
  await other.route('**/api/studio/trial', route => route.fulfill({json:{success:true,data:{state:'disabled',message:'协议测试试用关闭',chat:{limit:4,remaining:0,used:0,held:0},image:{limit:1,remaining:0,used:0,held:0},pendingReconciliation:false}}}))
  await page.goto('./'); await other.goto('./')
  await expect(other.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await other.evaluate(() => { window.authDraftEditor = document.querySelector('.excalidraw'); const marker = document.createElement('span'); marker.id = 'old-private-tab'; marker.textContent = 'OLD_PRIVATE_TAB'; window.authDraftEditor.append(marker) })
  const initialRefreshes = second.refreshes; let writes = 0
  other.on('request', request => { if (['POST','PUT','DELETE'].includes(request.method()) && !request.url().endsWith('/api/user/auth/refresh')) writes++ })
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(other.getByRole('heading', { name: '会话暂时无法恢复' })).toBeVisible()
  await expect(other.getByText('OLD_PRIVATE_TAB', { exact: true })).toBeHidden()
  expect(await other.evaluate(() => document.querySelector('.excalidraw') === window.authDraftEditor)).toBe(true)
  const blocked = await other.evaluate(async () => { const loaded = performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname.endsWith('/src/api.ts')); const api = await import(loaded.name); try { await api.request('/api/studio/jobs',{method:'POST',body:'{}'}); return false } catch { return true } })
  expect(blocked).toBe(true); expect(writes).toBe(0); expect(second.refreshes).toBe(initialRefreshes)
  let manualRefreshes = 0
  await other.route('**/api/user/auth/refresh', route => {
    manualRefreshes++
    expect(route.request().headers()['x-auth-session']).toBe(manualRefreshes===1?undefined:'owner8-fixture')
    return route.fulfill({ json: { success: true, data: { access_token: 'owner8-fixture-token', token_type: 'Bearer', access_expires_at: Math.floor(Date.now()/1000)+600, session:{sid:'owner8-fixture'}, user:{id:8,username:'owner8'} } } })
  })
  await other.route('**/api/user/self', route => route.fulfill({ json:{success:true,data:{id:8,username:'owner8',display_name:'另一标签页的新账号'}} }))
  await other.getByRole('button', { name: '重新恢复会话' }).click()
  await expect(other.getByRole('button', { name: 'New API 账号', exact:true })).toContainText('另一标签页的新账号')
  await expect(other.getByText('OLD_PRIVATE_TAB', { exact:true })).toHaveCount(0)
  expect(writes).toBe(0)
  expect(manualRefreshes).toBe(1)
})

test('failed logout does not invalidate another tab', async ({ page, context }) => {
  const first = await mockAccount(page); first.active = true; first.failLogout = true
  const other = await context.newPage(); const second = await mockAccount(other); second.active = true
  await page.goto('./'); await other.goto('./')
  await expect(other.getByRole('button', { name:'本地保存', exact:true })).toBeEnabled()
  const initialRefreshes = second.refreshes
  await page.getByRole('button', { name:'New API 账号', exact:true }).click()
  await page.getByRole('button', { name:'退出登录' }).click()
  await expect(page.getByText('退出失败，请重试', {exact:true})).toBeVisible()
  await expect(other.getByRole('button', {name:'本地保存', exact:true})).toBeEnabled()
  await expect(other.getByRole('heading', {name:'会话暂时无法恢复'})).toHaveCount(0)
  expect(second.refreshes).toBe(initialRefreshes)
})

test('cross-tab logout with no replacement cookie recovers as guest with exactly one explicit refresh', async ({ page, context }) => {
  const first = await mockAccount(page); first.active = true
  const other = await context.newPage(); const second = await mockAccount(other); second.active = true
  await page.goto('./'); await other.goto('./')
  await expect(other.getByRole('button', { name:'本地保存', exact:true })).toBeEnabled()
  await page.getByRole('button', { name:'New API 账号', exact:true }).click()
  await page.getByRole('button', { name:'退出登录' }).click()
  await expect(other.getByRole('heading', { name:'会话暂时无法恢复' })).toBeVisible()
  const initialRefreshes = second.refreshes; second.active = false
  let writes = 0
  other.on('request', request => { if (['POST','PUT','DELETE'].includes(request.method()) && !request.url().endsWith('/api/user/auth/refresh')) writes++ })
  await other.getByRole('button', {name:'重新恢复会话'}).click()
  await expect(other.getByRole('heading', {name:'会话暂时无法恢复'})).toHaveCount(0)
  await other.getByRole('button', {name:'New API 账号',exact:true}).click()
  await expect(other.getByRole('button', {name:'登录',exact:true})).toBeVisible()
  expect(second.refreshes).toBe(initialRefreshes+1); expect(writes).toBe(0)
})

test('a broadcast during pending refresh prevents both unsent ordinary and streaming business writes', async ({ page, context }) => {
  const first=await mockAccount(page);first.active=true
  const other=await context.newPage();const second=await mockAccount(other);second.active=true
  await page.goto('./');await other.goto('./')
  await expect(other.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()
  await other.route('**/api/studio/drop-memory',route=>route.fulfill({status:401,json:{success:false,message:'Fixture expired access'}}))
  await other.evaluate(async()=>{const loaded=performance.getEntriesByType('resource').findLast(entry=>new URL(entry.name).pathname.endsWith('/src/api.ts'));window.raceApi=await import(loaded.name);await window.raceApi.request('/api/studio/drop-memory',{method:'POST',body:'{}'}).catch(()=>{})})
  let pending=false,release;const gate=new Promise(resolve=>{release=resolve});let business=0
  await other.route('**/api/user/auth/refresh',async route=>{pending=true;await gate;await route.fallback()})
  await other.route('**/api/studio/race-*',route=>{business++;return route.fulfill({json:{success:true,data:{}}})})
  await other.evaluate(()=>{window.raceResults=Promise.all([window.raceApi.request('/api/studio/race-normal',{method:'POST',body:'{}'}),window.raceApi.requestStream('/api/studio/race-stream',{method:'POST',body:'{}'})].map(promise=>promise.then(()=>false,()=>true)))})
  await expect.poll(()=>pending).toBe(true)
  await page.getByRole('button',{name:'New API 账号',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click()
  await expect(other.getByRole('heading',{name:'会话暂时无法恢复'})).toBeVisible()
  release();expect(await other.evaluate(()=>window.raceResults)).toEqual([true,true]);expect(business).toBe(0)
  await expect(other.getByRole('heading',{name:'会话暂时无法恢复'})).toBeVisible()
})

test('a second invalidation during manual identity read cannot publish its old owner or clear cookie recovery', async ({ page, context }) => {
  const first=await mockAccount(page);first.active=true
  const other=await context.newPage();const second=await mockAccount(other);second.active=true
  await page.goto('./');await other.goto('./')
  await expect(other.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'New API 账号',exact:true}).click();await page.getByRole('button',{name:'退出登录'}).click()
  await expect(other.getByRole('heading',{name:'会话暂时无法恢复'})).toBeVisible()
  let pending=false,release;const gate=new Promise(resolve=>{release=resolve});let reads=0,refreshes=0
  await other.route('**/api/user/auth/refresh',route=>{refreshes++;expect(route.request().headers()['x-auth-session']).toBeUndefined();return route.fallback()})
  await other.route('**/api/user/self',async route=>{reads++;if(reads===1){pending=true;await gate;return route.fulfill({json:{success:true,data:{id:7,username:'studio-user',display_name:'不应公开的旧身份'}}})}return route.fallback()})
  await other.getByRole('button',{name:'重新恢复会话'}).click();await expect.poll(()=>pending).toBe(true)
  await page.evaluate(async()=>{const loaded=performance.getEntriesByType('resource').findLast(entry=>new URL(entry.name).pathname.endsWith('/src/api.ts'));const api=await import(loaded.name);await api.login('studio-user','test-password');await api.logout()})
  release();await expect(other.getByRole('heading',{name:'会话暂时无法恢复'})).toBeVisible()
  await expect(other.getByText('不应公开的旧身份')).toHaveCount(0)
  await expect(other.getByRole('button',{name:'重新恢复会话'})).toBeEnabled()
  await other.getByRole('button',{name:'重新恢复会话'}).click()
  await expect(other.getByRole('button',{name:'New API 账号',exact:true})).toContainText('测试用户')
  expect(refreshes).toBe(2)
})

test('non-JSON refresh 429 stays behind an explicit recovery gate, preserves status and never auto-retries writes', async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  let refreshes = 0
  const writes = []
  page.on('request', request => { if (['POST', 'PUT', 'DELETE'].includes(request.method()) && !request.url().endsWith('/api/user/auth/refresh')) writes.push(new URL(request.url()).pathname) })
  await page.route('**/api/user/auth/refresh', route => {
    refreshes++
    return refreshes === 1 ? route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Content-Type': 'text/plain' }, body: 'Rate limit exceeded' }) : route.fallback()
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '会话暂时无法恢复' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toBeHidden()
  const error = await page.evaluate(async () => { const loaded = performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname.endsWith('/src/api.ts')); const api = await import(loaded.name); try { await api.currentUser(); return null } catch (error) { return { status: error.status, retryAfter: error.retryAfterSeconds } } })
  expect(error).toEqual({ status: 429, retryAfter: 1 })
  await expect(page.getByRole('button', { name: '重新恢复会话' })).toBeEnabled()
  expect(refreshes).toBe(1)
  expect(writes).toEqual([])
  await page.getByRole('button', { name: '重新恢复会话' }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  expect(refreshes).toBe(2)
  expect(writes).toEqual([])
})

test('transient identity failure hides the old workspace without recreating its unsaved scene', async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  await page.goto('./')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#a8cf74' } }).png().toBuffer()
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'unsaved-auth-fixture.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('输入你的想法开始创作', { exact: true })).toHaveCount(0)
  await page.evaluate(() => { window.authDraftEditor = document.querySelector('.excalidraw') })
  await page.route('**/api/user/self', route => route.fulfill({ status: 503, body: 'Temporary upstream outage', headers: { 'Content-Type': 'text/plain' } }))
  await page.evaluate(async () => { const loaded = performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname.endsWith('/src/api.ts')); const api = await import(loaded.name); await api.currentUser().catch(() => {}) })
  await expect(page.getByRole('heading', { name: '会话暂时无法恢复' })).toBeVisible()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeHidden()
  expect(await page.evaluate(() => document.querySelector('.excalidraw') === window.authDraftEditor)).toBe(true)
  await page.unroute('**/api/user/self')
  await page.getByRole('button', { name: '重新恢复会话' }).click()
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.querySelector('.excalidraw') === window.authDraftEditor)).toBe(true)
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出画布文件', exact: true }).click()
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  expect(exported.elements.filter(element => element.type === 'image' && !element.isDeleted)).toHaveLength(1)
})

test('disabled identity is a recovery error while an explicit 401 remains anonymous', async ({ page }) => {
  await mockAccount(page)
  await page.route('**/api/user/auth/refresh', route => route.fulfill({ status: 403, json: { success: false, message: '账号已停用' } }))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '会话暂时无法恢复' })).toBeVisible()
  await expect(page.getByText('账号已停用', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toBeHidden()
  await page.unroute('**/api/user/auth/refresh')
  await page.getByRole('button', { name: '重新恢复会话' }).click()
  await expect(page.getByRole('heading', { name: '会话暂时无法恢复' })).toHaveCount(0)
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
})

test('manual recovery into a different owner clears the old workspace before exposing the new identity', async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  await page.goto('./')
  await expect(page.getByRole('button', { name: '本地保存', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const marker = document.createElement('div'); marker.id = 'old-owner-private-marker'; marker.textContent = 'OWNER7_PRIVATE_CACHE_FIXTURE'; document.querySelector('.excalidraw').append(marker)
    window.oldOwnerFlashed = false
    const check = () => { if (document.querySelector('#old-owner-private-marker') && !document.querySelector('[data-auth-workspace]').hidden && document.body.textContent.includes('切换后的账号')) window.oldOwnerFlashed = true }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true })
  })
  let mode = 'unavailable'
  await page.route('**/api/user/self', route => mode === 'unavailable'
    ? route.fulfill({ status: 503, body: 'Fixture identity unavailable' })
    : route.request().headers().authorization === 'Bearer owner8-fixture-token'
      ? route.fulfill({ json: { success: true, data: { id: 8, username: 'owner8', display_name: '切换后的账号' } } })
      : route.fulfill({ status: 401, json: { success: false, message: '旧会话失效' } }))
  await page.evaluate(async () => { const loaded = performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname.endsWith('/src/api.ts')); const api = await import(loaded.name); await api.currentUser().catch(() => {}) })
  await expect(page.getByRole('heading', { name: '会话暂时无法恢复' })).toBeVisible()
  await expect(page.getByText('OWNER7_PRIVATE_CACHE_FIXTURE', { exact: true })).toBeHidden()
  mode = 'switched'
  await page.route('**/api/user/auth/refresh', route => route.fulfill({ json: { success: true, data: { access_token: 'owner8-fixture-token', token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'owner8-fixture-session' }, user: { id: 8, username: 'owner8' } } } }))
  await page.getByRole('button', { name: '重新恢复会话' }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('切换后的账号')
  await expect(page.locator('#old-owner-private-marker')).toHaveCount(0)
  expect(await page.evaluate(() => window.oldOwnerFlashed)).toBe(false)
})

test('New API login, reload restoration and logout keep access tokens out of browser storage', async ({ page }) => {
  const account = await mockAccount(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
  expect(stored).not.toContain('test-access-token')
  expect(stored).not.toContain('test-password')
  await page.reload()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  expect(account.refreshes).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect(account.active).toBe(false)
})

test('invalid credentials and failed logout are reported without pretending authentication succeeded', async ({ page }) => {
  const account = await mockAccount(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('用户名或密码错误', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  account.failLogout = true
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByText('退出失败，请重试', { exact: true })).toBeVisible()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
})

test('expired reads recover once while unauthorized writes are never automatically resubmitted', async ({ page }) => {
  const account = await mockAccount(page)
  account.rejectProfileOnce = true
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
  let submissions = 0
  await page.route('**/api/studio/jobs', (route) => {
    submissions += 1
    return route.fulfill({ status: 401, json: { success: false, message: '会话已失效' } })
  })
  const result = await page.evaluate(async () => {
    const api = await import('/studio/src/api.ts')
    try { await api.request('/api/studio/jobs', { method: 'POST', body: '{}' }); return 'unexpected success' }
    catch (error) { return error.message }
  })
  expect(result).toBe('会话已失效')
  expect(submissions).toBe(1)
})

test('a successful envelope without a valid auth session cannot log the user in', async ({ page }) => {
  await mockAccount(page)
  await page.route('**/api/user/login', (route) => route.fulfill({ json: { success: true, data: { user: { id: 7, username: 'studio-user' } } } }))
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText(/登录响应缺少有效会话/)).toBeVisible()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
})


test('account entry reuses pinned native routes on the same origin', async ({ page }) => {
  await mockAccount(page)
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  for (const [name, path] of [
    ['前往 New API 登录', '/sign-in?redirect=%2Fstudio%2F'],
    ['注册账号', '/sign-up'], ['忘记密码', '/forgot-password'],
    ['账号资料', '/profile'], ['账号安全与登录会话', '/security'],
    ['余额与充值', '/wallet'], ['用量记录', '/usage-logs'],
    ['管理后台（需要管理员权限）', '/users'],
  ]) {
    const link = page.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('href', path)
    expect(await link.evaluate(a => new URL(a.href).origin)).toBe(new URL(page.url()).origin)
  }
})

test('native login return restores the account without a Studio password submission', async ({ page }) => {
  const account = await mockAccount(page)
  account.active = true
  let logins = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/user/login') logins++ })
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  expect(logins).toBe(0)
  expect(account.refreshes).toBeGreaterThan(0)
})

test('logout cannot claim success when upstream preserves a different browser session', async ({ page }) => {
  const account = await mockAccount(page)
  account.active = true
  await page.route('**/api/user/auth/logout', route => route.fulfill({ json: {
    success: true, data: { revoked_sid: 'test-session', cookie_cleared: false },
  } }))
  await page.goto('./')
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByText('浏览器会话已切换，请刷新页面后再退出登录', { exact: true })).toBeVisible()
  await expect(page.getByText('当前账号：测试用户', { exact: true })).toBeVisible()
})

test('disabled or revoked native session restores as anonymous and cannot submit business writes', async ({ page }) => {
  const account = await mockAccount(page)
  account.active = true
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'New API 账号', exact: true })).toContainText('测试用户')
  account.active = false
  await page.reload()
  await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出登录' })).toHaveCount(0)
  let submissions = 0
  await page.route('**/api/studio/jobs', route => { submissions++; return route.fulfill({ json: { success: true } }) })
  const result = await page.evaluate(async () => {
    const api = await import('/studio/src/api.ts')
    try { await api.request('/api/studio/jobs', { method: 'POST', body: '{}' }); return 'unexpected success' }
    catch (error) { return error.message }
  })
  expect(result).toBe('请先登录 New API 账号')
  expect(submissions).toBe(0)
})
