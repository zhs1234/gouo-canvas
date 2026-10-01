import { z } from 'zod'
import { StudioError } from './images-error.mjs'
import { NEW_API_ROUTING_COMMIT } from './relay.mjs'

const quota = z.number().int().positive().max(2147483647)
export const trialPolicySchema = z.object({
  sourceCommit: z.literal(NEW_API_ROUTING_COMMIT), gatewayOrigin: z.string().url(),
  instanceId: z.string().uuid(), minUserId: quota, planId: quota,
  relayIngress: z.literal('studio-only'),
  operatorVerified: z.literal(true),
  plan: z.object({
    price_amount: z.literal(0), total_amount: quota,
    duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
    duration_value: z.number().int().positive().max(2147483647),
    custom_seconds: z.number().int().nonnegative().max(2147483647),
    quota_reset_period: z.literal('never'), max_purchase_per_user: z.literal(1),
    allow_balance_pay: z.literal(true), allow_wallet_overflow: z.literal(false),
    upgrade_group: z.literal(''), downgrade_group: z.literal(''),
  }).strict(),
}).strict().superRefine((policy, ctx) => {
  if ((policy.plan.duration_unit === 'custom') !== (policy.plan.custom_seconds > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '自定义期限必须明确批准正秒数，其余期限 custom_seconds 必须为零' })
  }
})

