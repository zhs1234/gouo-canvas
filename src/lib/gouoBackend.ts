import type { TaskParams } from '../types'
import { SERVER_MESSAGES } from './serverMessages'
import { getLoadedStorageUserId } from './storageScope'
import { getSizeTier, type SizeTier } from './size'

interface BackendEnvelope<T> {
  success: boolean
  message?: string
  // New API 的提示是英文 message_key，按语言包换成中文
  message_key?: string
  message_params?: Record<string, unknown>
  code?: string
  data?: T
}

interface AuthBundle {
  access_token: string
  access_expires_at: number
  user: GouoUser
  // 账号开启了两步验证等登录验证时，登录接口返回待验证的流程而不是会话
  require_verification?: boolean
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

interface RegisterInput {
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


export interface GouoImageModel {
  billing_mode?: 'ratio' | 'tiered_expr' | 'per_request'
  id: string
  name: string
  price_cny: number
  price_version: string
  reference: boolean
  mask: boolean
  max_outputs: number
  quota: number
  // 后台设置的默认模型（未设置或不可用时为目录第一个）
  default?: boolean
  // 后台填写的一句话说明；name 是后台设置的显示名称，未设置时为模型 ID
  description?: string
  // 后台开放的分辨率档位（缺省表示只能用自动尺寸）、可选画质和最多参考图张数（缺省表示不限）；服务端同样校验
  sizes?: SizeTier[]
  qualities?: string[]
  max_inputs?: number
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
  const data = await backendRequest<unknown>('/api/gouo/models')
  if (!Array.isArray(data) || data.some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.price_version !== 'string' || !Number.isFinite(entry.price_cny) || entry.price_cny < 0 || (entry.billing_mode !== undefined && !['ratio', 'tiered_expr', 'per_request'].includes(entry.billing_mode)) || typeof entry.reference !== 'boolean' || typeof entry.mask !== 'boolean' || !Number.isInteger(entry.max_outputs) || entry.max_outputs < 1)) {
    throw new Error('图片模型目录格式无效')
  }
  cachedImageModels = data as GouoImageModel[]
  imageModelListeners.forEach((listener) => listener())
  return cachedImageModels
}

// 最近一次读取的模型目录，供输入栏按所选模型限定尺寸、画质和参考图张数
let cachedImageModels: GouoImageModel[] = []
const imageModelListeners = new Set<() => void>()

export function getCachedImageModels() {
  return cachedImageModels
}

export function subscribeImageModels(listener: () => void) {
  imageModelListeners.add(listener)
  return () => { imageModelListeners.delete(listener) }
}

export function isLowModerationAllowed() {
  return cachedStatus?.gouo_allow_low_moderation === true
}

// 与服务端的参数校验一致：尺寸、画质和参考图张数不能超出后台为模型限定的范围。
export function getImageParamIssue(model: GouoImageModel, params: Pick<TaskParams, 'size' | 'quality' | 'moderation'>, inputCount: number) {
  if (params.size !== 'auto' && !model.sizes?.includes(getSizeTier(params.size)!)) return '此模型不支持该分辨率，请选择自动尺寸或已开放的分辨率'
  if (model.qualities?.length && (params.quality === 'auto' ? !model.qualities.includes('high') : !model.qualities.includes(params.quality))) {
    return params.quality === 'auto' ? '此模型不开放自动画质，请选择具体画质' : '此模型不开放所选画质，请重新选择'
  }
  if (params.moderation === 'low' && !isLowModerationAllowed()) return '运营方未开放宽松审核'
  if (model.max_inputs && inputCount > model.max_inputs) return `此模型最多使用 ${model.max_inputs} 张参考图`
  return ''
}

// 用户没有手动选过模型、或选的模型已不在目录里时，使用后台标出的默认模型，管理员改默认模型后对这些用户生效
export function resolveBackendModel(models: GouoImageModel[], current: string, userSelected: boolean) {
  const selected = models.find((entry) => entry.id === current)
  if (selected && userSelected) return selected
  return models.find((entry) => entry.default) ?? selected ?? models[0]
}

export async function getImageModelQuote(id: string, inputCount: number, hasMask: boolean, n: number, version?: string, params?: Pick<TaskParams, 'size' | 'quality' | 'moderation'>): Promise<GouoImageModel> {
  const models = await getImageModels()
  const model = models.find((entry) => entry.id === id)
  if (!model) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('gouo-models-refresh'))
    throw new Error('所选模型已不可用，请重新选择模型')
  }
  if ((inputCount > 0 && !model.reference) || (hasMask && !model.mask)) throw new Error('此模型不支持当前编辑操作，请重新选择模型')
  if (!Number.isInteger(n) || n < 1 || n > getMaxTaskImages()) throw new Error(`图片总数量必须为 1 到 ${getMaxTaskImages()} 的整数`)
  const issue = params ? getImageParamIssue(model, params, inputCount) : ''
  if (issue) throw new Error(issue)
  if (!version || version !== model.price_version) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('gouo-models-refresh'))
    throw new GouoPriceChangedError(model)
  }
  return model
}

