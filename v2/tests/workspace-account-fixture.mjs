import { expect } from '@playwright/test'

const sectionLabels = { profile: '账号资料', billing: '余额与用量', trial: '新用户试用', access: '生成权限', security: '安全与会话' }

// Exercises the public sidebar menu, including the guest label, on every page.
export async function openAccountSection(page, section = 'profile') {
  const dialog = page.getByRole('dialog', { name: '账号与设置', exact: true })
  if (!await dialog.isVisible()) {
    await page.getByRole('button', { name: 'New API 账号', exact: true }).click()
    await page.getByRole('menuitem', { name: /^(账号与设置|登录账号)$/ }).click()
    await expect(dialog).toBeVisible()
  }
  await dialog.getByRole('navigation', { name: '账号设置分类' }).getByRole('button', { name: sectionLabels[section], exact: true }).click()
  return dialog
}

export async function closeAccount(page) {
  await page.getByRole('button', { name: '关闭账号窗口', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
}
