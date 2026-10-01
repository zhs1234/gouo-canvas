import { StudioError } from './images-error.mjs'

const baseName = 'gouo-studio'
const fail = (message, unknown = false) => Object.assign(new StudioError(message, unknown ? 502 : 409), { unknown })
function models(config) {
  return [...new Set(config.models.filter(m => m.enabled && m.verification === 'live-verified' && m.kind !== 'video').map(m => m.upstreamModelId))].sort()
}
async function call(config, auth, path, fetcher, method = 'GET', body) {
  let response, result
  try {
    response = await fetcher(new URL(path, config.authOrigin), { method, headers: { Authorization: auth,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(10000) })
    result = await response.json()
  } catch { throw fail('令牌操作结果待确认；未自动重试', method !== 'GET') }
  if (!response.ok || result?.success !== true) throw fail('原生令牌操作未获明确成功', method !== 'GET')
  const date = response.headers?.get('date')
  const milliseconds = date ? Date.parse(date) : NaN
  return { data: result.data, nativeNow: Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined }
}
function compatible(config, account, token) {
  const allowed = models(config)
  const limits = typeof token.model_limits === 'string' ? token.model_limits.split(',').filter(Boolean).sort() : []
  return account.status === 1 && token.user_id === account.id && Number.isSafeInteger(token.id) && token.id > 0
    && token.unlimited_quota === false && Number.isSafeInteger(token.remain_quota)
    && token.remain_quota <= config.userTokenQuotaCap && Number.isSafeInteger(token.expired_time) && token.expired_time > 0
    && token.model_limits_enabled === true && allowed.length > 0 && JSON.stringify(limits) === JSON.stringify(allowed)
    && token.group === '' && token.cross_group_retry === false && (token.allow_ips === null || token.allow_ips === '')
    && (token.auto_groups === null || (Array.isArray(token.auto_groups) && token.auto_groups.length === 0))
}

// Masked metadata only. Native Date controls expiry proof; caller wall clock does not.
export async function readStudioToken(config, auth, account, fetcher, binding = { name: baseName }) {
  if (typeof binding.name !== 'string' || !binding.name || binding.name.length > 50) throw fail('令牌绑定名称无效')
  const searched = await call(config, auth, '/api/token/search?keyword=' + encodeURIComponent(binding.name) + '&p=1&page_size=100', fetcher)
  const data = searched.data
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 100 || data.items.length !== data.total) throw fail('令牌列表无法完整核验')
  const rows = data.items.filter(row => row.name === binding.name)
  if (rows.length > 1) throw fail('存在重复令牌，未自动修改')
  if (!rows.length) return { state: 'missing' }
  if (!Number.isSafeInteger(rows[0].id) || rows[0].id <= 0 || (binding.id !== undefined && rows[0].id !== binding.id)) throw fail('令牌绑定已变化')
  const exact = await call(config, auth, `/api/token/${rows[0].id}`, fetcher)
  const token = exact.data
  if (!token || token.id !== rows[0].id || token.name !== binding.name) throw fail('令牌读取证据不一致')
  // Do not return even a masked key from the helper DTO.
  const metadata = Object.fromEntries(['id', 'user_id', 'name', 'status', 'remain_quota', 'used_quota',
    'expired_time', 'created_time', 'accessed_time', 'unlimited_quota', 'model_limits_enabled', 'model_limits',
    'allow_ips', 'group', 'cross_group_retry', 'auto_groups'].filter(field => Object.hasOwn(token, field)).map(field => [field, token[field]]))
  const nativeNow = exact.nativeNow
  let state = 'incompatible'
  if (compatible(config, account, token)) {
    if (token.status === 2) state = 'disabled'
    else if (![1, 3, 4].includes(token.status)) state = 'incompatible'
    else if (nativeNow === undefined) state = 'incompatible'
    else if ((token.status === 3 && token.expired_time >= nativeNow) || (token.status === 4 && token.remain_quota > 0)) state = 'incompatible'
    else if (token.expired_time < nativeNow || token.status === 3) state = 'expired'
    else if (token.status === 4 || token.remain_quota <= 0) state = 'exhausted'
    else if (token.expired_time > nativeNow + config.userTokenLifetimeSeconds + 5) state = 'incompatible'
    else state = 'ready'
  }
  return { state, token: metadata, nativeNow }
}

// Caller must hold durable renewal intent and owner exclusion before this proof.
export async function proveRetired(config, auth, account, fetcher, inspection) {
  if (!inspection?.token) throw fail('没有可替换的令牌')
  const binding = { id: inspection.token.id, name: inspection.token.name }
  let current = await readStudioToken(config, auth, account, fetcher, binding)
  if (['disabled', 'incompatible', 'missing'].includes(current.state)) throw fail('令牌停用或权限变化，不能续用')
  if (current.token.expired_time < current.nativeNow || (current.token.status === 4 && current.token.remain_quota <= 0)) return current
  if (current.token.status !== 1 || current.token.remain_quota > 0) throw fail('旧令牌尚未获得永久失效证据')
  const key = (await call(config, auth, `/api/token/${binding.id}/key`, fetcher, 'POST', {})).data?.key
  if (typeof key !== 'string' || !/^(?:sk-)?[A-Za-z0-9]{48}$/.test(key)) throw fail('原生令牌证明格式无效', true)
  let response
  try {
    response = await fetcher(new URL('/v1/models', config.authOrigin), { headers: { Authorization: 'Bearer ' + key },
      redirect: 'error', signal: AbortSignal.timeout(10000) })
    await response.arrayBuffer()
  } catch { throw fail('旧令牌失效证明待确认', true) }
  if (response.status !== 401) throw fail('原生未明确拒绝旧令牌', true)
  try { current = await readStudioToken(config, auth, account, fetcher, binding) }
  catch { throw fail('旧令牌状态确认待确认', true) }
  if (current.token?.status !== 4 || current.token.remain_quota > 0 || current.state !== 'exhausted') throw fail('旧令牌未确认耗尽停用', true)
  return current
}

// A single POST. Unknown outcomes never trigger a search, retry or replacement.
export async function createReplacement(config, auth, account, fetcher, target) {
  if (!/^gouo-studio-[A-Za-z0-9_-]+$/.test(target?.name ?? '') || target.name.length > 50
    || !Number.isSafeInteger(target.quota) || target.quota <= 0 || target.quota > config.userTokenQuotaCap
    || !Number.isSafeInteger(target.expiredTime) || target.expiredTime <= 0 || account.status !== 1 || !models(config).length) throw fail('批准的有限令牌配置无效')
  await call(config, auth, '/api/token/', fetcher, 'POST', { name: target.name, remain_quota: target.quota,
    unlimited_quota: false, expired_time: target.expiredTime, model_limits_enabled: true,
    model_limits: models(config).join(','), allow_ips: '', group: '', cross_group_retry: false })
  let verified
  try { verified = await readStudioToken(config, auth, account, fetcher, { name: target.name }) }
  catch { throw fail('新令牌创建后的读取结果待确认', true) }
  if (verified.state !== 'ready' || verified.token.remain_quota !== target.quota || verified.token.expired_time !== target.expiredTime) throw fail('新令牌配置未严格确认', true)
  return { id: verified.token.id, name: verified.token.name }
}
