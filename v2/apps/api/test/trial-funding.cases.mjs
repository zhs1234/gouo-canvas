import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectTrialFunding, purchaseTrial, selectTrialFunding, trialPolicySchema } from '../src/trial-funding.mjs'
import { loadConfig } from '../src/config.mjs'

const plan = { price_amount: 0, total_amount: 10000, duration_unit: 'day', duration_value: 7, custom_seconds: 0, quota_reset_period: 'never', max_purchase_per_user: 1, allow_balance_pay: true, allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
const trial = { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', gatewayOrigin: 'http://new-api:3000', instanceId: 'cf687550-8c09-4d34-8e61-a9e93b3c4b98', minUserId: 10, planId: 3, relayIngress: 'studio-only', operatorVerified: true, plan }
const config = { trial, authOrigin: trial.gatewayOrigin, userTokenQuotaCap: 2000 }
const account = { id: 10, status: 1, quota: 0 }
const sub = { id: 5, user_id: 10, plan_id: 3, amount_total: 10000, amount_used: 1000, end_time: Math.floor(Date.now() / 1000) + 3600, status: 'active', allow_wallet_overflow: false, upgrade_group: '', downgrade_group: '' }
function fixture(history = [], preference = 'subscription_first', plans = [{ plan: { id: 3, enabled: true, ...plan } }]) {
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ path: url.pathname, ...options })
    const data = url.pathname.endsWith('/plans') ? plans : { billing_preference: preference, all_subscriptions: history.map(subscription => ({ subscription })), subscriptions: history.filter(s => s.status === 'active' && s.end_time > Date.now() / 1000).map(subscription => ({ subscription })) }
    return Response.json({ success: true, data })
  }
  return { fetcher, calls }
}

