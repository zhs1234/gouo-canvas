import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { decodeImage, generateImage } from '../src/images.mjs'

const config = { gateway: 'http://fixture.invalid/v1', relayKey: 'fixture-only-secret' }
const model = { upstreamModelId: 'fixture-image', qualities: [], sizes: {}, operations: ['generate', 'edit'] }

for (const format of ['png', 'jpeg', 'webp']) test(`Sharp compatibility: ${format} references and generated results preserve bytes, format and dimensions`, async () => {
  const bytes = await sharp({ create: { width: 37, height: 23, channels: 4, background: '#7799bb88' } }).toFormat(format).toBuffer()
  const url = `data:image/${format};base64,${bytes.toString('base64')}`
  const decoded = await decodeImage(url)
  assert.equal(decoded.metadata.width, 37)
  assert.equal(decoded.metadata.height, 23)
  assert.equal(decoded.mimeType, 'image/' + format)
  assert.deepEqual(decoded.data, bytes)
  let calls = 0
  const result = await generateImage(config, model, { prompt: 'fixture', inputImages: [url] }, async (target, init) => {
    calls++
    assert.equal(target, 'http://fixture.invalid/v1/images/edits')
    const file = init.body.get('image[]')
    assert.equal(file.type, 'image/' + format)
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes)
    return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }))
  })
  assert.equal(calls, 1)
  assert.equal(result.url, url)
  assert.equal(result.width, 37)
  assert.equal(result.height, 23)
  assert.equal(result.mimeType, 'image/' + format)
})

test('Sharp compatibility: malformed bytes and disguised GIF/TIFF/AVIF cannot enter supported image paths', async () => {
  for (const format of ['gif', 'tiff', 'avif']) {
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#7799bb' } }).toFormat(format).toBuffer()
    await assert.rejects(decodeImage('data:image/png;base64,' + bytes.toString('base64')), /图片内容格式不支持/)
    await assert.rejects(generateImage(config, model, { prompt: 'fixture' }, async () => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }))), /模型返回格式不支持/)
  }
  await assert.rejects(decodeImage('data:image/png;base64,' + Buffer.from('not an image').toString('base64')), /图片内容无效/)
})

test('Sharp compatibility: reference byte and pixel limits still reject before any upstream request', async () => {
  const huge = await sharp({ create: { width: 6001, height: 4000, channels: 3, background: '#7799bb' } }).png().toBuffer()
  let calls = 0
  const never = async () => { calls++; throw new Error('must not call upstream') }
  await assert.rejects(generateImage(config, model, { prompt: 'fixture', inputImages: ['data:image/png;base64,' + huge.toString('base64')] }, never), /2400 万像素/)
  await assert.rejects(generateImage(config, model, { prompt: 'fixture', inputImages: ['data:image/png;base64,' + Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')] }, never), /8 MB/)
  assert.equal(calls, 0)
})
