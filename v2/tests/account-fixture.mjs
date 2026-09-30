import { expect } from '@playwright/test'

export async function mockAccount(page) {
  const user = { id: 7, username: 'studio-user', display_name: '测试用户' }
  const state = { active: false, token: '', refreshes: 0, failLogout: false, rejectProfileOnce: false }
  const bundle = () => ({ access_token: state.token, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: 'test-session' }, user })
  await page.route('**/api/user/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = request.headers()
    if (path === '/api/user/login') {
      if (request.postDataJSON().password !== 'test-password') return route.fulfill({ json: { success: false, message: '用户名或密码错误' } })
      state.active = true; state.token = 'test-access-token'
      return route.fulfill({ json: { success: true, data: bundle() } })
    }
    if (path === '/api/user/auth/refresh') {
      state.refreshes += 1
      if (!state.active) return route.fulfill({ status: 401, json: { success: false, message: '未登录' } })
      state.token = `test-refresh-token-${state.refreshes}`
      return route.fulfill({ json: { success: true, data: bundle() } })
    }
    if (path === '/api/user/auth/logout') {
      expect(request.method()).toBe('POST')
      expect(headers.authorization).toBe(`Bearer ${state.token}`)
      expect(headers['x-auth-session']).toBe('test-session')
      if (state.failLogout) return route.fulfill({ status: 500, json: { success: false, message: '退出失败，请重试' } })
      state.active = false
      return route.fulfill({ json: { success: true } })
    }
    if (path === '/api/user/self' && state.rejectProfileOnce) {
      state.rejectProfileOnce = false
      return route.fulfill({ status: 401, json: { success: false, message: '会话已过期' } })
    }
    if (path === '/api/user/self' && state.active && headers.authorization === `Bearer ${state.token}`) {
      return route.fulfill({ json: { success: true, data: user } })
    }
    return route.fulfill({ status: 401, json: { success: false, message: '未登录' } })
  })
  return state
}
