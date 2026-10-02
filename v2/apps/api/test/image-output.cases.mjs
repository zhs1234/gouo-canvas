import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { generateImage } from '../src/images.mjs'

const config = { gateway: 'http://fixture.invalid/v1', relayKey: 'fixture-only-secret' }
const model = { id: 'image', upstreamModelId: 'fixture-image', qualities: [], sizes: {}, operations: ['generate'] }
const body = { prompt: 'fixture' }
const json = bytes => JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }], private_metadata: { secret: 'fixture-provider-private' } })

test('job output sink receives exact raster bytes and is awaited before the first image header decode', async () => {
  const original = Buffer.from('not an image'), marker = new Error('fixture durable sink marker')
  let called = 0
  await assert.rejects(generateImage({ ...config, onImageOutput: async bytes => {
    called++; assert.deepEqual(bytes, original); await new Promise(resolve => setImmediate(resolve)); throw marker
  } }, model, body, async () => new Response(json(original))), error => error === marker)
  assert.equal(called, 1)
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#7755cc' } }).png().toBuffer()
  const result = await generateImage({ ...config, onImageOutput: bytes => assert.deepEqual(bytes, png) }, model, body, async () => new Response(json(png)))
  assert.equal(result.url, 'data:image/png;base64,' + png.toString('base64'))
  assert.equal(result.width, 3); assert.equal(result.height, 2)
  assert.doesNotMatch(JSON.stringify(result), /fixture-provider-private/)
})

test('bounded image HTTP reader rejects declared and actual oversized JSON, even when the supplier omits or lies about Content-Length', async () => {
  for (const length of ['50331649','1',null]) {
    let cancelled = false, reads = 0, staged = 0, calls = 0
    const stream = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel() { cancelled = true } })
    await assert.rejects(generateImage({ ...config, onImageOutput: () => staged++ }, model, body, async (_url, init) => {
      calls++; assert.equal(init.redirect, 'error')
      return new Response(stream, { headers: length ? { 'content-length': length } : {} })
    }), /超过安全大小限制/)
    assert.equal(cancelled, true); assert.equal(calls, 1); assert.equal(staged, 0)
    assert.ok(reads <= 50)
  }
})

test('malformed JSON/UTF8, broken body, URL-only and unsupported binary responses never stage or download another URL', async () => {
  const responses = [() => new Response('{fixture-private'), () => new Response(new Uint8Array([0xff,0xfe])),
    () => new Response(JSON.stringify({ data: [{ url: 'http://169.254.169.254/private' }] })),
    () => new Response(new Uint8Array([0x89,0x50,0x4e,0x47]), { headers: { 'content-type': 'image/png' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.error(new Error('fixture-private')) } }))]
  for (const response of responses) {
    let calls = 0, staged = 0
    await assert.rejects(generateImage({ ...config, onImageOutput: () => staged++ }, model, body, async () => { calls++; return response() }), error => {
      assert.equal(error.status, 502); assert.doesNotMatch(error.message, /fixture-private|169\.254/); return true
    })
    assert.equal(calls, 1); assert.equal(staged, 0)
  }
})

test('job raster staging rejects noncanonical base64 and preserves the existing 40MiB encoded/30MiB byte boundary before decoding', async () => {
  let staged = 0
  for (const encoded of ['AAAA\n','AA=A','A'.repeat(40 * 1024 * 1024 + 1)]) {
    await assert.rejects(generateImage({ ...config, onImageOutput: () => staged++ }, model, body,
      async () => new Response(JSON.stringify({ data: [{ b64_json: encoded }] }))), error => error.status === 502)
  }
  assert.equal(staged, 0)
  const bytes = Buffer.alloc(30 * 1024 * 1024)
  await assert.rejects(generateImage({ ...config, onImageOutput: original => { staged++; assert.equal(original.length, bytes.length) } }, model, body,
    async () => new Response(json(bytes))), /模型返回的图片无效/)
  assert.equal(staged, 1)
})
