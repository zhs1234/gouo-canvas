import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'

const projectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function fixture(page) {
  const account = await mockAccount(page); account.active = true
  const projects = [{ id: projectId, title: '商品主图 · 界面测试项目', revision: 1, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z' }]
  const threads = [{ id: threadId, title: '商品主图 · 界面测试会话', runs: [] }]
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '本地界面测试', kind: 'chat', accessible: true }] } } }))
  await page.route('**/api/studio/trial', route => route.fulfill({ json: { success: true, data: { state: 'disabled', message: '本地界面测试：试用关闭', chat: { limit: 4, used: 0, held: 0, remaining: 0 }, image: { limit: 1, used: 0, held: 0, remaining: 0 } } } }))
  await page.route('**/api/studio/access', route => route.fulfill({ json: { success: true, data: { state: 'disabled', message: '本地界面测试：权限关闭', canRenew: false } } }))
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: threads, nextOffset: null } } }))
  await page.route('**/api/studio/threads/*', route => route.fulfill({ json: { success: true, data: threads[0] } }))
  await page.route('**/api/studio/projects?*', route => route.fulfill({ json: { success: true, data: { items: projects, nextOffset: null } } }))
  await page.route(`**/api/studio/projects/${projectId}`, route => route.fulfill({ json: { success: true, data: { ...projects[0], document: { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} } } } }))
  await page.route('**/api/studio/runs/stream', route => route.abort('blockedbyclient'))
  return { account, projects, threads }
}

