export interface User { id: number; username: string; display_name?: string }
interface Session {
  access_token: string
  token_type: string
  access_expires_at: number
  session: { sid: string }
  user: User
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfterSeconds?: number) { super(message) }
}

// 访问令牌仅保留在内存；页面刷新通过 New API 的 HttpOnly Cookie 恢复会话。
let session: Session | null = null
let refreshing: Promise<Session | null> | null = null
let sessionVersion = 0
let recoveryError: unknown = null
let identityInvalidated = false
let knownAnonymous = false
const recoveryListeners = new Set<(error: Error) => void>()
export function getIdentityEpoch() { return sessionVersion }
export function assertIdentityEpoch(epoch: number) {
  if (recoveryError) throw recoveryError
  if (epoch !== sessionVersion) throw new Error('身份已变化，请手动恢复会话；不会自动重试')
}
export function subscribeAuthRecovery(listener: (error: Error) => void) {
  recoveryListeners.add(listener)
  if (recoveryError instanceof Error) listener(recoveryError)
  return () => { recoveryListeners.delete(listener) }
}
function reportRecovery(error: unknown) {
  const issue = error instanceof TypeError ? new Error('网络或服务暂不可用，请稍后手动恢复会话；不会自动重试')
    : error instanceof Error ? error : new Error('会话暂时无法恢复，请稍后手动核对')
  recoveryError = issue
  recoveryListeners.forEach(listener => listener(issue))
  return issue
}

// Only an invalidation signal crosses tabs; credentials and owner identifiers
// remain in each tab's memory. Native external sign-outs need separate evidence.
const identityChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('gouo-studio-identity')
identityChannel?.addEventListener('message', event => {
  if (event.data !== 'identity-invalidated') return
  sessionVersion += 1
  identityInvalidated = true
  knownAnonymous = false
  reportRecovery(new Error('另一个标签页已退出账号，请手动恢复当前身份；旧工作区已暂时隐藏'))
})

function responseError(response: Response, message?: string) {
  const retry = response.headers.get('Retry-After')
  const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) : undefined
  const retryAfterSeconds = Number.isSafeInteger(seconds) ? seconds : undefined
  return new ApiError(response.status === 429 ? `请求过于频繁${retryAfterSeconds ? `，请等待 ${retryAfterSeconds} 秒后手动恢复` : '，请稍后手动恢复'}；不会自动重试`
    : message || `后端请求失败（HTTP ${response.status}），请手动核对`, response.status, retryAfterSeconds)
}

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
  try { payload = await response.json() } catch { throw responseError(response) }
  if (!response.ok || payload?.success !== true) throw responseError(response, payload?.message)
  return payload.data as T
}

function refreshSession(useBrowserIdentity = false): Promise<Session | null> {
  if (recoveryError) return Promise.reject(recoveryError)
  if (refreshing) return refreshing
  const version = sessionVersion
  const headers = session && !useBrowserIdentity ? { 'X-Auth-Session': session.session.sid } : undefined
  const pending: Promise<Session | null> = send<Session>('/api/user/auth/refresh', { method: 'POST', headers })
    .then((value) => {
      const next = validateSession(value)
      assertIdentityEpoch(version)
      if (version === sessionVersion) { session = next; knownAnonymous = false }
      return session
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) { if (version === sessionVersion) { session = null; knownAnonymous = true }; return null }
      throw version === sessionVersion ? reportRecovery(error) : error
    }).finally(() => { if (refreshing === pending) refreshing = null })
  refreshing = pending
  return pending
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const epoch = sessionVersion
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('仅允许同源业务 API')
  if (recoveryError) throw recoveryError
  if (!session && knownAnonymous) throw new ApiError('请先登录 New API 账号', 401)
  if (!session || session.access_expires_at <= Date.now() / 1000 + 30) await refreshSession()
  assertIdentityEpoch(epoch)
  init.signal?.throwIfAborted()
  if (!session) throw new ApiError('请先登录 New API 账号', 401)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  try { assertIdentityEpoch(epoch); const result = await send<T>(path, { ...init, headers }); assertIdentityEpoch(epoch); return result }
  catch (error) {
    assertIdentityEpoch(epoch)
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    // 只重试读取，写入或生图请求不能因会话失效而自动重复提交。
    if (!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) {
      session = null
      throw error
    }
    const next = await refreshSession()
    assertIdentityEpoch(epoch)
    init.signal?.throwIfAborted()
    if (!next) throw error
    headers.set('Authorization', `Bearer ${next.access_token}`)
    const result = await send<T>(path, { ...init, headers })
    assertIdentityEpoch(epoch)
    return result
  }
}

