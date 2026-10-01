import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-renewal-config-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const models = join(directory, 'models.json'), routing = join(directory, 'routing.json'), policyFile = join(directory, 'renewal.json')
  const origin = 'http://127.0.0.1:31997', instanceId = '11111111-2222-4333-8444-555555555555'
  const sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
  writeFileSync(models, JSON.stringify({ models: [] }))
  writeFileSync(routing, JSON.stringify({ sourceCommit, gatewayOrigin: origin, retryTimes: 0, operatorVerified: true, verifiedAt: '2026-10-01T00:00:00Z' }))
  const policy = { sourceCommit, gatewayOrigin: origin, instanceId, operatorVerified: true, relayIngress: 'studio-only',
    tokenWrites: 'studio-only', completeKeys: 'studio-only', redisEnabled: false, batchUpdateEnabled: false }
  const env = { GOUO_STUDIO_MODELS_FILE: models, GOUO_GATEWAY_BASE_URL: origin + '/v1', GOUO_BACKEND_DEV_TARGET: origin,
    GOUO_NORMAL_ROUTING_EVIDENCE_FILE: routing, GOUO_RELAY_ROUTING_MODE: 'model', GOUO_RELAY_CREDENTIAL_MODE: 'user-token',
    GOUO_ACCOUNT_INSTANCE_ID: instanceId, GOUO_USER_TOKEN_QUOTA_CAP: '100', GOUO_USER_TOKEN_LIFETIME_SECONDS: '3600',
    GOUO_ENABLE_TOKEN_RENEWAL: 'true', GOUO_TOKEN_RENEWAL_POLICY_FILE: policyFile }
  const write = value => writeFileSync(policyFile, typeof value === 'string' ? value : JSON.stringify(value))
  write(policy)
  return { env, policy, write, directory }
}

test('renewal needs explicit user-token policy and stays separate from generation authorization', t => {
  const f = fixture(t)
  const accepted = loadConfig(f.env)
  assert.deepEqual(accepted.tokenRenewalPolicy, f.policy)
  assert.equal(accepted.allowGeneration, false, 'Policy acceptance grants no model execution or funds')
  assert.equal(accepted.relayKey, '')
  assert.throws(() => loadConfig({ ...f.env, GOUO_RELAY_CREDENTIAL_MODE: 'personal' }), /每用户模式/)
  assert.throws(() => loadConfig({ ...f.env, GOUO_TOKEN_RENEWAL_POLICY_FILE: '' }), /核验记录/)
  assert.throws(() => loadConfig({ ...f.env, GOUO_TOKEN_RENEWAL_POLICY_FILE: join(f.directory, 'missing.json') }))
})

test('policy cannot authorize another native build, gateway, or account instance', t => {
  const f = fixture(t)
  for (const change of [{ sourceCommit: 'f'.repeat(40) }, { gatewayOrigin: 'http://another.invalid' },
    { gatewayOrigin: f.policy.gatewayOrigin + '/v1' }, { instanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }]) {
    f.write({ ...f.policy, ...change }); assert.throws(() => loadConfig(f.env))
  }
  // Matching the bad build in both documents must not bypass fixed normal-routing verification.
  f.write({ ...f.policy, sourceCommit: 'f'.repeat(40) })
  writeFileSync(f.env.GOUO_NORMAL_ROUTING_EVIDENCE_FILE, JSON.stringify({ sourceCommit: 'f'.repeat(40),
    gatewayOrigin: f.policy.gatewayOrigin, retryTimes: 0, operatorVerified: true, verifiedAt: '2026-10-01T00:00:00Z' }))
  assert.throws(() => loadConfig(f.env), /固定版本/)
})

test('unverified or nonexclusive relay, token-write, and complete-key ingress cannot enable renewal', t => {
  const f = fixture(t)
  for (const field of ['operatorVerified', 'relayIngress', 'tokenWrites', 'completeKeys']) {
    for (const value of [undefined, field === 'operatorVerified' ? false : 'public', field === 'operatorVerified' ? 'true' : '']) {
      f.write({ ...f.policy, [field]: value }); assert.throws(() => loadConfig(f.env), field)
    }
  }
})

test('Redis, batched quota updates, malformed policy and unknown approvals fail closed', t => {
  const f = fixture(t)
  for (const field of ['redisEnabled', 'batchUpdateEnabled']) {
    for (const value of [true, 'false', undefined]) {
      f.write({ ...f.policy, [field]: value }); assert.throws(() => loadConfig(f.env), field)
    }
  }
  for (const policy of [{ ...f.policy, automaticRenewal: true }, { ...f.policy, walletFallback: true }, {}, null, '{invalid']) {
    f.write(policy); assert.throws(() => loadConfig(f.env))
  }
})

test('default or explicitly disabled renewal never reads a supplied missing or malformed policy file', t => {
  const f = fixture(t)
  for (const flag of [undefined, 'false', 'TRUE', '1']) {
    const env = { ...f.env, GOUO_ENABLE_TOKEN_RENEWAL: flag }
    f.write('{invalid')
    assert.equal(loadConfig(env).tokenRenewalPolicy, undefined)
    assert.equal(loadConfig({ ...env, GOUO_TOKEN_RENEWAL_POLICY_FILE: join(f.directory, 'must-not-read.json') }).tokenRenewalPolicy, undefined)
  }
  // Baseline personal configuration also remains loadable without any renewal evidence.
  const env = { GOUO_STUDIO_MODELS_FILE: f.env.GOUO_STUDIO_MODELS_FILE,
    GOUO_TOKEN_RENEWAL_POLICY_FILE: join(f.directory, 'must-not-read-personal.json') }
  assert.equal(loadConfig(env).tokenRenewalPolicy, undefined)
})