interface GouoUsageLogPage {
  data: GouoUsageLog[]
  total_count: number
}

interface GouoBackendStatus {
  turnstile_check?: boolean
  turnstile_site_key?: string
  email_service?: boolean
  email_verification?: boolean
  gouo_cloud_library?: boolean
  gouo_redemption_help?: string
  gouo_support_contact?: string
  gouo_notice?: string
  register_enabled?: boolean
  password_login_enabled?: boolean
  password_login_encryption_enabled?: boolean
  quota_per_unit?: number
  usd_exchange_rate?: number
  gouo_canvas_enabled?: boolean
  gouo_agent_enabled?: boolean
  gouo_max_images?: number
  gouo_trash_retention_days?: number
  gouo_max_upload_bytes?: number
  gouo_allow_low_moderation?: boolean
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

interface GouoCloudCollection {
  id: string
  name: string
  created_at: number
  updated_at: number
  hidden_at?: number
}

interface GouoCloudTaskMeta {
  prompt?: string
  params?: Record<string, unknown>
  result_meta?: Record<string, unknown>
  client_created_at?: number
  client_image_ids?: Partial<Record<GouoCloudTaskAsset['role'], string[]>>
  client_image_positions?: Partial<Record<GouoCloudTaskAsset['role'], number[]>>
  collection_ids?: string[]
}


const configuredBaseUrl = (import.meta.env.VITE_GOUO_BACKEND_URL ?? '').trim().replace(/\/+$/, '')
let backendToken = ''

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${configuredBaseUrl}${normalizedPath}`
}

// 登录会话：access token 只放内存（约 15 分钟有效），快过期时用 HttpOnly 的刷新 cookie 换新。
// 刷新 cookie 各标签页共用，其他页面换了账号时这里会拿到另一个账号，刷新页面切到对应的本地空间
let accessToken = ''
let accessExpiresAt = 0
let refreshing: Promise<void> | null = null

function acceptAuth(bundle: AuthBundle) {
  if (bundle.require_verification) throw new Error('此账号开启了登录二次验证，光构客户端暂不支持，请先在后台面板关闭后再登录')
  accessToken = bundle.access_token
  accessExpiresAt = bundle.access_expires_at
  const loaded = getLoadedStorageUserId()
  if (loaded && loaded !== String(bundle.user.id)) {
    window.location.reload()
    throw new Error('当前登录账号已在其他页面切换，请刷新页面')
  }
}

// 测试用：直接放入一个有效会话，免去刷新请求
export function setBackendSessionForTests() {
  accessToken = 'test-access-token'
  accessExpiresAt = Date.now() / 1000 + 3600
}

function ensureAccessToken(): Promise<void> {
  if (accessToken && accessExpiresAt * 1000 - Date.now() > 60_000) return Promise.resolve()
  refreshing ??= (async () => {
    const response = await fetch(apiUrl('/api/user/auth/refresh'), { method: 'POST', cache: 'no-store', credentials: 'include' })
    if (response.status === 401) {
      accessToken = ''
      throw new Error('未登录或登录已过期，请重新登录')
    }
    acceptAuth(await parseEnvelope<AuthBundle>(response, true))
  })().finally(() => { refreshing = null })
  return refreshing
}

function requestInit(init?: RequestInit): RequestInit {
  return {
    ...init,
    cache: 'no-store',
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  }
}

// 需要登录的请求先确保 access token 有效；服务端判定失效（如被其他设备撤销）时换新一次再重试
export async function backendFetch(path: string, init?: RequestInit, auth = true): Promise<Response> {
  try {
    if (auth) await ensureAccessToken()
    const response = await fetch(apiUrl(path), requestInit(init))
    if (!auth || response.status !== 401) return response
    accessToken = ''
    await ensureAccessToken()
    return await fetch(apiUrl(path), requestInit(init))
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接光构服务，请检查后端地址或稍后重试')
    throw error
  }
}

function serverMessage(payload: BackendEnvelope<unknown>) {
  const template = payload.message_key ? SERVER_MESSAGES[payload.message_key] : undefined
  if (!template) return payload.message
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(payload.message_params?.[name] ?? ''))
}

async function parseEnvelope<T>(response: Response, requireData: boolean): Promise<T> {
  checkRateLimit(response)
  let payload: BackendEnvelope<T>
  try {
    payload = await response.json() as BackendEnvelope<T>
  } catch {
    throw new Error(`服务返回了无法识别的响应（HTTP ${response.status}）`)
  }

  const message = serverMessage(payload)
  if (response.status === 409) throw new GouoConflictError(message || '云端版本冲突', payload.data)
  if (payload.code === 'asset_not_owned') throw new GouoAssetMissingError(message || '云端图片已不存在')
  if (!response.ok || !payload.success || (requireData && payload.data === undefined)) {
    throw new Error(message || `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

export async function backendRequest<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  return parseEnvelope<T>(await backendFetch(path, init, auth), true)
}

