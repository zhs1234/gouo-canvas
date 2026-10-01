import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger } from '../src/ledger.mjs'
import { FundingState } from '../src/funding-state.mjs'
import { readBillingPreference } from '../src/funding.mjs'
import { Trial } from '../src/trial.mjs'

const config = { authOrigin: 'http://funding-state-fixture.invalid' }
const authorization = owner => 'Bearer fixture-owner-' + owner
// A native contract double only: no accounts, billing or models are executed.
function fixture(options = {}) {
  const preferences = new Map([[7, 'subscription_only'], [8, 'subscription_only']]), calls = []
  const fetcher = async (url, init) => {
    const owner = Number(init.headers.Authorization.split('-').at(-1))
    const call = { owner, method: init.method, path: new URL(url).pathname }
    calls.push(call)
    if (init.method === 'PUT') {
      const requested = JSON.parse(init.body).billing_preference
      if (options.write) return options.write({ owner, requested, preferences })
      preferences.set(owner, requested)
      return Response.json({ success: true, data: { billing_preference: requested } })
    }
    if (options.read) return options.read({ owner, preferences, calls })
    return Response.json({ success: true, data: { billing_preference: preferences.get(owner) } })
  }
  return { preferences, calls, fetcher }
}
const row = (ledger, owner = 7) => ledger.db.prepare('SELECT preference,status FROM funding_writes WHERE owner=?').get(owner)
const select = (state, f, owner = 7, preference = 'wallet_only') => state.select(config, authorization(owner), owner, preference, f.fetcher)

test('strict source selection persists pending before its single write and confirms readback; no-op has no write', async () => {
  const ledger = new Ledger(':memory:'), state = new FundingState(ledger.db)
  try {
    const f = fixture({ write: ({ owner, requested, preferences }) => {
      assert.deepEqual({ ...row(ledger, owner) }, { preference: requested, status: 'pending' })
      assert.equal(state.blocked(owner), true)
      preferences.set(owner, requested)
      return Response.json({ success: true, data: { billing_preference: requested } })
    } })
    await select(state, f)
    assert.deepEqual(f.calls.map(call => call.method), ['GET', 'PUT', 'GET'])
    assert.deepEqual({ ...row(ledger) }, { preference: 'wallet_only', status: 'confirmed' })
    assert.equal(state.blocked(7), false)
    f.calls.length = 0
    await select(state, f)
    assert.deepEqual(f.calls.map(call => call.method), ['GET'])
    const fresh = fixture()
    await select(state, fresh, 8, 'subscription_only')
    assert.equal(row(ledger, 8), undefined, 'a read-only no-op creates no pending write')
  } finally { ledger.close() }
})

test('unknown write, rejected write, lost JSON, and confirmation mismatch block every subsequent source selection', async () => {
  const failures = [
    { write: () => { throw new Error('fixture write response lost') } },
    { write: () => new Response('{}', { status: 403 }) },
    { write: () => new Response('invalid-json') },
    { write: () => Response.json({ success: true, data: { billing_preference: 'subscription_only' } }) },
    { read: ({ owner, preferences }) => Response.json({ success: true, data: { billing_preference: preferences.get(owner) } }),
      write: ({ requested }) => Response.json({ success: true, data: { billing_preference: requested } }) },
  ]
  for (const options of failures) {
    const ledger = new Ledger(':memory:'), state = new FundingState(ledger.db), f = fixture(options)
    try {
      await assert.rejects(select(state, f))
      assert.equal(row(ledger).status, 'unknown')
      assert.equal(state.blocked(7), true)
      const before = f.calls.length
      for (const preference of ['wallet_only', 'subscription_only']) {
        await assert.rejects(select(state, f, 7, preference), error => error.status === 409)
      }
      assert.equal(f.calls.length, before, 'blocked select performs no read or repeat write')
    } finally { ledger.close() }
  }
})

test('read failure before any write creates no barrier, while read failure after a successful PUT keeps unknown', async () => {
  for (const afterWrite of [false, true]) {
    const ledger = new Ledger(':memory:'), state = new FundingState(ledger.db)
    const f = fixture({ read: ({ owner, preferences, calls }) => {
      if (!afterWrite || calls.some(call => call.method === 'PUT')) throw new Error('fixture read unavailable')
      return Response.json({ success: true, data: { billing_preference: preferences.get(owner) } })
    } })
    try {
      await assert.rejects(select(state, f))
      assert.equal(state.blocked(7), afterWrite)
      assert.equal(row(ledger)?.status, afterWrite ? 'unknown' : undefined)
      assert.equal(f.calls.filter(call => call.method === 'PUT').length, afterWrite ? 1 : 0)
    } finally { ledger.close() }
  }
})