test('disabled and old/disabled accounts never contact native funding', async () => {
  const f = fixture()
  assert.equal((await inspectTrialFunding({ ...config, trial: undefined }, 'Bearer fixture', account, f.fetcher)).state, 'unavailable')
  for (const a of [{ ...account, id: 9 }, { ...account, status: 2 }]) assert.equal((await inspectTrialFunding(config, 'Bearer fixture', a, f.fetcher)).state, 'ineligible')
  assert.equal(f.calls.length, 0)
})
test('inspection is read only; untouched user eligible and zero wallet funded subscription active', async () => {
  const f = fixture()
  assert.equal((await inspectTrialFunding(config, 'Bearer fixture', account, f.fetcher)).state, 'eligible')
  assert.ok(f.calls.every(call => call.method === 'GET'))
  assert.deepEqual(await inspectTrialFunding(config, 'Bearer fixture', account, fixture([sub], 'subscription_only').fetcher), { state: 'active', subscriptionId: 5, tokenQuota: 2000, billingPreference: 'subscription_only' })
  const needs = await inspectTrialFunding(config, 'Bearer fixture', account, fixture([sub]).fetcher)
  assert.equal(needs.state, 'needs-preference')
  assert.equal(needs.subscriptionId, 5)
  assert.equal(needs.tokenQuota, 2000)
})
test('expired, cancelled or exhausted history cannot be claimed again', async () => {
  for (const s of [{ ...sub, status: 'expired' }, { ...sub, status: 'cancelled' }, { ...sub, amount_used: 10000 }, { ...sub, end_time: 1 }]) assert.equal((await inspectTrialFunding(config, 'Bearer fixture', account, fixture([s]).fetcher)).state, 'expired')
})
test('cross account, widened plan/subscription, duplicate records and malformed DTO fail closed', async () => {
  for (const history of [[{ ...sub, user_id: 11 }], [sub, sub], [{ ...sub, allow_wallet_overflow: true }], [{ ...sub, amount_total: 0 }], [{ ...sub, amount_used: -1 }]]) await assert.rejects(inspectTrialFunding(config, 'Bearer fixture', account, fixture(history).fetcher))
  for (const plans of [[], [{ plan: { id: 3, enabled: true, ...plan, total_amount: 10001 } }], [null]]) await assert.rejects(inspectTrialFunding(config, 'Bearer fixture', account, fixture([], 'subscription_first', plans).fetcher))
  await assert.rejects(inspectTrialFunding(config, 'Bearer fixture', account, async () => Response.json({ success: true, data: null })))
})
test('wallet preferences and other active funding never silently charge a different source', async () => {
  for (const preference of ['wallet_first', 'wallet_only']) assert.equal((await inspectTrialFunding(config, 'Bearer fixture', account, fixture([sub], preference).fetcher)).state, 'unavailable')
  assert.equal((await inspectTrialFunding(config, 'Bearer fixture', account, fixture([sub, { ...sub, id: 6, plan_id: 4 }]).fetcher)).state, 'unavailable')
})
test('facts-only inspection permits four valid preferences without selecting or widening trial funds', async () => {
  for (const preference of ['subscription_first', 'wallet_first', 'subscription_only', 'wallet_only']) {
    const f = fixture([sub], preference)
    assert.deepEqual(await inspectTrialFunding(config, 'Bearer fixture', account, f.fetcher, { checkPreference: false }), { state: 'active', subscriptionId: 5, tokenQuota: 2000, billingPreference: preference })
    assert.ok(f.calls.every(call => call.method === 'GET'))
  }
  for (const s of [{ ...sub, user_id: 11 }, { ...sub, allow_wallet_overflow: true }]) await assert.rejects(inspectTrialFunding(config, 'Bearer fixture', account, fixture([s], 'wallet_only').fetcher, { checkPreference: false }))
  assert.equal((await inspectTrialFunding(config, 'Bearer fixture', account, fixture([{ ...sub, end_time: 1 }], 'wallet_only').fetcher, { checkPreference: false })).state, 'expired')
  await assert.rejects(inspectTrialFunding(config, 'Bearer fixture', account, fixture([sub], 'invalid').fetcher, { checkPreference: false }))
})
test('purchase performs exactly one native operation; ambiguous and rejected outcomes never retry', async () => {
  for (const outcome of ['success', 'network', 'denied']) {
    const calls = []
    const fetcher = async (url, options) => { calls.push({ url, options }); if (outcome === 'network') throw new Error('timeout'); return Response.json({ success: outcome === 'success' }) }
    if (outcome === 'success') await purchaseTrial(config, 'Bearer fixture', fetcher)
    else await assert.rejects(purchaseTrial(config, 'Bearer fixture', fetcher))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.pathname, '/api/subscription/balance/pay')
    assert.equal(calls[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].options.body), { plan_id: 3 })
  }
})
test('explicit selection performs one PUT to subscription_only and never retries unknown results', async () => {
  for (const outcome of ['success', 'network', 'denied', 'wrong-preference']) {
    const calls = []
    const fetcher = async (url, options) => {
      calls.push({ url, options })
      if (outcome === 'network') throw new Error('lost response')
      return Response.json({ success: outcome !== 'denied', data: { billing_preference: outcome === 'wrong-preference' ? 'wallet_first' : 'subscription_only' } })
    }
    if (outcome === 'success') await selectTrialFunding(config, 'Bearer fixture', fetcher)
    else await assert.rejects(selectTrialFunding(config, 'Bearer fixture', fetcher))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.pathname, '/api/subscription/self/preference')
    assert.equal(calls[0].options.method, 'PUT')
    assert.deepEqual(JSON.parse(calls[0].options.body), { billing_preference: 'subscription_only' })
  }
})
test('policy requires approved finite funds and binds config to same fixed gateway', () => {
  for (const invalid of [{ ...trial, operatorVerified: false }, { ...trial, plan: { ...plan, total_amount: 0 } }, { ...trial, plan: { ...plan, max_purchase_per_user: 0 } }, { ...trial, plan: { ...plan, duration_unit: 'custom', custom_seconds: 0 } }, { ...trial, instanceId: 'missing' }]) assert.equal(trialPolicySchema.safeParse(invalid).success, false)
  assert.equal(loadConfig({}).trial, undefined)
  const dir = mkdtempSync(join(tmpdir(), 'gouo-trial-policy-'))
  try {
    const policyPath = join(dir, 'policy.json'), evidencePath = join(dir, 'routing.json')
    writeFileSync(policyPath, JSON.stringify(trial))
    writeFileSync(evidencePath, JSON.stringify({ sourceCommit: trial.sourceCommit, gatewayOrigin: trial.gatewayOrigin, retryTimes: 0, operatorVerified: true, verifiedAt: new Date().toISOString() }))
    const env = { GOUO_ENABLE_TRIAL: 'true', GOUO_TRIAL_POLICY_FILE: policyPath, GOUO_NORMAL_ROUTING_EVIDENCE_FILE: evidencePath, GOUO_RELAY_CREDENTIAL_MODE: 'user-token', GOUO_RELAY_ROUTING_MODE: 'model', GOUO_GATEWAY_BASE_URL: trial.gatewayOrigin + '/v1', GOUO_USER_TOKEN_QUOTA_CAP: '2000', GOUO_USER_TOKEN_LIFETIME_SECONDS: '3600' }
    assert.deepEqual(loadConfig(env).trial, trial)
    writeFileSync(policyPath, JSON.stringify({ ...trial, gatewayOrigin: 'http://different:3000' }))
    assert.throws(() => loadConfig(env), /同一固定版本/)
    assert.throws(() => loadConfig({ GOUO_ENABLE_TRIAL: 'true' }), /GOUO_TRIAL_POLICY_FILE/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