async function backendAction(path: string, body?: Record<string, unknown>, method = body ? 'POST' : 'GET', auth = true, headers?: Record<string, string>): Promise<void> {
  const response = await backendFetch(path, { method, body: body ? JSON.stringify(body) : undefined, headers }, auth)
  await parseEnvelope<void>(response, false)
}

// 余额和消费按支付汇率从额度换算成人民币，与服务端图片定价使用同一汇率
export async function getCurrentUser(): Promise<GouoUser> {
  const [user] = await Promise.all([backendRequest<GouoUser>('/api/user/self'), refreshBackendStatus()])
  const perUnit = cachedStatus?.quota_per_unit
  const usdRate = cachedStatus?.usd_exchange_rate
  if (!perUnit || !usdRate || !(perUnit > 0) || !(usdRate > 0)) return user
  const rate = usdRate / perUnit
  return { ...user, quota_cny_rate: rate, balance_cny: (user.quota ?? 0) * rate, used_cny: (user.used_quota ?? 0) * rate }
}

export function getBackendStatus(): Promise<GouoBackendStatus> {
  return backendRequest<GouoBackendStatus>('/api/status', undefined, false)
}

// 后台下发的客户端设置。各处共用一次请求；切回页面时最多每分钟刷新一次，管理员修改后用户无需刷新页面
const STATUS_REFRESH_MS = 60_000
let cachedStatus: GouoBackendStatus | null = null
let statusLoadedAt = 0
let statusPending: Promise<void> | null = null
const statusListeners = new Set<(status: GouoBackendStatus) => void>()

export function refreshBackendStatus(): Promise<void> {
  if (statusPending) return statusPending
  if (Date.now() - statusLoadedAt < STATUS_REFRESH_MS) return Promise.resolve()
  statusPending = getBackendStatus()
    .then((status) => {
      cachedStatus = status
      statusLoadedAt = Date.now()
      statusListeners.forEach((listener) => listener(status))
    })
    .catch((err) => console.warn('读取后台设置失败', err))
    .finally(() => { statusPending = null })
  return statusPending
}

export function getCachedBackendStatus() {
  return cachedStatus
}

export function subscribeBackendStatus(listener: (status: GouoBackendStatus) => void) {
  statusListeners.add(listener)
  return () => { statusListeners.delete(listener) }
}

