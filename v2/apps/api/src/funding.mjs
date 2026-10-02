import { StudioError } from './images-error.mjs'

const preferences = ['subscription_first', 'wallet_first', 'subscription_only', 'wallet_only']

async function native(config, authorization, path, fetcher, body) {
  let response
  try {
    response = await fetcher(new URL(path, config.authOrigin), {
      method: body === undefined ? 'GET' : 'PUT', redirect: 'error',
      headers: { Authorization: authorization, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    })
  } catch { throw new StudioError('原生资金操作结果待核对；未自动重试', 502) }
  if (!response.ok) throw new StudioError('原生资金服务拒绝请求或暂不可用；未自动重试', response.status === 401 ? 401 : response.status === 403 ? 403 : 502)
  let result
  try { result = await response.json() } catch { throw new StudioError('原生资金服务响应无效；未自动重试', 502) }
  if (!result || typeof result.success !== 'boolean') throw new StudioError('原生资金服务响应无效；未自动重试', 502)
  if (!result.success) throw new StudioError('原生资金操作被拒绝；未自动重试', 403)
  return result.data
}

export async function readFundingAccount(config, authorization, expectedOwner, fetcher = fetch) {
  if (!Number.isSafeInteger(expectedOwner) || expectedOwner <= 0) throw new StudioError('原生资金所属账号无效', 403)
  const account = await native(config, authorization, '/api/user/self', fetcher)
  if (!account || !Number.isSafeInteger(account.id) || account.id <= 0 || !Number.isSafeInteger(account.status)
      || typeof account.group !== 'string' || !account.group || account.group === 'auto' || !Number.isSafeInteger(account.quota)) throw new StudioError('原生资金账号数据无效', 502)
  if (account.id !== expectedOwner) throw new StudioError('原生资金不属于当前账号', 403)
  if (account.status !== 1) throw new StudioError('账号已禁用，不能使用原生资金', 403)
  return account
}

export async function readBillingPreference(config, authorization, fetcher = fetch) {
  const result = await native(config, authorization, '/api/subscription/self', fetcher)
  if (!preferences.includes(result?.billing_preference)) throw new StudioError('原生扣费偏好数据无效', 502)
  return result.billing_preference
}

export async function selectBillingPreference(config, authorization, preference, fetcher = fetch) {
  if (!['subscription_only', 'wallet_only'].includes(preference)) throw new StudioError('仅支持明确的原生单一资金来源', 403)
  const result = await native(config, authorization, '/api/subscription/self/preference', fetcher, { billing_preference: preference })
  if (result?.billing_preference !== preference) throw new StudioError('原生扣费偏好变更结果待核对；未自动重试', 502)
}