test('all workspace surfaces keep navigation, readable layouts and settings without generation or private writes', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await fixture(page)
  const writes = [], errors = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/studio/') && request.method() !== 'GET') writes.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    const size = viewport.width === 390 ? 'mobile' : 'desktop'
    for (const [name, path, ready] of [
      ['home', './chat', () => page.getByRole('heading', { name: '今天有什么可以帮你？' })],
      ['thread', `./chat?thread=${threadId}`, () => page.getByLabel('消息', { exact: true })],
      ['projects', './projects', () => page.getByRole('link', { name: projectsTitle })],
      ['canvas', `./canvas-lab?project=${projectId}`, () => page.locator('.excalidraw')],
      ['loomic', './canvas?id=ui-design-local', () => page.getByRole('button', { name: '本地保存', exact: true })],
    ]) {
      await page.goto(path)
      await expect(ready()).toBeVisible()
      await expect(page.getByRole('button', { name: '切换侧栏' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${size}-${name}.png`) })
    }
    await page.goto('./chat')
    if (viewport.width === 390) await page.getByRole('button', { name: '切换侧栏' }).click()
    const dialog = await openAccountSection(page)
    await expect(dialog.getByLabel('显示名称', { exact: true })).toBeVisible()
    expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: testInfo.outputPath(`${size}-settings.png`) })
    await closeAccount(page)
  }
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})

const projectsTitle = '商品主图 · 界面测试项目'

test('project loading and failures never pretend to be an empty account library', async ({ page }) => {
  await fixture(page)
  let release
  const waiting = new Promise(resolve => { release = resolve })
  await page.route('**/api/studio/projects?*', async route => {
    await waiting
    return route.fulfill({ status: 503, json: { success: false, message: '明确界面测试：读取失败' } })
  })
  await page.goto('./projects')
  await expect(page.getByText('正在读取账号项目…', { exact: true })).toBeVisible()
  await expect(page.getByText('还没有账号项目', { exact: true })).toHaveCount(0)
  release()
  await expect(page.getByRole('alert')).toContainText('账号项目读取失败')
  await expect(page.getByText('还没有账号项目', { exact: true })).toHaveCount(0)
})

test('rename dialog supports keyboard, cancellation and same-name submissions without a write', async ({ page }) => {
  await fixture(page)
  const writes = []
  page.on('request', request => { if (request.method() === 'PATCH') writes.push(request.url()) })
  await page.goto('./projects')
  const open = page.getByRole('button', { name: `重命名 ${projectsTitle}`, exact: true })
  await open.click()
  const dialog = page.getByRole('dialog', { name: '重命名项目', exact: true })
  await expect(dialog.getByLabel('项目名称', { exact: true })).toBeFocused()
  await dialog.getByLabel('项目名称', { exact: true }).fill('尚未保存的修改')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(open).toBeFocused()
  await open.click()
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await open.click()
  await dialog.getByLabel('项目名称', { exact: true }).fill('   ')
  await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toBeDisabled()
  expect(writes).toEqual([])
})

test('failed rename retains the server title and requires a new explicit submission', async ({ page }) => {
  await fixture(page)
  let writes = 0
  await page.route(`**/api/studio/projects/${projectId}`, route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    writes++
    return route.fulfill({ status: 409, json: { success: false, message: '明确界面测试：版本冲突' } })
  })
  await page.goto('./projects')
  const open = page.getByRole('button', { name: `重命名 ${projectsTitle}`, exact: true })
  await open.click()
  const dialog = page.getByRole('dialog', { name: '重命名项目', exact: true })
  await dialog.getByLabel('项目名称', { exact: true }).fill('未经确认的名称')
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('版本冲突')
  await expect(page.locator('.projects-row-link').first()).toHaveAttribute('aria-label', projectsTitle)
  await expect(dialog.getByLabel('项目名称', { exact: true })).toHaveValue('未经确认的名称')
  await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toBeEnabled()
  expect(writes).toBe(1)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('link', { name: projectsTitle, exact: true })).toBeVisible()
  await open.click()
  await expect(dialog.getByLabel('项目名称', { exact: true })).toHaveValue(projectsTitle)
  expect(writes).toBe(1)
})

test('desktop assistant resizing keeps canvas controls reachable at 1024px', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('./canvas?id=ui-mid-local')
  const separator = page.getByRole('separator', { name: '调整助手面板宽度', exact: true })
  await expect(separator).toBeVisible()
  await separator.focus()
  for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowLeft')
  const canvas = await page.locator('.loomic-canvas-surface').boundingBox()
  expect(canvas.width).toBeGreaterThanOrEqual(320)
  const save = page.getByRole('button', { name: '本地保存', exact: true })
  await expect(save).toBeVisible()
  const saveBox = await save.boundingBox(), heading = await page.locator('.loomic-project-heading').boundingBox()
  expect(heading.x + heading.width).toBeLessThanOrEqual(saveBox.x)
  expect(saveBox.x).toBeGreaterThanOrEqual(canvas.x)
  expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(canvas.x + canvas.width)
  await expect(page.locator('.loomic-account-trigger')).not.toBeVisible()
  await expect(separator).toHaveAttribute('aria-valuenow', await separator.getAttribute('aria-valuemax'))
})

test('small and short screens keep canvas heading clear of save and the settings categories reachable', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./canvas?id=ui-small-local')
  const save = page.getByRole('button', { name: '本地保存', exact: true })
  await expect(save).toBeEnabled()
  const headingBox = await page.locator('.loomic-project-heading').boundingBox(), saveBox = await save.boundingBox()
  expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(saveBox.x)
  await page.getByRole('button', { name: '切换侧栏' }).click()
  const dialog = await openAccountSection(page, 'security')
  await expect(dialog.getByRole('link', { name: '账号安全与登录会话', exact: true })).toBeVisible()
  await dialog.getByRole('navigation', { name: '账号设置分类' }).getByRole('button', { name: '账号资料', exact: true }).click()
  await expect(dialog.getByLabel('显示名称', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('cost rules stay available while consent remains unchecked by default', async ({ page }) => {
  await fixture(page)
  await page.goto(`./chat?thread=${threadId}`)
  await expect(page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额', exact: true })).not.toBeChecked()
  await expect(page.getByText('优先使用剩余试用，耗尽的类别使用余额。', { exact: false })).not.toBeVisible()
  await page.getByText('试用与计费说明', { exact: true }).click()
  await expect(page.getByText('优先使用剩余试用，耗尽的类别使用余额。', { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额', exact: true })).not.toBeChecked()
})

test('skip navigation focuses content without changing preserved query or history', async ({ page }) => {
  await fixture(page)
  await page.goto('./projects?extra=a%2Fb#keep')
  const url = page.url(), length = await page.evaluate(() => history.length)
  const skip = page.getByRole('link', { name: '跳到工作区', exact: true })
  await skip.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#workspace-content')).toBeFocused()
  expect(page.url()).toBe(url)
  expect(await page.evaluate(() => history.length)).toBe(length)
})

for (const width of [320, 390]) test(`canvas more menus remain inside ${width}px viewport`, async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width, height: 568 })
  for (const path of ['./canvas-lab', `./canvas-lab?project=${projectId}`]) {
    await page.goto(path)
    await expect(page.locator('.excalidraw')).toBeVisible()
    await page.getByText('更多操作', { exact: true }).click()
    const panel = page.locator('.canvas-more-panel')
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(568)
  }
})

test('theme survives navigation and canvas reads stay read-only before a visible dark save failure', async ({ page }, testInfo) => {
  await fixture(page)
  let writes = 0
  await page.route(`**/api/studio/projects/${projectId}`, route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    writes++
    return route.fulfill({ status: 503, json: { success: false, message: '明确界面测试：保存不可用' } })
  })
  await page.goto('./chat')
  await page.getByRole('button', { name: '切换主题', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: testInfo.outputPath('dark-home.png') })
  const dialog = await openAccountSection(page)
  await page.screenshot({ path: testInfo.outputPath('dark-settings.png') })
  await closeAccount(page)
  await page.goto(`./canvas-lab?project=${projectId}`)
  await expect(page.locator('.excalidraw')).toHaveClass(/theme--dark/)
  await expect(page.getByRole('button', { name: '保存 Studio 项目', exact: true })).toBeEnabled()
  // Waiting past the existing autosave interval verifies a hydrated read is not
  // a new document revision, including when the editor uses dark UI controls.
  await page.waitForTimeout(800)
  expect(writes).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('dark-canvas.png') })
  const canvas = await page.locator('.excalidraw .interactive').boundingBox()
  await page.mouse.click(canvas.x + 650, canvas.y + 350)
  await page.keyboard.press('r')
  await page.mouse.move(canvas.x + 650, canvas.y + 350)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 760, canvas.y + 430, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.canvas-project-bar').getByRole('alert')).toContainText('保存失败')
  expect(writes).toBe(1)
  await expect(page.getByRole('button', { name: '导出文档备份', exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('dark-canvas-save-failure.png') })
})