// 回收站保留期由后台设置；未取到后台设置时返回 null，调用方不做本地清理，避免误删服务端仍可恢复的内容
export function getLoadedTrashRetentionMs() {
  const days = cachedStatus?.gouo_trash_retention_days
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 30 ? days * 24 * 60 * 60 * 1000 : null
}

// 单个上传文件的上限由后台设置，未加载时按默认 25 MB
export function getMaxUploadBytes() {
  const bytes = cachedStatus?.gouo_max_upload_bytes
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 1024 * 1024 ? bytes : 25 * 1024 * 1024
}

// 界面提示用的保留天数，未加载时按默认 3 天
export function getTrashRetentionDays() {
  const ms = getLoadedTrashRetentionMs()
  return ms ? ms / (24 * 60 * 60 * 1000) : 3
}

// 后台限制的一次最多生成张数；未加载或数值无效时按上限 10
export function getMaxTaskImages() {
  const n = cachedStatus?.gouo_max_images
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10 ? n : 10
}

export async function login(username: string, password: string, turnstileToken?: string): Promise<GouoUser> {
  if (cachedStatus?.password_login_encryption_enabled) throw new Error('后台开启了登录密码加密，光构客户端暂不支持，请联系管理员')
  const bundle = await backendRequest<AuthBundle>(`/api/user/login${turnstileToken ? `?turnstile=${encodeURIComponent(turnstileToken)}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }, false)
  acceptAuth(bundle)
  return bundle.user
}

export async function logout(): Promise<void> {
  backendToken = ''
  try {
    await backendAction('/api/user/auth/logout', {}, 'POST', false)
  } finally {
    accessToken = ''
  }
}

export async function updateCurrentUser(displayName: string): Promise<void> {
  await backendAction('/api/user/self', { display_name: displayName.trim() }, 'PUT')
}

// 改密码、换邮箱等敏感操作要先用当前密码换一次性证明
async function verifyPassword(password: string, scope: string, context?: Record<string, unknown>): Promise<string> {
  const proof = await backendRequest<{ proof_token: string }>('/api/verify', { method: 'POST', body: JSON.stringify({ method: 'password', scope, password, context }) })
  return proof.proof_token
}

export function redeemCode(key: string): Promise<number> {
  return backendRequest<number>('/api/user/topup', {
    method: 'POST',
    body: JSON.stringify({ key: key.trim() }),
  })
}

interface NewApiLog {
  created_at: number
  type: number
  content?: string
  model_name?: string
  quota?: number
  use_time?: number
  request_id?: string
  other?: string
}

// New API 的日志把计费明细放在 other（JSON 字符串），耗时单位是秒；转换成客户端原有的字段
export async function getUsageLogs(page = 1, size = 20, filters?: { model?: string; type?: number; start?: number; end?: number }): Promise<GouoUsageLogPage> {
  const params = new URLSearchParams({ p: String(page), page_size: String(size) })
  if (filters?.model) params.set('model_name', filters.model)
  if (filters?.type) params.set('type', String(filters.type))
  if (filters?.start) params.set('start_timestamp', String(filters.start))
  if (filters?.end) params.set('end_timestamp', String(filters.end))
  const result = await backendRequest<{ items: NewApiLog[] | null; total: number }>(`/api/log/self?${params}`)
  const data = (result.items ?? []).map((log): GouoUsageLog => {
    let metadata: Record<string, unknown> = {}
    try {
      metadata = log.other ? JSON.parse(log.other) as Record<string, unknown> : {}
    } catch {
      metadata = {}
    }
    return { created_at: log.created_at, type: log.type, content: log.content, model_name: log.model_name, quota: log.quota,
      request_time: log.use_time ? log.use_time * 1000 : undefined, metadata: { ...metadata, request_id: metadata.gouo_charge_id ?? log.request_id } }
  })
  return { data, total_count: result.total }
}

export async function register(input: RegisterInput): Promise<void> {
  await backendAction(`/api/user/register${input.turnstileToken ? `?turnstile=${encodeURIComponent(input.turnstileToken)}` : ''}`, {
    username: input.username.trim(),
    password: input.password,
    email: input.email?.trim() || '',
    verification_code: input.verificationCode?.trim() || '',
  }, 'POST', false)
}

