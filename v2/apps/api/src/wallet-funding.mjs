import { z } from 'zod'
import { StudioError } from './images-error.mjs'

const positiveId = z.number().int().positive().refine(Number.isSafeInteger)
const amount = z.number().int().nonnegative().refine(Number.isSafeInteger)
const subscription = z.object({
  id: positiveId, user_id: positiveId, plan_id: positiveId,
  amount_total: amount, amount_used: amount, end_time: amount,
  status: z.enum(['active', 'expired', 'cancelled']), allow_wallet_overflow: z.boolean(),
}).passthrough().refine(row => row.amount_total === 0 || row.amount_used <= row.amount_total)
const row = z.object({ subscription })
const selfSchema = z.object({
  billing_preference: z.enum(['subscription_first', 'subscription_only', 'wallet_first', 'wallet_only']),
  subscriptions: z.array(row), all_subscriptions: z.array(row),
})

// Read-only receipt evidence. Selecting wallet_only and checking fresh wallet
// quota belong to the caller; a retired trial plan is not a wallet authority.
export async function inspectWalletFunding(config, authorization, account, grant, fetcher) {
  if (!Number.isSafeInteger(account?.id) || account.id <= 0 || account.status !== 1) throw new StudioError('本人账号无权使用余额付款', 403)
  if (!z.string().uuid().safeParse(config.accountInstanceId).success) throw new StudioError('账号实例绑定尚未配置，未转为余额付款', 503)
  if (grant && (grant.owner !== account.id || grant.status !== 'active' || !positiveId.safeParse(grant.plan_id).success || !positiveId.safeParse(grant.subscription_id).success)) throw new StudioError('原试用领取凭据待核对，未转为余额付款', 409)
  let response, body
  try {
    response = await fetcher(new URL('/api/subscription/self', config.authOrigin), {
      method: 'GET', headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    body = await response.json()
  } catch { throw new StudioError('原生账号资金记录暂不可用，未转为余额付款；未自动重试', 502) }
  if (!response.ok || body?.success !== true) throw new StudioError('原生账号资金记录不可用，未转为余额付款', response.status === 401 ? 401 : response.status >= 500 ? 502 : 403)
  const parsed = selfSchema.safeParse(body.data)
  if (!parsed.success) throw new StudioError('原生订阅记录格式无效，未转为余额付款', 502)
  const self = parsed.data
  for (const rows of [self.subscriptions, self.all_subscriptions]) {
    if (rows.some(row => row.subscription.user_id !== account.id) || new Set(rows.map(row => row.subscription.id)).size !== rows.length) throw new StudioError('原生订阅所属账号或重复记录待核对', 502)
  }
  if (self.subscriptions.some(({ subscription: active }) => !self.all_subscriptions.some(({ subscription: historical }) => historical.id === active.id && Object.entries(active).every(([key, value]) => historical[key] === value)))) throw new StudioError('原生活跃订阅与历史不一致，未转为余额付款', 502)
  if (grant) {
    const receipts = self.all_subscriptions.filter(({ subscription }) => subscription.plan_id === grant.plan_id)
    if (receipts.length !== 1 || receipts[0].subscription.id !== grant.subscription_id) throw new StudioError('原试用订阅凭据缺失或变化，未转为余额付款', 409)
  }
  return { state: 'eligibleWallet', owner: account.id, instanceId: config.accountInstanceId,
    ...(grant ? { planId: grant.plan_id, subscriptionId: grant.subscription_id } : {}) }
}