async function native(config, authorization, path, fetcher, body, method = body === undefined ? 'GET' : 'POST') {
  let response, result
  try {
    response = await fetcher(new URL(path, config.authOrigin), {
      method, redirect: 'error',
      headers: { Authorization: authorization, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    })
    result = await response.json()
  } catch { throw new StudioError('原生试用资金操作结果待核对；未自动重试', 502) }
  if (!response.ok || result?.success !== true) throw new StudioError('原生试用资金不可用，请核对原生订阅权限与设置；未自动重试', response.status === 401 ? 401 : 403)
  return result.data
}

export async function inspectTrialFunding(config, authorization, account, fetcher, { checkPreference = true, allowUnavailable = false } = {}) {
  if (!config.trial) return { state: 'unavailable', reason: '注册试用尚未启用' }
  if (!Number.isSafeInteger(account?.id) || account.id < config.trial.minUserId || account.status !== 1) return { state: 'ineligible', reason: '账号不符合本次新用户试用条件' }
  const plans = await native(config, authorization, '/api/subscription/plans', fetcher)
  const self = await native(config, authorization, '/api/subscription/self', fetcher)
  if (!Array.isArray(plans) || !self || !Array.isArray(self.subscriptions) || !Array.isArray(self.all_subscriptions)
      || !['subscription_first', 'subscription_only', 'wallet_first', 'wallet_only'].includes(self.billing_preference)) throw new StudioError('原生试用资金数据无效', 502)
  const matchingPlans = plans.filter(row => row?.plan?.id === config.trial.planId)
  const nativePlanSchema = z.object({ id: quota, enabled: z.boolean(), price_amount: z.number().finite().nonnegative(), total_amount: z.number().int().nonnegative().max(2147483647),
    duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']), duration_value: quota, custom_seconds: z.number().int().nonnegative().max(2147483647),
    quota_reset_period: z.enum(['never', 'daily', 'weekly', 'monthly', 'custom']), max_purchase_per_user: z.number().int().nonnegative().max(2147483647),
    allow_balance_pay: z.boolean(), allow_wallet_overflow: z.boolean(), upgrade_group: z.string(), downgrade_group: z.string() })
  if (matchingPlans.length !== 1 || !nativePlanSchema.safeParse(matchingPlans[0].plan).success) throw new StudioError('原生试用计划数据缺失、重复或无效，请联系管理员', 503)
  const retired = matchingPlans[0].plan.enabled !== true || Object.entries(config.trial.plan).some(([key, value]) => matchingPlans[0].plan[key] !== value)
  if (retired && !allowUnavailable) throw new StudioError('原生试用计划与批准配置不一致，请联系管理员', 503)
  for (const row of [...self.subscriptions, ...self.all_subscriptions]) {
    const sub = row?.subscription
    if (!sub || !Number.isSafeInteger(sub.id) || sub.id <= 0 || sub.user_id !== account.id || !Number.isSafeInteger(sub.plan_id)
        || !Number.isSafeInteger(sub.amount_total) || sub.amount_total < 0 || !Number.isSafeInteger(sub.amount_used) || sub.amount_used < 0
        || (sub.amount_total > 0 && sub.amount_used > sub.amount_total)
        || !Number.isSafeInteger(sub.end_time) || !['active', 'expired', 'cancelled'].includes(sub.status)
        || typeof sub.allow_wallet_overflow !== 'boolean') throw new StudioError('原生订阅所属账号或额度数据无效', 502)
  }
  if (new Set(self.all_subscriptions.map(row => row.subscription.id)).size !== self.all_subscriptions.length) throw new StudioError('原生订阅记录重复，需核对', 502)
  if (new Set(self.subscriptions.map(row => row.subscription.id)).size !== self.subscriptions.length
      || self.subscriptions.some(row => !self.all_subscriptions.some(other => other.subscription.id === row.subscription.id
        && Object.entries(row.subscription).every(([key, value]) => other.subscription[key] === value)))) throw new StudioError('原生活跃订阅与历史不一致，需核对', 502)
  const history = self.all_subscriptions.filter(row => row.subscription.plan_id === config.trial.planId)
  if (history.length > 1) throw new StudioError('原生试用订阅重复，需核对', 503)
  const billingPreference = self.billing_preference
  if (retired) return { state: 'retired', billingPreference, reason: '原生试用计划已停用或变更，原领取记录与剩余次数保留；未重新领取' }
  if (checkPreference && !['subscription_first', 'subscription_only'].includes(billingPreference)) return { state: 'unavailable', billingPreference, reason: '请到原生订阅页面选择订阅优先或仅订阅扣费，再领取或使用试用' }
  if (self.subscriptions.some(row => row.subscription.plan_id !== config.trial.planId && row.subscription.status === 'active' && row.subscription.end_time > Date.now() / 1000)) return { state: 'unavailable', billingPreference, reason: '账号还有其他活跃订阅，无法确认本次试用资金来源，请联系管理员' }
  if (!history.length) {
    if (self.subscriptions.some(row => row.subscription.plan_id === config.trial.planId)) throw new StudioError('原生试用历史与活跃订阅不一致', 502)
    return { state: 'eligible', billingPreference }
  }
  const sub = history[0].subscription
  const remaining = sub.amount_total - sub.amount_used
  if (sub.amount_total !== config.trial.plan.total_amount || sub.allow_wallet_overflow !== false || sub.upgrade_group !== '' || sub.downgrade_group !== '') throw new StudioError('原生试用订阅与批准配置不一致', 503)
  if (sub.status !== 'active' || sub.end_time <= Date.now() / 1000 || remaining <= 0) return { state: 'expired', subscriptionId: sub.id, billingPreference, reason: '试用资金已耗尽或过期，请前往原生钱包充值' }
  const active = self.subscriptions.filter(row => row.subscription.id === sub.id)
  if (active.length !== 1 || Object.entries(sub).some(([key, value]) => active[0].subscription[key] !== value)) throw new StudioError('原生活跃试用资金无法完整核验', 502)
  if (!Number.isSafeInteger(config.userTokenQuotaCap) || config.userTokenQuotaCap <= 0) throw new StudioError('原生试用令牌上限尚未批准', 503)
  return { state: !checkPreference || billingPreference === 'subscription_only' ? 'active' : 'needs-preference', subscriptionId: sub.id, tokenQuota: Math.min(remaining, config.userTokenQuotaCap), billingPreference,
    ...(checkPreference && billingPreference === 'subscription_first' ? { reason: '试用需选择仅订阅扣费，以避免期限到期后自动转钱包；请通过领取入口确认' } : {}) }
}

export async function purchaseTrial(config, authorization, fetcher) {
  if (!config.trial) throw new StudioError('注册试用尚未启用', 503)
  await native(config, authorization, '/api/subscription/balance/pay', fetcher, { plan_id: config.trial.planId })
}

export async function selectTrialFunding(config, authorization, fetcher) {
  if (!config.trial) throw new StudioError('注册试用尚未启用', 503)
  const result = await native(config, authorization, '/api/subscription/self/preference', fetcher, { billing_preference: 'subscription_only' }, 'PUT')
  if (result?.billing_preference !== 'subscription_only') throw new StudioError('原生试用扣费偏好结果待核对；未自动重试', 502)
}
