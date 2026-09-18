import { test, expect } from '@playwright/test'
test('workspace, editor and export are usable without AI credentials', async ({ page }) => {
  await page.route('**/api/user/self', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, message: '未登录' }) }))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '商品创作工作台' })).toBeVisible()
  await page.getByRole('link', { name: '打开本地编辑器' }).click()
  await expect(page.getByRole('button', { name: '添加文字' })).toBeEnabled()
  await page.getByRole('button', { name: '添加文字' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 PNG' }).click()
  expect((await download).suggestedFilename()).toBe('gouo-design-1280.png')
  await page.getByRole('link', { name: '模型接入清单' }).click()
  await expect(page.getByText('gpt-image-2.5-sunburst', { exact: true })).toBeVisible()
})
