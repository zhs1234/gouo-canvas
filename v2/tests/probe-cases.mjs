import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProbe, summarizeResponse } from '../scripts/image-probe.mjs'
const env = { IMAGE_PROBE_BASE_URL: 'https://example.com/v1', IMAGE_PROBE_MODEL: 'gpt-image-2.5-sunburst', IMAGE_PROBE_KEY: 'test-only' }
test('probe cannot incur charges accidentally', () => assert.throws(() => buildProbe(env, false)))
test('explicit model name survives untouched', () => assert.equal(buildProbe(env, true).body.model, env.IMAGE_PROBE_MODEL))
test('invalid or credential-bearing endpoints fail', () => {
  for (const IMAGE_PROBE_BASE_URL of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=x', 'https://example.com/other']) assert.throws(() => buildProbe({ ...env, IMAGE_PROBE_BASE_URL }, true))
  assert.throws(() => buildProbe({}, true))
})
test('report discards raw errors, image data and secret-like usage fields', () => {
  const report = summarizeResponse({ data: [{ b64_json: 'image-data' }], usage: { total_tokens: 3, secret: 'secret' }, error: { message: 'secret' } })
  assert.equal(report.imageCount, 1)
  assert.deepEqual(report.usage, { total_tokens: 3 })
  assert.ok(!JSON.stringify(report).includes('secret'))
})
test('empty or malformed results are not successful images', () => {
  for (const payload of [null, {}, { data: [{ url: 'javascript:bad' }, { b64_json: '' }] }]) assert.equal(summarizeResponse(payload).imageCount, 0)
})
