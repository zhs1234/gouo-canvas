import type { AppSettings } from '../types'

interface BackendEnvelope<T> {
  success: boolean
  message?: string
  data?: T
}

export interface GouoUser {
  id: number
  username: string
  display_name?: string
  email?: string
  avatar_url?: string
  quota?: number
  used_quota?: number
  request_count?: number
  created_time?: number
  balance_cny?: number
  used_cny?: number
  quota_cny_rate?: number
  image_price_cny?: number
}

export interface RegisterInput {
  username: string
  password: string
  email?: string
  verificationCode?: string
}

export interface GouoUsageLog {
  created_at: number
  type: number
  content?: string
  model_name?: string
  quota?: number
  request_time?: number
}

interface GouoUsageLogPage {
  data: GouoUsageLog[]
  page: number
  size: number
  total_count: number
}

const configuredBaseUrl = (import.meta.env.VITE_GOUO_BACKEND_URL ?? '').trim().replace(/\/+$/, '')
const configuredDevTarget = (import.meta.env.VITE_GOUO_BACKEND_DEV_TARGET ?? '').trim().replace(/\/+$/, '')

export function isBackendAuthEnabled(): boolean {
  return import.meta.env.VITE_GOUO_BACKEND_ENABLED === 'true'
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${configuredBaseUrl}${normalizedPath}`
}

function requestInit(init?: RequestInit): RequestInit {
  return {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  }
}

async function parseEnvelope<T>(response: Response, requireData: boolean): Promise<T> {
  let payload: BackendEnvelope<T>
  try {
    payload = await response.json() as BackendEnvelope<T>
  } catch {
    throw new Error(`服务返回了无法识别的响应（HTTP ${response.status}）`)
  }

  if (!response.ok || !payload.success || (requireData && payload.data === undefined)) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(apiUrl(path), requestInit(init))
    return await parseEnvelope<T>(response, true)
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接光构服务，请检查后端地址或稍后重试')
    throw error
  }
}

async function backendAction(path: string, body?: Record<string, unknown>, method = body ? 'POST' : 'GET'): Promise<void> {
  try {
    const response = await fetch(apiUrl(path), requestInit({
      method,
      body: body ? JSON.stringify(body) : undefined,
    }))
    await parseEnvelope<void>(response, false)
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接光构服务，请检查后端地址或稍后重试')
    throw error
  }
}

export function getCurrentUser(): Promise<GouoUser> {
  return backendRequest<GouoUser>('/api/user/self')
}

export function login(username: string, password: string): Promise<GouoUser> {
  return backendRequest<GouoUser>('/api/user/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logout(): Promise<void> {
  return backendAction('/api/user/logout')
}

export async function updateCurrentUser(displayName: string): Promise<void> {
  await backendAction('/api/user/self', { display_name: displayName.trim() }, 'PUT')
}

export function getBackendPanelUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseUrl = import.meta.env.DEV ? configuredDevTarget || configuredBaseUrl : configuredBaseUrl
  return `${baseUrl}${normalizedPath}`
}

export function redeemCode(key: string): Promise<number> {
  return backendRequest<number>('/api/user/topup', {
    method: 'POST',
    body: JSON.stringify({ key: key.trim() }),
  })
}

export function getUsageLogs(): Promise<GouoUsageLogPage> {
  return backendRequest<GouoUsageLogPage>('/api/log/self?page=1&size=10&order=-created_at')
}

export async function register(input: RegisterInput): Promise<void> {
  await backendAction('/api/user/register', {
    username: input.username.trim(),
    password: input.password,
    email: input.email?.trim() || '',
    verification_code: input.verificationCode?.trim() || '',
  })
}

export function getPlaygroundToken(): Promise<string> {
  return backendRequest<string>('/api/token/playground')
}

export async function createBackendSettings(): Promise<Partial<AppSettings>> {
  const token = await getPlaygroundToken()
  const sameOriginBaseUrl = typeof window === 'undefined' ? '/v1' : `${window.location.origin}/v1`
  return {
    baseUrl: configuredBaseUrl ? `${configuredBaseUrl}/v1` : sameOriginBaseUrl,
    apiKey: token,
    model: import.meta.env.VITE_GOUO_IMAGE_MODEL?.trim() || 'gpt-image-2',
    apiMode: 'images',
    apiProxy: false,
    streamImages: false,
  }
}
