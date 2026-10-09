import type { AppSettings } from '../types'
import { getLoadedStorageUserId } from './storageScope'

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
  turnstileToken?: string
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

export interface GouoImageCharge {
  id: string
  model_name: string
  price_cny: number
  status: 'reserved' | 'dispatched' | 'needs_review' | 'settled' | 'refunded'
  created_at: number
  note: string
}

export function getImageCharges(page = 1) {
  return backendRequest<{ data: GouoImageCharge[] | null; total_count: number }>(`/api/gouo/image-charges?page=${page}&size=20`)
}

export interface GouoImageModel {
  id: string
  name: string
  price_cny: number
  price_version: string
  reference: boolean
  mask: boolean
  max_outputs: number
  quota: number
}

export class GouoPriceChangedError extends Error {
  constructor(public quote: GouoImageModel) {
    super('模型价格或能力已更新，请核对模型价格后重新提交')
  }
}

export class GouoRateLimitError extends Error {
  constructor(public retryAt: number) {
    super('请求过于频繁，请稍后重试')
  }
}

function checkRateLimit(response: Response) {
  if (response.status !== 429) return
  const value = response.headers.get('Retry-After')
  const seconds = value?.trim() ? Number(value) : NaN
  const date = value ? Date.parse(value) : NaN
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 180_000
  throw new GouoRateLimitError(Date.now() + Math.max(1000, delay))
}

export async function getImageModels(): Promise<GouoImageModel[]> {
  if (!backendToken) await createBackendSettings()
  let data: unknown
  try {
    data = await backendRequest<unknown>('/api/gouo/models', { headers: { 'X-Gouo-Token': backendToken } })
  } catch (err) {
    if (!isInvalidBackendTokenError(err)) throw err
    await createBackendSettings(true)
    data = await backendRequest<unknown>('/api/gouo/models', { headers: { 'X-Gouo-Token': backendToken } })
  }
  if (!Array.isArray(data) || data.some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.price_version !== 'string' || !Number.isFinite(entry.price_cny) || entry.price_cny <= 0 || typeof entry.reference !== 'boolean' || typeof entry.mask !== 'boolean' || !Number.isInteger(entry.max_outputs) || entry.max_outputs < 1)) {
    throw new Error('图片模型目录格式无效')
  }
  return data as GouoImageModel[]
}

export async function getImageModelQuote(id: string, inputCount: number, hasMask: boolean, n: number, version?: string): Promise<GouoImageModel> {
  const models = await getImageModels()
  const model = models.find((entry) => entry.id === id)
  if (!model) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('gouo-models-refresh'))
    throw new Error('所选模型已不可用，请重新选择模型')
  }
  if ((inputCount > 0 && !model.reference) || (hasMask && !model.mask)) throw new Error('此模型不支持当前编辑操作，请重新选择模型')
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('图片总数量必须为 1 到 10 的整数')
  if (!version || version !== model.price_version) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('gouo-models-refresh'))
    throw new GouoPriceChangedError(model)
  }
  return model
}

interface GouoUsageLogPage {
  data: GouoUsageLog[]
  page: number
  size: number
  total_count: number
}

