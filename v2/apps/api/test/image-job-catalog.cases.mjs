import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalog } from '../src/config.mjs'

const image = { id: 'image-fixture', displayName: 'Explicit contract fixture', kind: 'image', enabled: true, verification: 'live-verified', operations: ['generate'] }
const base = { allowGeneration: true, relayCredentialMode: 'user-token', relayRoutingMode: 'model', userTokenQuotaCap: 100,
  userTokenLifetimeSeconds: 3600, models: [image] }

test('catalog advertises durable image execution only with both generation and job approval', () => {
  assert.equal(catalog(base).imageJobsEnabled, false)
  assert.equal(catalog({ ...base, enableImageJobs: true }).imageJobsEnabled, true)
  for (const change of [{ allowGeneration: false }, { relayRoutingMode: 'unapproved' }, { userTokenQuotaCap: 0 }, { userTokenLifetimeSeconds: 0 }]) {
    assert.equal(catalog({ ...base, ...change, enableImageJobs: true }).imageJobsEnabled, false)
  }
})

test('catalog cannot advertise jobs through a missing, blocked, pending or chat-only image capability', () => {
  for (const models of [[], [{ ...image, enabled: false }], [{ ...image, verification: 'contract-tested' }], [{ ...image, kind: 'chat' }]]) {
    assert.equal(catalog({ ...base, enableImageJobs: true, models }).imageJobsEnabled, false)
  }
  const result = catalog({ ...base, enableImageJobs: true, relayKey: 'contract-secret-should-stay-server-side',
    authOrigin: 'http://private-contract.invalid', internalTask: { native_pending: 1 } })
  assert.equal(result.imageJobsEnabled, true)
  assert.deepEqual(Object.keys(result).sort(), ['conversationMode', 'generationEnabled', 'imageJobsEnabled', 'models'])
  assert.equal(JSON.stringify(result).includes('contract-secret'), false)
  assert.equal(JSON.stringify(result).includes('private-contract'), false)
  assert.equal(JSON.stringify(result).includes('native_pending'), false)
})
