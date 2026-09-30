import { StudioError } from './images.mjs'
import { isAvailable } from './config.mjs'

export async function accountJSON(config, authorization, path, fetcher = fetch) {
  let response
  try { response = await fetcher(new URL(path, config.authOrigin), {
    headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  }) } catch { throw new StudioError('计费服务暂不可用', 502) }
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true) throw new StudioError('无法读取计费信息', response.status === 401 ? 401 : 502)
  return body
}

export function moneySettings(status) {
  if (!Number.isSafeInteger(status.quota_per_unit) || status.quota_per_unit <= 0
    || !Number.isFinite(status.usd_exchange_rate) || status.usd_exchange_rate <= 0) throw new StudioError('网关额度或汇率配置无效', 502)
  return { currency: 'CNY', quotaPerUnit: status.quota_per_unit, usdExchangeRate: status.usd_exchange_rate }
}
export function quotaToMoney(quota, settings) {
  if (!Number.isSafeInteger(quota) || quota < 0) throw new StudioError('网关计费数据无效', 502)
  return quota / settings.quotaPerUnit * settings.usdExchangeRate
}

// Read recognized rates for presentation only. Settlement stays in New API;
// never evaluate or imitate arbitrary expressions from an operator's config.
export function priceCard(row, model, ratio) {
  const base = { id: model.id, displayName: model.displayName, kind: model.kind, groupRatio: ratio, currency: 'USD' }
  if (row.billing_mode === 'tiered_expr' && typeof row.billing_expr === 'string') {
    const expression = row.billing_expr.trim()
    if (!/^(?:len\s*<=\s*\d+\s*\?\s*)?tier\("[\w-]{1,40}",\s*[^()]+\)(?:\s*:\s*tier\("[\w-]{1,40}",\s*[^()]+\))?$/.test(expression)) return { ...base, mode: 'gateway-defined', tiers: [] }
    const tiers = []
    for (const match of row.billing_expr.matchAll(/tier\("([\w-]{1,40})",\s*([^()]+)\)/g)) {
      const rates = {}
      for (const part of match[2].split('+')) {
        const term = /^\s*(p|c|cr|cc|img|img_cr)\s*\*\s*(\d+(?:\.\d+)?)\s*$/.exec(part)
        if (!term || rates[term[1]] !== undefined || !Number.isFinite(Number(term[2]) * ratio)) return { ...base, mode: 'gateway-defined', tiers: [] }
        rates[term[1]] = Number(term[2]) * ratio
      }
      if (rates.p === undefined || rates.c === undefined) return { ...base, mode: 'gateway-defined', tiers: [] }
      tiers.push({ name: match[1], rates })
    }
    if (!tiers.length) return { ...base, mode: 'gateway-defined', tiers: [] }
    const threshold = /^len\s*<=\s*(\d+)/.exec(row.billing_expr)
    return { ...base, mode: 'tokens', unit: 'million_tokens', tiers, ...(threshold ? { longContextAfter: Number(threshold[1]) } : {}) }
  }
  if (row.quota_type === 1 && Number.isFinite(row.model_price) && row.model_price >= 0) return { ...base, mode: 'per-request', price: row.model_price * ratio, tiers: [] }
  if (Number.isFinite(row.model_ratio) && row.model_ratio >= 0 && Number.isFinite(row.completion_ratio) && row.completion_ratio >= 0) {
    const input = row.model_ratio * 2 * ratio
    return { ...base, mode: 'tokens', unit: 'million_tokens', tiers: [{ name: 'standard', rates: {
      p: input, c: input * row.completion_ratio,
      ...(Number.isFinite(row.cache_ratio) ? { cr: input * row.cache_ratio } : {}),
      ...(Number.isFinite(row.create_cache_ratio) ? { cc: input * row.create_cache_ratio } : {}),
    } }] }
  }
  return { ...base, mode: 'gateway-defined', tiers: [] }
}

export async function billingSummary(config, authorization, account, fetcher = fetch) {
  const [status, pricing, logs] = await Promise.all([
    accountJSON(config, authorization, '/api/status', fetcher),
    accountJSON(config, authorization, '/api/pricing', fetcher),
    accountJSON(config, authorization, '/api/log/self?type=2&p=1&page_size=10', fetcher),
  ])
  const settings = moneySettings(status.data)
  const ratio = pricing.group_ratio?.[account.group]
  if (!Number.isFinite(ratio) || ratio < 0) throw new StudioError('账号分组计费倍率无效', 502)
  const configured = config.models.filter(m => isAvailable(config, m))
  return { ...settings, balance: quotaToMoney(account.quota, settings), spent: quotaToMoney(account.used_quota, settings),
    requestCount: account.request_count, groupRatio: ratio,
    prices: configured.flatMap(m => { const row = pricing.data?.find(p => p.model_name === m.upstreamModelId); return row ? [priceCard(row, m, ratio)] : [] }),
    recentCalls: (logs.data?.items ?? []).filter(row => row.token_name !== '模型测试').slice(0, 10).map(row => ({
      id: row.id, model: row.model_name, createdAt: row.created_at, cost: quotaToMoney(row.quota, settings),
      inputTokens: row.prompt_tokens, outputTokens: row.completion_tokens,
    })),
  }
}

export async function settledUsage(config, authorization, requests, fetcher = fetch) {
  if (!requests.length) return undefined
  const requestIds = requests.map(r => r.requestId).filter(id => typeof id === 'string' && /^[\w-]{1,64}$/.test(id))
  const pending = { state: 'pending', requestCount: requests.length, requestIds, currency: 'CNY' }
  // Missing IDs or a failed call can have an unknown settlement. Show the
  // account's authoritative totals; do not invent a zero charge or retry it.
  if (requestIds.length !== requests.length || new Set(requestIds).size !== requestIds.length || requests.some(r => r.status < 200 || r.status >= 300)) return pending
  try {
    const [status, ...records] = await Promise.all([
      accountJSON(config, authorization, '/api/status', fetcher),
      ...requestIds.map(id => accountJSON(config, authorization, '/api/log/self?type=2&p=1&page_size=2&request_id=' + encodeURIComponent(id), fetcher)),
    ])
    const settings = moneySettings(status.data)
    const rows = records.map((record, i) => record.data?.items?.find(row => row.request_id === requestIds[i]))
    if (rows.some(row => !row || !Number.isSafeInteger(row.quota) || row.quota < 0)) return pending
    const quota = rows.reduce((sum, row) => sum + row.quota, 0)
    return { ...pending, state: 'settled', quota, cost: quotaToMoney(quota, settings) }
  } catch { return pending }
}
