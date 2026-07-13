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
  metadata?: Record<string, unknown>
}

interface GouoUsageLogPage {
  data: GouoUsageLog[]
  page: number
  size: number
  total_count: number
}

export interface GouoBackendStatus {
  email_service?: boolean
  email_verification?: boolean
  gouo_cloud_library?: boolean
}

export interface GouoCloudStorage {
  enabled: boolean
  used_bytes: number
  quota_bytes: number
  remaining_bytes: number
  asset_count: number
}

export interface GouoCloudAsset {
  id: string
  client_image_id?: string
  sha256: string
  mime_type: string
  file_size: number
  width?: number
  height?: number
  original_name?: string
  content_url: string
  deduplicated?: boolean
}

export interface GouoCloudTaskAsset {
  asset_id: string
  role: 'input' | 'mask_target' | 'mask' | 'output' | 'thumbnail' | 'partial' | 'transparent_original'
  position: number
  client_image_id: string
  asset: GouoCloudAsset
}

export interface GouoCloudTask {
  id: string
  client_task_id: string
  schema_version: number
  status: 'done' | 'error'
  prompt: string
  model: string
  operation: 'generation' | 'edit' | 'variation'
  params: Record<string, unknown>
  result_meta: Record<string, unknown>
  error_message?: string
  client_created_at: number
  finished_at?: number
  created_at: number
  updated_at: number
  hidden_at?: number
  assets: GouoCloudTaskAsset[]
  favorite_collection_ids?: string[]
}

export interface GouoCloudCollection {
  id: string
  name: string
  created_at: number
  updated_at: number
  hidden_at?: number
}

export interface GouoCloudSyncResult {
  tasks: GouoCloudTask[]
  collections: GouoCloudCollection[]
  favorite_items: Array<{ collection_id: string; task_id: string; created_at: number; updated_at: number }>
  next_cursor: string
  has_more: boolean
  server_time: number
}

const configuredBaseUrl = (import.meta.env.VITE_GOUO_BACKEND_URL ?? '').trim().replace(/\/+$/, '')
let backendToken = ''
let backendSessionReady = false

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

export function getBackendStatus(): Promise<GouoBackendStatus> {
  return backendRequest<GouoBackendStatus>('/api/status')
}

export function login(username: string, password: string): Promise<GouoUser> {
  return backendRequest<GouoUser>('/api/user/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logout(): Promise<void> {
  backendToken = ''
  backendSessionReady = false
  return backendAction('/api/user/logout')
}

export async function updateCurrentUser(displayName: string): Promise<void> {
  await backendAction('/api/user/self', { display_name: displayName.trim() }, 'PUT')
}

export function redeemCode(key: string): Promise<number> {
  return backendRequest<number>('/api/user/topup', {
    method: 'POST',
    body: JSON.stringify({ key: key.trim() }),
  })
}

export function getUsageLogs(page = 1, size = 20, filters?: { model?: string; type?: number; start?: number; end?: number }): Promise<GouoUsageLogPage> {
  const params = new URLSearchParams({ page: String(page), size: String(size), order: '-created_at' })
  if (filters?.model) params.set('model_name', filters.model)
  if (filters?.type) params.set('log_type', String(filters.type))
  if (filters?.start) params.set('start_timestamp', String(filters.start))
  if (filters?.end) params.set('end_timestamp', String(filters.end))
  return backendRequest<GouoUsageLogPage>(`/api/log/self?${params}`)
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

export async function createBackendSettings(forceRefresh = false): Promise<Partial<AppSettings>> {
  if (!backendToken || forceRefresh) backendToken = await getPlaygroundToken()
  backendSessionReady = true
  const sameOriginBaseUrl = typeof window === 'undefined' ? '/v1' : `${window.location.origin}/v1`
  return {
    baseUrl: configuredBaseUrl ? `${configuredBaseUrl}/v1` : sameOriginBaseUrl,
    apiKey: backendToken,
    model: import.meta.env.VITE_GOUO_IMAGE_MODEL?.trim() || 'gpt-image-2',
    apiMode: 'images',
    apiProxy: false,
    streamImages: false,
  }
}

export function isBackendSessionReady(): boolean {
  return backendSessionReady
}

export function isInvalidBackendTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /无效的令牌|invalid.{0,8}token|token.{0,8}(invalid|expired)|HTTP 401/i.test(message)
}

export function getCloudStorage(): Promise<GouoCloudStorage> {
  return backendRequest<GouoCloudStorage>('/api/gouo/storage')
}

export async function uploadCloudAsset(file: Blob, clientImageId: string, sha256: string): Promise<GouoCloudAsset> {
  const form = new FormData()
  form.append('file', file, `${clientImageId}.${file.type.split('/')[1] || 'png'}`)
  form.append('client_image_id', clientImageId)
  form.append('sha256', sha256)
  const response = await fetch(apiUrl('/api/gouo/assets'), { method: 'POST', credentials: 'include', body: form })
  return parseEnvelope<GouoCloudAsset>(response, true)
}

export function putCloudTask(clientTaskId: string, task: Record<string, unknown>): Promise<GouoCloudTask> {
  return backendRequest<GouoCloudTask>(`/api/gouo/tasks/${encodeURIComponent(clientTaskId)}`, {
    method: 'PUT',
    body: JSON.stringify(task),
  })
}

export function getCloudSync(cursor = ''): Promise<GouoCloudSyncResult> {
  const params = new URLSearchParams({ limit: '100' })
  if (cursor) params.set('cursor', cursor)
  return backendRequest<GouoCloudSyncResult>(`/api/gouo/sync?${params}`)
}

export function putCloudCollection(id: string, name: string): Promise<GouoCloudCollection> {
  return backendRequest<GouoCloudCollection>(`/api/gouo/collections/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export async function fetchCloudAssetContent(asset: GouoCloudAsset): Promise<Blob> {
  const response = await fetch(apiUrl(asset.content_url), { credentials: 'include' })
  if (!response.ok) throw new Error(`下载云端图片失败（HTTP ${response.status}）`)
  return response.blob()
}

export function setCloudTaskHidden(id: string, hidden: boolean): Promise<void> {
  return backendAction(`/api/gouo/tasks/${encodeURIComponent(id)}/${hidden ? 'hide' : 'restore'}`, {})
}

export function updatePassword(currentPassword: string, newPassword: string): Promise<void> {
  return backendAction('/api/user/password', { current_password: currentPassword, new_password: newPassword }, 'PUT')
}

export function sendEmailVerification(email: string): Promise<void> {
  return backendAction(`/api/verification?email=${encodeURIComponent(email)}`)
}

export function bindEmail(email: string, code: string): Promise<void> {
  return backendAction(`/api/oauth/email/bind?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`)
}

export function sendPasswordReset(email: string): Promise<void> {
  return backendAction(`/api/reset_password?email=${encodeURIComponent(email)}`)
}

export function resetPassword(email: string, token: string, newPassword: string): Promise<void> {
  return backendAction('/api/user/reset', { email, token, new_password: newPassword })
}