export async function currentUser(signal?: AbortSignal, options: { retryRecovery?: boolean } = {}): Promise<User | null> {
  const epoch = sessionVersion
  if (options.retryRecovery) { recoveryError = null; knownAnonymous = false }
  try {
    if (options.retryRecovery && identityInvalidated) {
      if (refreshing) await refreshing.catch(() => null)
      assertIdentityEpoch(epoch)
      // Explicitly read the current shared browser cookie after a confirmed
      // cross-tab sign-out, rather than fencing it to the retired tab's SID.
      const restored = await refreshSession(true)
      assertIdentityEpoch(epoch)
      identityInvalidated = false
      if (!restored) return null
    }
    const user = await request<User>('/api/user/self', { signal })
    assertIdentityEpoch(epoch)
    signal?.throwIfAborted()
    if (!session) return null
    if (!user || !Number.isSafeInteger(user.id) || user.id !== session.user.id || typeof user.username !== 'string') throw new Error('账户响应格式不正确')
    return user
  } catch (error) {
    if (epoch !== sessionVersion) throw recoveryError ?? error
    if (error instanceof ApiError && error.status === 401) { session = null; knownAnonymous = true; return null }
    if (!(error instanceof DOMException && error.name === 'AbortError')) throw reportRecovery(error)
    throw error
  }
}

export async function login(username: string, password: string): Promise<User> {
  if (refreshing) await refreshing.catch(() => null)
  sessionVersion += 1
  session = null
  recoveryError = null
  identityInvalidated = false
  knownAnonymous = false
  const epoch = sessionVersion
  const value = await send<Session>('/api/user/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  assertIdentityEpoch(epoch)
  session = validateSession(value)
  const user = await currentUser()
  if (!user) throw new Error('登录会话已失效，请重试')
  return user
}

export async function logout(): Promise<number> {
  const epoch = sessionVersion
  if (refreshing) await refreshing.catch(() => null)
  assertIdentityEpoch(epoch)
  const headers = new Headers()
  if (session) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
    headers.set('X-Auth-Session', session.session.sid)
  }
  const result = await send<{ revoked_sid?: string; cookie_cleared?: boolean } | undefined>('/api/user/auth/logout', { method: 'POST', headers })
  assertIdentityEpoch(epoch)
  // The pinned server may revoke a Bearer session without clearing a different
  // browser cookie. Do not claim a complete sign-out in that case.
  if (result?.cookie_cleared === false) throw new Error('浏览器会话已切换，请刷新页面后再退出登录')
  sessionVersion += 1
  session = null
  recoveryError = null
  identityInvalidated = false
  knownAnonymous = true
  identityChannel?.postMessage('identity-invalidated')
  return sessionVersion
}

// 流式写操作只发送一次，不能自动重放可能已经计费的请求。
export async function requestStream(path: string, init: RequestInit): Promise<Response> {
  const epoch = sessionVersion
  if (!path.startsWith('/api/') || path.includes('://')) throw new Error('仅允许同源业务 API')
  if (recoveryError) throw recoveryError
  if (!session && knownAnonymous) throw new ApiError('请先登录 New API 账号', 401)
  if (!session || session.access_expires_at <= Date.now() / 1000 + 30) await refreshSession()
  assertIdentityEpoch(epoch)
  init.signal?.throwIfAborted()
  if (!session) throw new ApiError('请先登录 New API 账号', 401)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'text/event-stream')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store', redirect: 'error' })
  assertIdentityEpoch(epoch)
  if (!response.ok) {
    if (response.status === 401) session = null
    const payload = await response.json().catch(() => null)
    assertIdentityEpoch(epoch)
    throw responseError(response, payload?.message)
  }
  return response
}
