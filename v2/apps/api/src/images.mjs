import sharp from 'sharp'
import { StudioError } from './images-error.mjs'
import { relayKey, recordGatewayResponse } from './relay.mjs'
export { StudioError } from './images-error.mjs'
async function readImageJSON(response) {
  const limit = 48 * 1024 * 1024, length = response.headers.get('content-length')
  if ((!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity')
    && length && /^\d+$/.test(length) && Number(length) > limit) {
    await response.body?.cancel().catch(() => {})
    throw new StudioError('图片网关响应超过安全大小限制，未自动重试', 502)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new StudioError('图片网关未返回有效响应，未自动重试', 502)
  const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel().catch(() => {}); throw new StudioError('图片网关响应超过安全大小限制，未自动重试', 502) }
      chunks.push(value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))
  } catch (error) {
    if (error instanceof StudioError) throw error
    throw new StudioError('图片网关响应不完整或协议无效，未自动重试', 502)
  } finally { reader.releaseLock() }
}
export async function decodeImage(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > 12 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataURL)) throw new StudioError('仅接受本地 PNG、JPEG、WebP 图片，单张不超过 8 MB')
  const data = Buffer.from(dataURL.slice(dataURL.indexOf(',') + 1), 'base64')
  if (data.length > 8 * 1024 * 1024) throw new StudioError('参考图超过 8 MB')
  let metadata
  try { metadata = await sharp(data, { limitInputPixels: 24_000_000 }).metadata() } catch { throw new StudioError('图片内容无效或超过 2400 万像素') }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height) throw new StudioError('图片内容格式不支持')
  return { data, metadata, mimeType: `image/${metadata.format}` }
}
export async function generateImage(config, model, payload, fetcher = fetch) {
  const { prompt, quality, aspectRatio, inputImages = [] } = payload
  if (quality && !model.qualities.includes(quality)) throw new StudioError('该渠道未验证所选质量参数')
  if (aspectRatio && !model.sizes[aspectRatio]) throw new StudioError('该渠道未验证所选画面比例')
  const operation = inputImages.length ? 'edit' : 'generate'
  if (!model.operations.includes(operation)) throw new StudioError('该模型当前不支持参考图编辑')
  const common = { model: model.upstreamModelId, prompt, n: 1, ...(quality ? { quality } : {}),
    ...(aspectRatio ? { size: model.sizes[aspectRatio] } : {}), ...(model.responseFormat ? { response_format: model.responseFormat } : {}) }
  const headers = { Authorization: `Bearer ${relayKey(config, model)}` }
  let body
  if (operation === 'edit') {
    body = new FormData()
    for (const [key, value] of Object.entries(common)) body.append(key, String(value))
    for (const input of inputImages) {
      const image = await decodeImage(input)
      body.append('image[]', new Blob([image.data], { type: image.mimeType }), `reference.${image.metadata.format}`)
    }
  } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(common) }
  // No retry or fallback: a timeout may already have consumed model quota.
  let response
  await config.onGatewayRequest?.({ kind: 'image', modelId: model.id })
  try {
    response = await fetcher(`${config.gateway}/images/${operation === 'edit' ? 'edits' : 'generations'}`, {
      method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    // 连接丢失不能证明未扣费，智能体总费用需保留这次未知调用。
    config.onGatewayResponse?.({ requestId: null, status: 0 })
    throw error
  }
  recordGatewayResponse(config, response)
  if (!response.ok) throw new StudioError(`图片网关返回 HTTP ${response.status}，未自动重试`, 502)
  const raw = await readImageJSON(response)
  const encoded = raw?.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !encoded || encoded.length > 40 * 1024 * 1024) throw new StudioError('该渠道未返回支持的内嵌图片；请验证返回协议', 502)
  const bytes = Buffer.from(encoded, 'base64')
  if (config.onImageOutput) {
    if (!bytes.length || bytes.length > 30 * 1024 * 1024 || bytes.toString('base64') !== encoded) throw new StudioError('模型返回图片编码或大小无效，未自动重试', 502)
    // This optional job-only sink must commit the original raster bytes before
    // Sharp reads a header. Provider JSON/headers and credentials never enter it.
    await config.onImageOutput(bytes)
  }
  let metadata
  try { metadata = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata() } catch { throw new StudioError('模型返回的图片无效', 502) }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new StudioError('模型返回格式不支持', 502)
  const mimeType = `image/${metadata.format}`
  return { url: `data:${mimeType};base64,${encoded}`, prompt, mimeType, width: metadata.width, height: metadata.height }
}
