// F browser fixtures only: this does not replace real Native D1/D2 acceptance.
import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

const ids = { threadA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', lateThreadA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', threadB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', projectA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', projectB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', assetA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', lateAssetA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5' }
const imageA = 'data:image/png;base64,' + (await sharp({ create: { width: 13, height: 17, channels: 3, background: '#dd1122' } }).png().toBuffer()).toString('base64')
const timeA = 1790852400, timeB = 1790863200
const isoA = new Date(timeA * 1000).toISOString(), isoB = new Date(timeB * 1000).toISOString()
const thread = (id, who) => ({ id, title: `F-${who}-私有标题`, runs: [{ runId: `F-${who}-run`, prompt: `F-${who}-私有问题`, status: 'completed', events: [{ type: 'message.delta', delta: `F-${who}-私有回答` }, ...(who === 'A' ? [{ type: 'tool.completed', toolCallId: 'F-A-tool', artifacts: [{ type: 'image', url: imageA }] }] : [])] }] })
const project = (id, who) => ({ id, title: `F-${who}-私有项目`, revision: 1, document: { elements: [], files: {}, appState: {} } })

for (const lateKind of ['detail', 'asset']) test(`F owner switch suppresses uncancellable late A ${lateKind} and foreign addresses without writes`, async ({ page }) => {
  const account = await mockAccount(page); account.active = true
  let owner = 7, armed = false, release, arrived = false
  const writes = [], setupWrites = [], denied = [], ownReads = []
  const target = lateKind === 'detail' ? `/api/studio/threads/${ids.lateThreadA}` : `/api/studio/assets/${ids.lateAssetA}`
  // Explicit fault fixture: remove AbortSignal only from the targeted old GET,
  // so the product must reject a successful late response by identity epoch.
  await page.addInitScript(target => {
    const original = window.fetch
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href)
      return original(input, url.pathname === target ? { ...init, signal: undefined } : init)
    }
  }, target)
  await page.route('**/api/user/login', route => {
    owner = 8
    return route.fulfill({ json: { success: true, data: { access_token: 'F-owner-eight', token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'F-eight-session' }, user: { id: 8, username: 'F-eight', display_name: 'F-B账号' } } } })
  })
  await page.route('**/api/user/self', route => owner === 8 ? route.fulfill({ json: { success: true, data: { id: 8, username: 'F-eight', display_name: 'F-B账号' } } }) : route.fallback())
  await page.route('**/api/user/auth/refresh', route => owner === 8 ? route.fulfill({ json: { success: true, data: { access_token: 'F-owner-eight', token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'F-eight-session' }, user: { id: 8, username: 'F-eight', display_name: 'F-B账号' } } } }) : route.fallback())
  await page.route('**/api/studio/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const requestedOwner = request.headers().authorization === 'Bearer F-owner-eight' ? 8 : 7
    if (request.method() !== 'GET') {
      if (!armed && requestedOwner === 7 && request.method() === 'PATCH' && path.endsWith(ids.projectA)) {
        setupWrites.push({ path, method: request.method(), requestedOwner })
        return route.fulfill({ json: { success: true, data: { ...project(ids.projectA, 'A'), ...request.postDataJSON(), revision: request.postDataJSON().expectedRevision + 1 } } })
      }
      writes.push({ path, method: request.method(), requestedOwner }); return route.fulfill({ status: 400, json: { success: false, message: 'F 不允许业务写入' } })
    }
    if (armed && path === target && requestedOwner === 7) { arrived = true; await new Promise(resolve => { release = resolve }) }
    const reject = () => { denied.push({ path, requestedOwner }); return route.fulfill({ status: 404, json: { success: false, message: 'F 不存在或无权访问' } }) }
    let data
    if (path.endsWith('/models')) data = { generationEnabled: true, models: [{ id: 'F-chat', kind: 'chat', displayName: 'F聊天', accessible: true }] }
    else if (path.endsWith('/trial')) { ownReads.push({ kind: 'trial', requestedOwner }); data = { state: 'disabled', message: `F-${requestedOwner}-试用关闭`, chat: { limit: 4, remaining: 0, used: 0, held: 0 }, image: { limit: 1, remaining: 0, used: 0, held: 0 }, pendingReconciliation: false } }
    else if (path.endsWith('/billing')) { ownReads.push({ kind: 'billing', requestedOwner }); data = { currency: 'CNY', balance: requestedOwner === 8 ? 82 : 71, spent: 0, requestCount: 0, groupRatio: 1, usdExchangeRate: 7.3, prices: [], recentCalls: [{ id: 1, model: 'F-same-model', cost: 0.01, createdAt: requestedOwner === 8 ? timeB : timeA }, ...(requestedOwner === 8 ? [null, -1, undefined, 'invalid', 9007199254740991].map((createdAt, index) => ({ id: index + 2, model: 'F-invalid-time', cost: 0.01, createdAt })) : [])] } }
    else if (path.endsWith('/access')) data = { state: 'disabled', message: 'F生成权限关闭', canRenew: false }
    else if (path.endsWith('/threads')) data = { items: requestedOwner === 7 ? [thread(ids.threadA, 'A'), thread(ids.lateThreadA, 'A-late')] : [thread(ids.threadB, 'B')], nextOffset: null }
    else if (path.includes('/threads/')) {
      const id = path.split('/').at(-1)
      if ((requestedOwner === 7 && [ids.threadA, ids.lateThreadA].includes(id)) || (requestedOwner === 8 && id === ids.threadB)) data = thread(id, requestedOwner === 7 ? 'A' : 'B')
      else return reject()
    } else if (path.includes('/projects/')) {
      const id = path.split('/').at(-1)
      if (id === (requestedOwner === 7 ? ids.projectA : ids.projectB)) data = project(id, requestedOwner === 7 ? 'A' : 'B')
      else return reject()
    } else if (path.includes('/assets/')) {
      if (requestedOwner !== 7) return reject()
      data = { id: path.split('/').at(-1), mimeType: 'image/png', width: 13, height: 17, dataURL: imageA }
    } else return reject()
    return route.fulfill({ json: { success: true, data } })
  })
  await page.goto(`./chat?thread=${ids.threadA}`)
  await expect(page.getByText('F-A-私有回答', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片')).toHaveAttribute('src', imageA)
  await openAccountSection(page, 'billing')
  await page.getByText('最近调用记录折算（实扣待核对）', { exact: true }).click()
  await expect(page.locator(`time[datetime="${isoA}"]`)).toBeVisible()
  await closeAccount(page)
  if (lateKind === 'asset') {
    await page.goto(`./canvas-lab?project=${ids.projectA}&asset=${ids.assetA}`)
    await expect(page.getByText('F-A-私有项目', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '保存 Studio 项目', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('已保存到 Studio 项目')
  }
  armed = true
  if (lateKind === 'detail') await page.getByRole('button', { name: 'F-A-late-私有标题', exact: true }).click()
  else await page.goto(`./canvas-lab?project=${ids.projectA}&asset=${ids.lateAssetA}`)
  await expect.poll(() => arrived).toBe(true)
  await openAccountSection(page)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置' })).not.toBeVisible()
  await page.evaluate(({ image, iso }) => {
    window.foreignFlashes = []
    const check = () => {
      const text = document.body.textContent ?? ''
      if (/F-A-(私有标题|私有问题|私有回答|私有项目)/.test(text) || [...document.querySelectorAll('img')].some(node => node.src === image) || document.querySelector(`time[datetime="${iso}"]`)) window.foreignFlashes.push('A content observed after logout')
    }
    window.foreignObserver = new MutationObserver(check)
    window.foreignObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
    check()
  }, { image: imageA, iso: isoA })
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('F-eight')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：F-B账号', { exact: true })).toBeVisible()
  await closeAccount(page)
  const lateSuccess = page.waitForResponse(response => new URL(response.url()).pathname === target && response.request().headers().authorization !== 'Bearer F-owner-eight' && response.status() === 200)
  release()
  await lateSuccess
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByText(/F 不存在或无权访问/)).toBeVisible()
  expect(await page.evaluate(() => window.foreignFlashes)).toEqual([])
  await page.evaluate(() => window.foreignObserver.disconnect())
  armed = false
  for (const path of [`chat?thread=${ids.threadA}`, `canvas-lab?project=${ids.projectA}`, `canvas-lab?project=${ids.projectB}&asset=${ids.assetA}`]) {
    await page.goto(`./${path}`)
    await expect(page.getByText(/F 不存在或无权访问/)).toBeVisible()
    await expect(page.getByText('F-A-私有回答', { exact: true })).toHaveCount(0)
    await expect(page.getByText('F-A-私有项目', { exact: true })).toHaveCount(0)
    await expect(page.locator(`img[src="${imageA}"]`)).toHaveCount(0)
  }
  expect(denied.some(row => row.path.endsWith(ids.threadA) && row.requestedOwner === 8)).toBe(true)
  expect(denied.some(row => row.path.endsWith(ids.projectA) && row.requestedOwner === 8)).toBe(true)
  expect(denied.some(row => row.path.endsWith(ids.assetA) && row.requestedOwner === 8)).toBe(true)
  expect(writes).toEqual([])
  await page.goto(`./chat?thread=${ids.threadB}`)
  await expect(page.getByText('F-B-私有回答', { exact: true })).toBeVisible()
  const dialog = await openAccountSection(page, 'trial')
  await expect(dialog.getByText('F-8-试用关闭', { exact: true })).toBeVisible()
  await openAccountSection(page, 'billing')
  await expect(dialog.getByLabel('账户用量')).toContainText('82.00')
  await expect(dialog.getByLabel('账户用量')).not.toContainText('71.00')
  await dialog.getByText('最近调用记录折算（实扣待核对）', { exact: true }).click()
  await expect(dialog.locator(`time[datetime="${isoB}"]`)).toBeVisible()
  await expect(dialog.locator(`time[datetime="${isoA}"]`)).toHaveCount(0)
  await expect(dialog.getByText('调用时间按本机时区显示。', { exact: true })).toBeVisible()
  await expect(dialog.getByText('调用时间不可用', { exact: true })).toHaveCount(5)
  await expect(dialog.locator('time')).toHaveCount(1)
  expect(ownReads.some(row => row.kind === 'trial' && row.requestedOwner === 8)).toBe(true)
  expect(ownReads.some(row => row.kind === 'billing' && row.requestedOwner === 8)).toBe(true)
  expect(writes).toEqual([])
})
