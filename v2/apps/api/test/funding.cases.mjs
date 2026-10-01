import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFundingAccount, readBillingPreference, selectBillingPreference } from '../src/funding.mjs'
import { StudioError } from '../src/images-error.mjs'

const config = { authOrigin: 'http://native-fixture.invalid', relayKey: 'must-never-be-used' }
const authorization = 'Bearer fixture-user-jwt'
const account = { id: 7, status: 1, group: 'default', quota: 100 }
function fixture(data, options = {}) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url, init })
    if (options.network) throw new Error('fixture lost result')
    return options.invalidJson ? new Response('invalid fixture json') : Response.json(options.envelope ?? { success: true, data }, { status: options.status ?? 200 })
  }
  return { calls, fetcher }
}
const status = code => error => error instanceof StudioError && error.status === code

test('read funding validates owner/permissions and preserves native negative quota without mutations', async () => {
  for (const quota of [100, 0, -12]) {
    const f = fixture({ ...account, quota })
    assert.deepEqual(await readFundingAccount(config, authorization, 7, f.fetcher), { ...account, quota })
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].url.pathname, '/api/user/self')
    assert.equal(f.calls[0].init.method, 'GET')
    assert.equal(f.calls[0].init.headers.Authorization, authorization)
    assert.equal(f.calls[0].init.redirect, 'error')
    assert.ok(f.calls[0].init.signal instanceof AbortSignal)
    assert.equal(f.calls[0].init.body, undefined)
    assert.doesNotMatch(JSON.stringify(f.calls), /must-never-be-used/)
  }
  for (const data of [{ ...account, id: 8 }, { ...account, status: 2 }]) await assert.rejects(readFundingAccount(config, authorization, 7, fixture(data).fetcher), status(403))
  for (const data of [null, { ...account, quota: 1.5 }, { ...account, quota: Number.MAX_SAFE_INTEGER + 1 }, { ...account, group: '' }, { ...account, group: 'auto' }, { ...account, id: '7' }]) await assert.rejects(readFundingAccount(config, authorization, 7, fixture(data).fetcher), status(502))
  const f = fixture(account)
  await assert.rejects(readFundingAccount(config, authorization, 0, f.fetcher), status(403))
  assert.equal(f.calls.length, 0)
})

test('read preference accepts only fixed native enumerations and stays read-only', async () => {
  for (const pref of ['subscription_first', 'wallet_first', 'subscription_only', 'wallet_only']) {
    const f = fixture({ billing_preference: pref })
    assert.equal(await readBillingPreference(config, authorization, f.fetcher), pref)
    assert.equal(f.calls[0].url.pathname, '/api/subscription/self')
    assert.equal(f.calls[0].init.method, 'GET')
  }
  for (const pref of [undefined, '', 'auto', 'WALLET_ONLY', 1]) await assert.rejects(readBillingPreference(config, authorization, fixture({ billing_preference: pref }).fetcher), status(502))
})

test('selection writes exactly once to only preference with no token, quota or account changes', async () => {
  for (const pref of ['subscription_only', 'wallet_only']) {
    const f = fixture({ billing_preference: pref })
    await selectBillingPreference(config, authorization, pref, f.fetcher)
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].url.pathname, '/api/subscription/self/preference')
    assert.equal(f.calls[0].init.method, 'PUT')
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { billing_preference: pref })
    assert.equal(f.calls[0].init.headers.Authorization, authorization)
  }
  for (const pref of ['subscription_first', 'wallet_first', undefined, 'auto']) {
    const f = fixture({ billing_preference: pref })
    await assert.rejects(selectBillingPreference(config, authorization, pref, f.fetcher), status(403))
    assert.equal(f.calls.length, 0)
  }
  const f = fixture({ billing_preference: 'subscription_only' })
  await assert.rejects(selectBillingPreference(config, authorization, 'wallet_only', f.fetcher), status(502))
  assert.equal(f.calls.length, 1)
})

test('network, HTTP, JSON and business failures map precisely and never retry', async () => {
  for (const [options, expectedStatus] of [[{ network: true }, 502], [{ invalidJson: true }, 502], [{ status: 401 }, 401], [{ status: 403 }, 403], [{ status: 500 }, 502], [{ status: 429 }, 502], [{ envelope: { success: false } }, 403], [{ envelope: {} }, 502]]) {
    for (const operation of [f => readFundingAccount(config, authorization, 7, f), f => readBillingPreference(config, authorization, f), f => selectBillingPreference(config, authorization, 'wallet_only', f)]) {
      const f = fixture({ billing_preference: 'wallet_only' }, options)
      await assert.rejects(operation(f.fetcher), status(expectedStatus))
      assert.equal(f.calls.length, 1)
    }
  }
})
