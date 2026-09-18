import test from 'node:test'
import assert from 'node:assert/strict'
import { validateIntent, canTransition } from '../.cache/contracts/index.js'
const model = { id: 'test', label: 'fixture only', protocol: 'openai-images', enabled: true, verification: 'live-verified', capabilities: { operations: ['generate', 'edit', 'inpaint'], maxInputs: 2, maxOutputs: 2, qualities: ['low', 'xhigh'], formats: ['png', 'jpeg'], transparency: true, sizes: ['1024x1024'] } }
const intent = { modelId: 'test', operation: 'generate', prompt: '商品图片', inputAssetIds: [], count: 1, format: 'png', transparent: false }
test('accepts a tested capability combination', () => assert.deepEqual(validateIntent(model, intent), []))
test('unverified or disabled channels fail closed', () => {
  for (const extra of [{ verification: 'pending' }, { verification: 'contract-tested' }, { enabled: false }]) assert.ok(validateIntent({ ...model, ...extra }, intent).length)
})
test('model mismatch and unsupported operations fail', () => {
  assert.ok(validateIntent(model, { ...intent, modelId: 'other' }).length)
  assert.ok(validateIntent(model, { ...intent, operation: 'upscale' }).length)
})
test('counts must be bounded safe integers', () => {
  for (const count of [0, -1, 1.5, 3, NaN, Infinity]) assert.ok(validateIntent(model, { ...intent, count }).length)
})
test('editing requires inputs and inpainting requires mask', () => {
  assert.ok(validateIntent(model, { ...intent, operation: 'edit' }).length)
  assert.ok(validateIntent(model, { ...intent, operation: 'inpaint', inputAssetIds: ['a'] }).length)
  assert.deepEqual(validateIntent(model, { ...intent, operation: 'inpaint', inputAssetIds: ['a'], maskAssetId: 'm' }), [])
})
test('duplicate, empty and excessive input ids fail', () => {
  for (const inputAssetIds of [['a', 'a'], [''], ['a', 'b', 'c']]) assert.ok(validateIntent(model, { ...intent, operation: 'edit', inputAssetIds }).length)
})
test('input pictures cannot silently become text generation', () => assert.ok(validateIntent(model, { ...intent, inputAssetIds: ['a'] }).length))
test('unsupported size quality format and alpha fail', () => {
  for (const extra of [{ size: '9K' }, { quality: 'max' }, { format: 'webp' }, { format: 'jpeg', transparent: true }]) assert.ok(validateIntent(model, { ...intent, ...extra }).length)
  assert.deepEqual(validateIntent(model, { ...intent, quality: 'xhigh' }), [])
})
test('terminal jobs cannot run again; ambiguous submission reconciles', () => {
  assert.equal(canTransition('running', 'reconciling'), true)
  assert.equal(canTransition('reconciling', 'running'), false)
  for (const status of ['succeeded', 'partially-succeeded', 'failed', 'canceled']) assert.equal(canTransition(status, 'running'), false)
  assert.equal(canTransition('running', 'canceled'), false)
})
