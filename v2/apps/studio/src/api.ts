export interface User { id: number; username: string; display_name?: string }
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('仅允许同源业务 API')
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  let payload: { success?: boolean; message?: string; data?: T }
  try { payload = await response.json() } catch { throw new Error(`后端响应不是 JSON（HTTP ${response.status}）`) }
  if (!response.ok || payload.success !== true) throw new Error(payload.message || `API 请求失败（HTTP ${response.status}）`)
  return payload.data as T
}
export async function currentUser(signal?: AbortSignal): Promise<User> {
  const user = await request<User>('/api/user/self', { signal })
  if (!user || !Number.isSafeInteger(user.id) || typeof user.username !== 'string') throw new Error('账户响应格式不正确')
  return user
}
export async function login(username: string, password: string): Promise<User> {
  await request('/api/user/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  return currentUser()
}
export async function logout(): Promise<void> { await request('/api/user/logout') }
