import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

const models = [
  { id: 'chat-a', displayName: '聊天 A', kind: 'chat', accessible: true, provider: 'Fixture' },
  { id: 'chat-b', displayName: '聊天 B', kind: 'chat', accessible: true, provider: 'Fixture' },
  { id: 'image-a', displayName: '图片 A', kind: 'image', accessible: true, provider: 'Fixture', operations: ['generate'] },
  { id: 'image-b', displayName: '图片 B', kind: 'image', accessible: true, provider: 'Fixture', operations: ['generate'] },
]

async function setup(page) {
  const account = await mockAccount(page); account.active = true
  let blocked = false, posts = 0
  page.on('request', request => { if (request.url().includes('/api/studio/') && request.method() === 'POST') posts++ })
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: models.map(model => ({ ...model, accessible: !(blocked && model.id.endsWith('-b')) })) } } }))
  await page.goto('./canvas')
  await expect(page.getByLabel('输入消息', { exact: true })).toBeEnabled()
  return { account, block: () => { blocked = true }, posts: () => posts }
}

test('Loomic retains an explicit unavailable Agent and rejects before any model POST until the user chooses', async ({ page }) => {
  const fixture = await setup(page)
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await page.getByRole('button', { name: '聊天 B', exact: true }).click()
  await page.getByLabel('输入消息', { exact: true }).fill('尚未发送的输入')
  fixture.block()
  await page.getByRole('button', { name: '聊天 B', exact: true }).click()
  await expect(page.getByText('所选对话模型当前不可用，请重新选择；不会自动改用其他模型。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '聊天 A', exact: true })).toBeVisible()
  await expect(page.getByLabel('输入消息', { exact: true })).toHaveValue('尚未发送的输入')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => localStorage.getItem('loomic:agent-model:local:7'))).toBe('chat-b')
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
  await expect(page.getByText('所选对话模型当前不可用，请重新选择 Agent 模型', { exact: true })).toBeVisible()
  expect(fixture.posts()).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: '所选模型不可用', exact: true })).toBeVisible()
  expect(fixture.posts()).toBe(0)
  await page.getByRole('button', { name: '所选模型不可用', exact: true }).click()
  await page.getByRole('button', { name: '聊天 A', exact: true }).click()
  let sent
  await page.route('**/api/studio/runs/stream', route => {
    sent = route.request().postDataJSON()
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'message.delta', runId: sent.runId, timestamp: new Date().toISOString(), delta: '本人明确重选后的替身回复' })}\n\ndata: ${JSON.stringify({ type: 'run.completed', runId: sent.runId, timestamp: new Date().toISOString() })}\n\n` })
  })
  await page.getByLabel('输入消息', { exact: true }).fill('明确重新发送')
  await page.getByLabel('输入消息', { exact: true }).press('Enter')
  await expect(page.getByText('本人明确重选后的替身回复', { exact: true })).toBeVisible()
  expect(sent.model).toBe('chat-a'); expect(fixture.posts()).toBe(1)
})

test('Loomic image preferences cannot newly select an inaccessible model', async ({ page }) => {
  const fixture = await setup(page); fixture.block()
  await page.getByTitle('Image model', { exact: true }).click()
  await expect(page.getByRole('button', { name: /^图片 B/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: '图片 A', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '图片 A', exact: true }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loomic:image-model-preference:local:7')))).toEqual({ mode: 'manual', models: ['image-a'] })
  expect(fixture.posts()).toBe(0)
})

for (const corrupted of [false, true]) test(`Loomic choices stay with their owner when the next owner preference is ${corrupted ? 'corrupt' : 'absent'}`, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('loomic:agent-model', 'chat-b')
    localStorage.setItem('loomic:image-model-preference', JSON.stringify({ mode: 'manual', models: ['image-b'] }))
  })
  const fixture = await setup(page)
  if (corrupted) await page.evaluate(() => localStorage.setItem('loomic:image-model-preference:local:8', '{invalid'))
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await page.getByRole('button', { name: '聊天 B', exact: true }).click()
  await page.getByTitle('Image model', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Auto', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '图片 B', exact: true }).click()
  await page.keyboard.press('Escape')
  await openAccountSection(page, 'profile')
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeVisible()
  const next = { id: 8, username: 'owner-eight', display_name: '另一账号' }
  await page.route('**/api/user/login', route => route.fulfill({ json: { success: true, data: { access_token: 'owner-eight-fixture', token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'owner-eight-session' }, user: next } } }))
  await page.route('**/api/user/self', route => route.request().headers().authorization === 'Bearer owner-eight-fixture' ? route.fulfill({ json: { success: true, data: next } }) : route.fallback())
  await openAccountSection(page, 'profile')
  await page.getByLabel('用户名', { exact: true }).fill('owner-eight')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByText('当前账号：另一账号', { exact: true })).toBeVisible()
  await closeAccount(page)
  await expect(page.getByRole('button', { name: 'Agent', exact: true })).toBeVisible()
  await page.getByTitle('Image model', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Auto', exact: true })).toBeVisible()
  const stored = await page.evaluate(() => ({ old: localStorage.getItem('loomic:agent-model'), own: localStorage.getItem('loomic:agent-model:local:7'), other: localStorage.getItem('loomic:agent-model:local:8'), ownImage: JSON.parse(localStorage.getItem('loomic:image-model-preference:local:7')), otherImage: localStorage.getItem('loomic:image-model-preference:local:8') }))
  expect(stored).toEqual({ old: 'chat-b', own: 'chat-b', other: null, ownImage: { mode: 'manual', models: ['image-b'] }, otherImage: corrupted ? '{invalid' : null })
  expect(fixture.posts()).toBe(0)
})
