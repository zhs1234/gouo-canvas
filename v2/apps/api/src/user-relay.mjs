import { StudioError } from './images-error.mjs'

// New API owns this token, its permissions and all quota. Nothing is stored
// in Studio, returned to the browser or charged to a shared administrator.
const tokenName = 'gouo-studio'
async function native(config, authorization, path, fetcher, body) {
  let response
  try {
    response = await fetcher(new URL(path, config.authOrigin), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: authorization, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
  } catch { throw new StudioError('账户生成令牌操作结果待确认，请在原生令牌页面核对；未自动重试', 502) }
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.success !== true) throw new StudioError('无法读取或配置本账号生成权限，请检查原生账户与令牌设置', response.status === 401 ? 401 : 403)
  return result.data
}

export async function userModels(config, authorization, account, fetcher) {
  if (account.status !== 1) throw new StudioError('账号已禁用，请联系管理员', 403)
  if (typeof account.group !== 'string' || !account.group || account.group === 'auto') throw new StudioError('账号分组无效，请联系管理员', 403)
  const models = await native(config, authorization, '/api/user/models?group=' + encodeURIComponent(account.group), fetcher)
  if (!Array.isArray(models) || models.some(id => typeof id !== 'string')) throw new StudioError('账号模型权限数据无效', 502)
  return { ...config, models: config.models.map(model => ({ ...model, enabled: model.enabled && models.includes(model.upstreamModelId), ...(!models.includes(model.upstreamModelId) && model.enabled ? { availabilityReason: '当前账号分组没有此模型权限，请联系管理员' } : {}) })) }
}

export async function userRelay(config, authorization, account, fetcher) {
  if (!Number.isSafeInteger(account.quota) || account.quota <= 0) throw new StudioError('账号余额不足，请在原生钱包查看额度或联系管理员', 402)
  const allowed = config.models.filter(model => model.enabled && model.verification === 'live-verified' && model.kind !== 'video').map(model => model.upstreamModelId)
  if (!allowed.length) throw new StudioError('当前账号分组没有可用模型，请联系管理员', 403)
  const find = async () => {
    const data = await native(config, authorization, '/api/token/search?keyword=' + tokenName + '&p=1&page_size=100', fetcher)
    if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total > 100) throw new StudioError('账户令牌列表无法完整核验，请在原生令牌页面检查', 503)
    const rows = data.items.filter(row => row.name === tokenName)
    if (rows.length > 1) throw new StudioError('发现重复的 Studio 令牌，请在原生令牌页面核对，未自动修改', 409)
    return rows[0]
  }
  let token = await find()
  if (!token) {
    // Explicit operator opt-in supplies this cap/lifetime; it grants no funds.
    // A failed/ambiguous creation is never automatically repeated.
    await native(config, authorization, '/api/token/', fetcher, {
      name: tokenName, remain_quota: Math.min(account.quota, config.userTokenQuotaCap), unlimited_quota: false,
      expired_time: Math.floor(Date.now() / 1000) + config.userTokenLifetimeSeconds,
      model_limits_enabled: true, model_limits: [...new Set(allowed)].join(','), group: '', cross_group_retry: false,
    })
    token = await find()
  }
  const limits = typeof token?.model_limits === 'string' ? token.model_limits.split(',').filter(Boolean) : []
  if (!token || token.user_id !== account.id || !Number.isSafeInteger(token.id) || token.id <= 0 || token.status !== 1
    || token.unlimited_quota !== false || !Number.isSafeInteger(token.remain_quota) || token.remain_quota <= 0
    || token.remain_quota > config.userTokenQuotaCap || !Number.isSafeInteger(token.expired_time)
    || token.expired_time <= Date.now() / 1000 || token.expired_time > Date.now() / 1000 + config.userTokenLifetimeSeconds + 5 || token.model_limits_enabled !== true || !limits.length
    || limits.some(id => !allowed.includes(id)) || allowed.some(id => !limits.includes(id)) || token.group !== '' || token.cross_group_retry !== false) {
    throw new StudioError('Studio 令牌已停用、过期、额度不足或权限变化，请在原生令牌页面核对；未自动续额或放宽权限', 403)
  }
  const data = await native(config, authorization, `/api/token/${token.id}/key`, fetcher, {})
  if (typeof data?.key !== 'string' || !/^(?:sk-)?[A-Za-z0-9]{48}$/.test(data.key)) throw new StudioError('生成令牌格式无效', 502)
  return { ...config, relayKey: data.key, relayOwnerId: account.id,
    models: config.models.map(model => ({ ...model, enabled: model.enabled && limits.includes(model.upstreamModelId) })) }
}