export function getPlaygroundToken(): Promise<string> {
  return backendRequest<string>('/api/gouo/token')
}

export async function createBackendSettings(forceRefresh = false) {
  if (!backendToken || forceRefresh) backendToken = await getPlaygroundToken()
  const sameOriginBaseUrl = typeof window === 'undefined' ? '/v1' : `${window.location.origin}/v1`
  return { baseUrl: configuredBaseUrl ? `${configuredBaseUrl}/v1` : sameOriginBaseUrl, apiKey: backendToken }
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
  return backendRequest<GouoCloudAsset>('/api/gouo/assets', { method: 'POST', body: form })
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
  const response = await backendFetch(asset.content_url, { cache: 'default' }, true)
  checkRateLimit(response)
  if (response.status === 409) await parseEnvelope<void>(response, false)
  if (!response.ok) throw new Error(`下载云端图片失败（HTTP ${response.status}）`)
  return response.blob()
}

export function setCloudTaskHidden(id: string, hidden: boolean): Promise<void> {
  return backendAction(`/api/gouo/tasks/${encodeURIComponent(id)}/${hidden ? 'hide' : 'restore'}`, {})
}

// 改密码会轮换当前会话，用返回的新 access token 继续
export async function updatePassword(currentPassword: string, newPassword: string): Promise<void> {
  const proof = await verifyPassword(currentPassword, 'account.password.change')
  const bundle = await backendRequest<Omit<AuthBundle, 'user'>>('/api/user/self', {
    method: 'PUT',
    body: JSON.stringify({ password: newPassword, original_password: currentPassword }),
    headers: { 'X-Security-Proof': proof },
  })
  accessToken = bundle.access_token
  accessExpiresAt = bundle.access_expires_at
}

export function sendEmailVerification(email: string, turnstileToken?: string): Promise<void> {
  return backendAction(`/api/verification?email=${encodeURIComponent(email)}${turnstileToken ? `&turnstile=${encodeURIComponent(turnstileToken)}` : ''}`, undefined, 'GET', false)
}

export interface EmailBindFlow {
  flow_token: string
  // 已绑定旧邮箱时，旧邮箱也会收到验证码
  old_email_required: boolean
}

// 绑定或更换邮箱：先用当前密码验证身份，再向新邮箱（和旧邮箱）发送验证码
export async function startEmailBind(email: string, password: string): Promise<EmailBindFlow> {
  const proof = await verifyPassword(password, 'account.binding.bind', { provider: 'email', email })
  return backendRequest<EmailBindFlow>('/api/oauth/email/bind/start', { method: 'POST', body: JSON.stringify({ email }), headers: { 'X-Security-Proof': proof } })
}

export function resendEmailBind(flowToken: string): Promise<Partial<EmailBindFlow>> {
  return backendRequest<Partial<EmailBindFlow>>('/api/oauth/email/bind/resend', { method: 'POST', body: JSON.stringify({ flow_token: flowToken }) })
}

export function bindEmail(flowToken: string, newCode: string, oldCode = ''): Promise<void> {
  return backendAction('/api/oauth/email/bind', { flow_token: flowToken, new_code: newCode, old_code: oldCode })
}

export function sendPasswordReset(email: string, turnstileToken?: string): Promise<void> {
  return backendAction(`/api/reset_password?email=${encodeURIComponent(email)}${turnstileToken ? `&turnstile=${encodeURIComponent(turnstileToken)}` : ''}`, undefined, 'GET', false)
}

// 服务端重置为随机密码并返回，用户登录后再自行修改
export function resetPassword(email: string, token: string): Promise<string> {
  return backendRequest<string>('/api/user/reset', { method: 'POST', body: JSON.stringify({ email, token }) }, false)
}

// 本地记录的云端图片已被服务端清除（如回收站过期），需要重新上传
export class GouoAssetMissingError extends Error {}

export class GouoConflictError extends Error {
  constructor(message: string, public current: unknown) { super(message) }
}