export interface GouoBackendStatus {
  turnstile_check?: boolean
  turnstile_site_key?: string
  email_service?: boolean
  email_verification?: boolean
  gouo_cloud_library?: boolean
  gouo_redemption_help?: string
  gouo_support_contact?: string
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

export interface GouoCloudTaskMeta {
  prompt?: string
  params?: Record<string, unknown>
  result_meta?: Record<string, unknown>
  client_created_at?: number
  client_image_ids?: Partial<Record<GouoCloudTaskAsset['role'], string[]>>
  collection_ids?: string[]
}

const configuredBaseUrl = (import.meta.env.VITE_GOUO_BACKEND_URL ?? '').trim().replace(/\/+$/, '')
let backendToken = ''

export function isBackendAuthEnabled(): boolean {
  return import.meta.env.VITE_GOUO_BACKEND_ENABLED === 'true'
}

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${configuredBaseUrl}${normalizedPath}`
}

// 告诉后端本页面加载的是哪个账号的本地数据；会话已在其他页面切换账号时，后端会拒绝请求。
function accountHeaders(): Record<string, string> {
  const userId = getLoadedStorageUserId()
  return userId ? { 'X-Gouo-User': userId } : {}
}

function requestInit(init?: RequestInit): RequestInit {
  return {
    ...init,
    cache: 'no-store',
    credentials: 'include',
    headers: {
      ...accountHeaders(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  }
}

async function parseEnvelope<T>(response: Response, requireData: boolean): Promise<T> {
  checkRateLimit(response)
  let payload: BackendEnvelope<T>
  try {
    payload = await response.json() as BackendEnvelope<T>
  } catch {
    throw new Error(`服务返回了无法识别的响应（HTTP ${response.status}）`)
  }

  if (response.status === 409 && (payload.data as { code?: string } | undefined)?.code === 'account_mismatch') {
    // 刷新后登录检查会切换到当前账号的本地空间
    backendToken = ''
    window.location.reload()
    throw new Error(payload.message || '当前登录账号已切换，请刷新页面')
  }
  if (response.status === 409) throw new GouoConflictError(payload.message || '云端版本冲突', payload.data)
  if (!response.ok || !payload.success || (requireData && payload.data === undefined)) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

export async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
  await backendAction(`/api/user/register${input.turnstileToken ? `?turnstile=${encodeURIComponent(input.turnstileToken)}` : ''}`, {
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
  const sameOriginBaseUrl = typeof window === 'undefined' ? '/v1' : `${window.location.origin}/v1`
  return {
    baseUrl: configuredBaseUrl ? `${configuredBaseUrl}/v1` : sameOriginBaseUrl,
    apiKey: backendToken,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    streamImages: false,
  }
}

export function getDefaultBackendModel(): string {
  return import.meta.env.VITE_GOUO_IMAGE_MODEL?.trim() || 'gpt-image-2'
}

export function isInvalidBackendTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /无效的令牌|令牌无效|invalid.{0,8}token|token.{0,8}(invalid|expired)|HTTP 401/i.test(message)
}

export function getCloudStorage(): Promise<GouoCloudStorage> {
  return backendRequest<GouoCloudStorage>('/api/gouo/storage')
}

export async function uploadCloudAsset(file: Blob, clientImageId: string, sha256: string): Promise<GouoCloudAsset> {
  const form = new FormData()
  form.append('file', file, `${clientImageId}.${file.type.split('/')[1] || 'png'}`)
  form.append('client_image_id', clientImageId)
  form.append('sha256', sha256)
  const response = await fetch(apiUrl('/api/gouo/assets'), { method: 'POST', credentials: 'include', headers: accountHeaders(), body: form })
  return parseEnvelope<GouoCloudAsset>(response, true)
}

export function putCloudTask(clientTaskId: string, task: Record<string, unknown>): Promise<GouoCloudTask> {
  return backendRequest<GouoCloudTask>(`/api/gouo/tasks/${encodeURIComponent(clientTaskId)}`, {
    method: 'PUT',
    body: JSON.stringify(task),
  })
}

export function listCloudTasks(hidden: boolean, cursor = ''): Promise<{ data: GouoCloudTask[]; next_cursor: string }> {
  const params = new URLSearchParams({ limit: '100' })
  if (hidden) params.set('hidden', 'true')
  if (cursor) params.set('cursor', cursor)
  return backendRequest(`/api/gouo/tasks?${params}`)
}

export function patchCloudTaskMeta(clientTaskId: string, meta: GouoCloudTaskMeta): Promise<GouoCloudTask> {
  return backendRequest<GouoCloudTask>(`/api/gouo/tasks/${encodeURIComponent(clientTaskId)}/meta`, {
    method: 'PATCH',
    body: JSON.stringify(meta),
  })
}

export function listCloudCollections(): Promise<GouoCloudCollection[]> {
  return backendRequest<GouoCloudCollection[]>('/api/gouo/collections?hidden=true')
}

export function setCloudFavorite(collectionId: string, clientTaskId: string, add: boolean): Promise<void> {
  return backendAction(`/api/gouo/collections/${encodeURIComponent(collectionId)}/tasks/${encodeURIComponent(clientTaskId)}`, undefined, add ? 'PUT' : 'DELETE')
}

export function putCloudCollection(id: string, name: string): Promise<GouoCloudCollection> {
  return backendRequest<GouoCloudCollection>(`/api/gouo/collections/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
}

export function hideCloudCollection(id: string): Promise<void> {
  return backendAction(`/api/gouo/collections/${encodeURIComponent(id)}/hide`, {})
}

export async function fetchCloudAssetContent(asset: GouoCloudAsset): Promise<Blob> {
  // 素材内容按哈希寻址，允许浏览器缓存，换设备浏览作品时不会重复下载。
  const response = await fetch(apiUrl(asset.content_url), { credentials: 'include', headers: accountHeaders() })
  checkRateLimit(response)
  if (response.status === 409) await parseEnvelope<void>(response, false)
  if (!response.ok) throw new Error(`下载云端图片失败（HTTP ${response.status}）`)
  return response.blob()
}

export function setCloudTaskHidden(id: string, hidden: boolean): Promise<void> {
  return backendAction(`/api/gouo/tasks/${encodeURIComponent(id)}/${hidden ? 'hide' : 'restore'}`, {})
}

export function updatePassword(currentPassword: string, newPassword: string): Promise<void> {
  return backendAction('/api/user/password', { current_password: currentPassword, new_password: newPassword }, 'PUT')
}

export function sendEmailVerification(email: string, turnstileToken?: string): Promise<void> {
  return backendAction(`/api/verification?email=${encodeURIComponent(email)}${turnstileToken ? `&turnstile=${encodeURIComponent(turnstileToken)}` : ''}`)
}

export function bindEmail(email: string, code: string): Promise<void> {
  return backendAction(`/api/oauth/email/bind?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`)
}

export function sendPasswordReset(email: string, turnstileToken?: string): Promise<void> {
  return backendAction(`/api/reset_password?email=${encodeURIComponent(email)}${turnstileToken ? `&turnstile=${encodeURIComponent(turnstileToken)}` : ''}`)
}

export function resetPassword(email: string, token: string, newPassword: string): Promise<void> {
  return backendAction('/api/user/reset', { email, token, new_password: newPassword })
}

export class GouoConflictError extends Error {
  constructor(message: string, public current: unknown) { super(message) }
}
