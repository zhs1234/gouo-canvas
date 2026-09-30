import sharp from 'sharp'
export class StudioError extends Error {
  constructor(message, status = 422) { super(message); this.status = status }
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
  const headers = { Authorization: `Bearer ${config.relayKey}` }
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
  const response = await fetcher(`${config.gateway}/images/${operation === 'edit' ? 'edits' : 'generations'}`, {
    method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new StudioError(`图片网关返回 HTTP ${response.status}，未自动重试`, 502)
  const raw = await response.json()
  const encoded = raw.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || !encoded || encoded.length > 40 * 1024 * 1024) throw new StudioError('该渠道未返回支持的内嵌图片；请验证返回协议', 502)
  const bytes = Buffer.from(encoded, 'base64')
  let metadata
  try { metadata = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata() } catch { throw new StudioError('模型返回的图片无效', 502) }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new StudioError('模型返回格式不支持', 502)
  const mimeType = `image/${metadata.format}`
  return { url: `data:${mimeType};base64,${encoded}`, prompt, mimeType, width: metadata.width, height: metadata.height }
}