test('restart recovers pending to unknown; read consistency and a late native write cannot unlock owner', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-funding-state-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'ledger.sqlite'), f = fixture()
  let ledger = new Ledger(path)
  try {
    new FundingState(ledger.db)
    ledger.db.prepare("INSERT INTO funding_writes VALUES(7,'wallet_only','pending',?)").run(new Date().toISOString())
    ledger.close(); ledger = new Ledger(path)
    const state = new FundingState(ledger.db)
    assert.equal(row(ledger).status, 'unknown')
    assert.equal(await readBillingPreference(config, authorization(7), f.fetcher), 'subscription_only')
    assert.equal(state.blocked(7), true, 'a matching safe read cannot establish that the old handler stopped')
    f.preferences.set(7, 'wallet_only') // Delayed old native handler completes.
    assert.equal(await readBillingPreference(config, authorization(7), f.fetcher), 'wallet_only')
    assert.equal(state.blocked(7), true, 'even observed completion does not auto-unlock the owner')
    const before = f.calls.length
    await assert.rejects(select(state, f, 7, 'subscription_only'), error => error.status === 409)
    assert.equal(f.calls.length, before)
    await select(state, f, 8, 'wallet_only')
    assert.equal(state.blocked(8), false, 'another owner remains usable')
    assert.equal(row(ledger).status, 'unknown')
    ledger.close(); ledger = new Ledger(path)
    const restarted = new FundingState(ledger.db)
    assert.equal(restarted.blocked(7), true)
    assert.equal(restarted.blocked(8), false)
  } finally { ledger.close() }
})

test('ambiguous and fallback preference values fail before any read or state mutation', async () => {
  const ledger = new Ledger(':memory:'), state = new FundingState(ledger.db), f = fixture()
  try {
    for (const preference of ['subscription_first', 'wallet_first', '', null, undefined]) {
      await assert.rejects(state.select(config, authorization(7), 7, preference, f.fetcher), error => error.status === 400)
    }
    assert.equal(f.calls.length, 0)
    assert.equal(row(ledger), undefined)
  } finally { ledger.close() }
})

test('old trial ledgers conservatively migrate unknown claim or pre-response unknown run once, preserving owner isolation', async () => {
  const ledger = new Ledger(':memory:')
  try {
    new Trial(ledger.db)
    for (const [owner, status] of [[7, 'unknown'], [8, 'active'], [9, 'active'], [10, 'active'], [11, 'active']]) {
      ledger.db.prepare('INSERT INTO trial_grants VALUES(?,1,NULL,?,?)').run(owner, status, new Date().toISOString())
    }
    for (const owner of [8, 9, 10]) {
      ledger.begin(owner, 'agent', 'migration-' + owner, {})
      if (owner !== 10) ledger.unknown(owner, 'agent', 'migration-' + owner)
    }
    ledger.gateway(9, 'agent', 'migration-9', { requestId: 'fixture-response-9', status: 200 })
    const state = new FundingState(ledger.db)
    assert.equal(state.blocked(7), true, 'unknown native claim may include a lost preference PUT')
    assert.equal(state.blocked(8), true, 'even a model-only pre-response failure is conservatively blocked without old write evidence')
    for (const owner of [9, 10, 11]) assert.equal(state.blocked(owner), false, 'unrelated owner ' + owner)
    ledger.unknown(10, 'agent', 'migration-10')
    new FundingState(ledger.db)
    assert.equal(state.blocked(10), false, 'first-upgrade scan is not rerun for modern model-only unknown requests')
    assert.equal(state.blocked(7), true)
    assert.equal(state.blocked(8), true)
  } finally { ledger.close() }
})

test('failed first-upgrade seed rolls back table creation so a restart cannot skip the safety migration', () => {
  const ledger = new Ledger(':memory:')
  try {
    new Trial(ledger.db)
    ledger.db.prepare("INSERT INTO trial_grants VALUES(7,1,NULL,'unknown',?)").run(new Date().toISOString())
    const interrupted = {
      exec: sql => ledger.db.exec(sql),
      prepare: sql => {
        if (sql.includes('INSERT OR IGNORE INTO funding_writes')) throw new Error('fixture migration interrupted after CREATE')
        return ledger.db.prepare(sql)
      },
    }
    assert.throws(() => new FundingState(interrupted), /migration interrupted/)
    assert.equal(ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='funding_writes'").get(), undefined)
    const retried = new FundingState(ledger.db)
    assert.equal(retried.blocked(7), true, 'retry still imports the ambiguous old owner')
  } finally { ledger.close() }
})
