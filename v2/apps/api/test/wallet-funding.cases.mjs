import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectWalletFunding } from '../src/wallet-funding.mjs'
import { inspectTrialFunding } from '../src/trial-funding.mjs'

const config = { accountInstanceId: 'cf687550-8c09-4d34-8e61-a9e93b3c4b98', authOrigin: 'http://native.invalid', trial: { planId: 999 } }
const account = { id: 10, status: 1 }
const grant = { owner: 10, plan_id: 3, subscription_id: 5, status: 'active' }
const sub = { id: 5, user_id: 10, plan_id: 3, amount_total: 10000, amount_used: 10000, end_time: 1, status: 'expired', allow_wallet_overflow: false }
function fixture(history = [sub], active = [], billing_preference = 'wallet_only') {
  const calls = []
  return { calls, fetcher: async (url, options) => {
    calls.push({ path: url.pathname, ...options })
    assert.equal(url.pathname, '/api/subscription/self')
    return Response.json({ success: true, data: { subscriptions: active.map(subscription => ({ subscription })), all_subscriptions: history.map(subscription => ({ subscription })), billing_preference } })
  } }
}
test('wallet proof uses historical owner receipt independently of current plan or trial enablement', async () => {
  for (const trial of [undefined, { planId: 999 }, { planId: 3, enabled: false }]) {
    const f = fixture()
    assert.deepEqual(await inspectWalletFunding({ ...config, trial }, 'Bearer fixture', account, grant, f.fetcher), { state: 'eligibleWallet', owner: 10, instanceId: config.accountInstanceId, planId: 3, subscriptionId: 5 })
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.calls[0].body, undefined)
  }
})
test('never granted mature account and other owned subscriptions require no fabricated trial receipt', async () => {
  const other = { ...sub, id: 8, plan_id: 7, status: 'active', amount_used: 0, end_time: Math.floor(Date.now() / 1000) + 3600 }
  for (const preference of ['wallet_only', 'wallet_first', 'subscription_only', 'subscription_first']) {
    const f = fixture([other], [other], preference)
    assert.deepEqual(await inspectWalletFunding(config, 'Bearer fixture', account, undefined, f.fetcher), { state: 'eligibleWallet', owner: 10, instanceId: config.accountInstanceId })
  }
})
test('unbound instance, disabled owner and uncertain or mismatched grants do not contact native', async () => {
  for (const bad of [{ ...grant, status: 'claiming' }, { ...grant, status: 'unknown' }, { ...grant, owner: 11 }, { ...grant, subscription_id: null }]) {
    const f = fixture(); await assert.rejects(inspectWalletFunding(config, 'Bearer fixture', account, bad, f.fetcher)); assert.equal(f.calls.length, 0)
  }
  for (const [c, a] of [[{ ...config, accountInstanceId: undefined }, account], [config, { ...account, status: 2 }], [config, { ...account, id: 0 }]]) {
    const f = fixture(); await assert.rejects(inspectWalletFunding(c, 'Bearer fixture', a, grant, f.fetcher)); assert.equal(f.calls.length, 0)
  }
})
test('missing old receipt, duplicates, cross-owner and malformed or incomplete history fail closed', async () => {
  for (const history of [[], [sub, sub], [{ ...sub, user_id: 11 }], [{ ...sub, id: 6 }], [{ ...sub, amount_used: -1 }], [{ ...sub, amount_total: 10, amount_used: 11 }], [{ ...sub, allow_wallet_overflow: 'false' }], [sub, { ...sub, id: 6 }]]) {
    await assert.rejects(inspectWalletFunding(config, 'Bearer fixture', account, grant, fixture(history).fetcher))
  }
  await assert.rejects(inspectWalletFunding(config, 'Bearer fixture', account, grant, fixture([sub], [{ ...sub, amount_used: 1 }]).fetcher))
  await assert.rejects(inspectWalletFunding(config, 'Bearer fixture', account, grant, fixture([sub], [], 'invalid').fetcher))
})
test('network, invalid response and native rejection never retry or authorize fallback', async () => {
  for (const outcome of ['network', 'json', 'denied', 'invalid']) {
    let calls = 0
    const fetcher = async () => {
      calls++; if (outcome === 'network') throw new Error('lost response')
      if (outcome === 'json') return new Response('not-json')
      return Response.json(outcome === 'denied' ? { success: false } : { success: true, data: null }, { status: outcome === 'denied' ? 403 : 200 })
    }
    await assert.rejects(inspectWalletFunding(config, 'Bearer fixture', account, grant, fetcher)); assert.equal(calls, 1)
  }
})

test('trial retired classification is explicit while missing duplicate and malformed plans remain unknown', async () => {
  const plan = { price_amount: 0, total_amount: 10000, duration_unit: 'day', duration_value: 7, custom_seconds: 0, quota_reset_period: 'never', max_purchase_per_user: 1, allow_balance_pay: true, allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
  const trialConfig = { ...config, trial: { minUserId: 10, planId: 3, plan }, userTokenQuotaCap: 2000 }
  const nativePlan = { id: 3, enabled: true, ...plan }
  const read = plans => async url => Response.json({ success: true, data: url.pathname.endsWith('/plans') ? plans : { billing_preference: 'wallet_only', subscriptions: [], all_subscriptions: [] } })
  for (const change of [{ enabled: false }, { total_amount: 12000 }, { price_amount: 1 }, { allow_wallet_overflow: true }]) {
    const fetcher = read([{ plan: { ...nativePlan, ...change } }])
    await assert.rejects(inspectTrialFunding(trialConfig, 'Bearer fixture', account, fetcher))
    assert.equal((await inspectTrialFunding(trialConfig, 'Bearer fixture', account, fetcher, { checkPreference: false, allowUnavailable: true })).state, 'retired')
  }
  for (const plans of [[], [{ plan: nativePlan }, { plan: nativePlan }], [{ plan: { ...nativePlan, enabled: 'false' } }], [{ plan: { ...nativePlan, total_amount: -1 } }], [{ plan: { ...nativePlan, duration_unit: 'invalid' } }], [{ plan: { ...nativePlan, allow_balance_pay: undefined } }]]) {
    await assert.rejects(inspectTrialFunding(trialConfig, 'Bearer fixture', account, read(plans), { checkPreference: false, allowUnavailable: true }))
  }
  const malformedHistory = async url => Response.json({ success: true, data: url.pathname.endsWith('/plans') ? [{ plan: { ...nativePlan, enabled: false } }] : { billing_preference: 'wallet_only', subscriptions: [], all_subscriptions: [{ subscription: { ...sub, user_id: 11 } }] } })
  await assert.rejects(inspectTrialFunding(trialConfig, 'Bearer fixture', account, malformedHistory, { checkPreference: false, allowUnavailable: true }))
})
