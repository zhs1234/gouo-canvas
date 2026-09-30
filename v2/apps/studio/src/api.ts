export interface User { id: number; username: string; display_name?: string }
interface Session {
  access_token: string
  token_type: string
  access_expires_at: number
  session: { sid: string }
  user: User
}

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

// 访问令牌仅保留在内存；页面刷新通过 New API 的 HttpOnly Cookie 恢复会话。
let session: Session | null = null
let refreshing: Promise<Session | null> | null = null
let sessionVersion = 0

function validateSession(value: Session): Session {
  if (!value || typeof value.access_token !== 'string' || !value.access_token.trim() || /[\r\n]/.test(value.access_token)
    || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(value.access_expires_at)
    || value.access_expires_at <= Date.now() / 1000 || typeof value.session?.sid !== 'string' || !value.session.sid
    || !Number.isSafeInteger(value.user?.id) || value.user.id <= 0 || typeof value.user.username !== 'string') {
    throw new Error('登录响应缺少有效会话；如账号启用了额外验证，请先在 New API 后台完成登录')
  }
  return value
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('仅允许同源业务 API')
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store', redirect: 'error' })
  let payload: { success?: boolean; message?: string; data?: T }
  try { payload = await response.json() } catch { throw new Error(`后端响应不是 JSON（HTTP ${response.status}）`) }
  if (!response.ok || payload.success !== true) throw new ApiError(payload.message || `API 请求失败（HTTP ${response.status}）`, response.status)
  return payload.data as T
}

function refreshSession(): Promise<Session | null> {
  if (refreshing) return refreshing
  const version = sessionVersion
  const headers = session ? { 'X-Auth-Session': session.session.sid } : undefined
  const pending: Promise<Session | null> = send<Session>('/api/user/auth/refresh', { method: 'POST', headers })
    .then((value) => {
      const next = validateSession(value)
      if (version === sessionVersion) session = next
      return session
    }).catch((error: unknown) => {
      if (version === sessionVersion) session = null
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }).finally(() => { if (refreshing === pending) refreshing = null })
  refreshing = pending
  return pending
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('仅允许同源业务 API')
  if (!session || session.access_expires_at <= Date.now() / 1000 + 30) await refreshSession()
  init.signal?.throwIfAborted()
  if (!session) throw new ApiError('请先登录 New API 账号', 401)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  try { return await send<T>(path, { ...init, headers }) }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    // 只重试读取，写入或生图请求不能因会话失效而自动重复提交。
    if (!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) {
      session = null
      throw error
    }
    const next = await refreshSession()
    init.signal?.throwIfAborted()
    if (!next) throw error
    headers.set('Authorization', `Bearer ${next.access_token}`)
    return send<T>(path, { ...init, headers })
  }
}

export async function currentUser(signal?: AbortSignal): Promise<User | null> {
  try {
    const user = await request<User>('/api/user/self', { signal })
    signal?.throwIfAborted()
    if (!session) return null
    if (!user || !Number.isSafeInteger(user.id) || user.id !== session.user.id || typeof user.username !== 'string') throw new Error('账户响应格式不正确')
    return user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

export async function login(username: string, password: string): Promise<User> {
  if (refreshing) await refreshing.catch(() => null)
  sessionVersion += 1
  session = null
  const value = await send<Session>('/api/user/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  session = validateSession(value)
  const user = await currentUser()
  if (!user) throw new Error('登录会话已失效，请重试')
  return user
}

export async function logout(): Promise<void> {
  if (refreshing) await refreshing.catch(() => null)
  const headers = new Headers()
  if (session) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
    headers.set('X-Auth-Session', session.session.sid)
  }
  const result = await send<{ revoked_sid?: string; cookie_cleared?: boolean } | undefined>('/api/user/auth/logout', { method: 'POST', headers })
  // The pinned server may revoke a Bearer session without clearing a different
  // browser cookie. Do not claim a complete sign-out in that case.
  if (result?.cookie_cleared === false) throw new Error('浏览器会话已切换，请刷新页面后再退出登录')
  sessionVersion += 1
  session = null
}

// 流式写操作只发送一次，不能自动重放可能已经计费的请求。
export async function requestStream(path: string, init: RequestInit): Promise<Response> {
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('仅允许同源业务 API')
  if (!session || session.access_expires_at <= Date.now() / 1000 + 30) await refreshSession()
  init.signal?.throwIfAborted()
  if (!session) throw new ApiError('请先登录 New API 账号', 401)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'text/event-stream')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store', redirect: 'error' })
  if (!response.ok) {
    if (response.status === 401) session = null
    const payload = await response.json().catch(() => null)
    throw new ApiError(payload?.message || `生成请求失败（HTTP ${response.status}）`, response.status)
  }
  return response
}
