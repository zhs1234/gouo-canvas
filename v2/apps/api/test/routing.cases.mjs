import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { relayKey, validateNormalRouting, NEW_API_ROUTING_COMMIT } from '../src/relay.mjs'
import { loadConfig } from '../src/config.mjs'
import { generateImage } from '../src/images.mjs'
import { runAgent } from '../src/agent.mjs'
const gateway = 'http://fixture.invalid/v1'
const evidence = { sourceCommit: NEW_API_ROUTING_COMMIT, retryTimes: 0, gatewayOrigin: new URL(gateway).origin, operatorVerified: true, verifiedAt: '2026-09-30T00:00:00Z' }
const config = { gateway, relayKey: 'fixture-ordinary-owner-token', relayRoutingMode: 'model', normalRoutingEvidence: evidence, models: [] }
const image = { kind: 'image', upstreamModelId: 'fixture-image', qualities: [], sizes: {}, operations: ['generate'] }

test('normal routing fails closed without exact operator evidence and never discards a pin', () => {
  for (const change of [{ sourceCommit: 'wrong' }, { retryTimes: 1 }, { gatewayOrigin: 'http://other.invalid' }, { operatorVerified: false }, { verifiedAt: '' }]) {
    assert.throws(() => validateNormalRouting({ ...evidence, ...change }, gateway, []), /人工核验/)
  }
  assert.throws(() => relayKey({ ...config, normalRoutingEvidence: undefined }, image), /人工核验/)
  assert.throws(() => relayKey(config, { ...image, channelId: 1 }), /channelId/)
  assert.throws(() => relayKey({ ...config, relayKey: 'fixture-token-1' }, image), /渠道后缀/)
  assert.equal(relayKey(config, image), config.relayKey)
  assert.equal(relayKey({ relayKey: 'fixture-base' }, { channelId: 2 }), 'fixture-base-2')
})

test('loadConfig requires nonsecret normal routing evidence before reading any relay secret', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-routing-'))
  try {
    const path = join(dir, 'evidence.json')
    writeFileSync(path, JSON.stringify(evidence))
    const env = { GOUO_RELAY_ROUTING_MODE: 'model', GOUO_GATEWAY_BASE_URL: gateway }
    assert.throws(() => loadConfig(env), /GOUO_NORMAL_ROUTING_EVIDENCE_FILE/)
    assert.equal(loadConfig({ ...env, GOUO_NORMAL_ROUTING_EVIDENCE_FILE: path }).relayRoutingMode, 'model')
    assert.throws(() => loadConfig({ ...env, GOUO_NORMAL_ROUTING_EVIDENCE_FILE: path, GOUO_RELAY_API_KEY: 'fixture-token-2' }), /渠道后缀/)
    assert.throws(() => loadConfig({ ...env, GOUO_RELAY_ROUTING_MODE: 'guess' }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('nonsecret setup checker ignores inherited secret/env settings and rejects unverified example', () => {
  const script = fileURLToPath(new URL('../../../scripts/check-model-config.mjs', import.meta.url))
  const example = fileURLToPath(new URL('../../../config/normal-routing.evidence.example.json', import.meta.url))
  const env = { ...process.env, GOUO_ENABLE_GENERATION: 'true', GOUO_RELAY_API_KEY_FILE: '/fixture/never-read-secret', GOUO_STUDIO_MODELS_FILE: '/fixture/never-read-config' }
  const good = spawnSync(process.execPath, [script], { encoding: 'utf8', env })
  assert.equal(good.status, 0)
  assert.doesNotMatch(good.stdout + good.stderr, /never-read/)
  const unverified = spawnSync(process.execPath, [script, '--evidence', example, '--gateway', 'http://new-api:3000/v1'], { encoding: 'utf8', env })
  assert.equal(unverified.status, 1)
})

for (const failure of ['http', 'unknown']) {
  test(`normal image routing sends ordinary token unchanged and attempts once on ${failure}`, async () => {
    let calls = 0
    await assert.rejects(generateImage(config, image, { prompt: 'fixture' }, async (_url, init) => {
      calls++
      assert.equal(init.headers.Authorization, 'Bearer fixture-ordinary-owner-token')
      assert.equal(JSON.parse(init.body).model, 'fixture-image')
      if (failure === 'unknown') throw new TypeError('fixture disconnect')
      return new Response('{}', { status: 503 })
    }))
    assert.equal(calls, 1)
  })
  test(`normal chat routing sends ordinary token unchanged and attempts once on ${failure}`, async () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = async (_url, init) => {
      calls++
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-ordinary-owner-token')
      assert.equal(JSON.parse(init.body).model, 'fixture-chat')
      if (failure === 'unknown') throw new TypeError('fixture disconnect')
      return new Response('{}', { status: 503 })
    }
    try {
      const result = await runAgent(config, { upstreamModelId: 'fixture-chat', maxChatCalls: 1, maxTokens: 128 }, { prompt: 'fixture', runId: 'fixture-run' })
      assert.equal(result.events.at(-1).type, 'run.failed')
      assert.equal(calls, 1)
    } finally { globalThis.fetch = original }
  })
}
