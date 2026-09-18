import { writeFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
export function buildProbe(env, paid) {
  if (!paid) throw new Error('真实调用可能扣费；需要显式 --allow-paid')
  if (!env.IMAGE_PROBE_BASE_URL || !env.IMAGE_PROBE_MODEL || !env.IMAGE_PROBE_KEY) throw new Error('需要 IMAGE_PROBE_BASE_URL / IMAGE_PROBE_MODEL / IMAGE_PROBE_KEY')
  const url = new URL(env.IMAGE_PROBE_BASE_URL)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('仅接受不含凭据和查询参数的 HTTPS API 基址')
  if (url.pathname !== '/v1' && url.pathname !== '/v1/') throw new Error('本工具仅验证 OpenAI Images 协议；基址应以 /v1 结尾')
  url.pathname = '/v1/images/generations'
  return { url: url.toString(), body: { model: env.IMAGE_PROBE_MODEL, prompt: 'A plain blue ceramic cup on a white background, no text', n: 1 } }
}
export function summarizeResponse(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : []
  const images = data.filter((item) => item && ((typeof item.b64_json === 'string' && item.b64_json.length > 0) || (typeof item.url === 'string' && /^https:\/\//.test(item.url))))
  const usage = {}
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) if (Number.isFinite(payload?.usage?.[key])) usage[key] = payload.usage[key]
  return { imageCount: images.length, usage }
}
async function main() {
  const config = buildProbe(process.env, process.argv.includes('--allow-paid'))
  const start = Date.now()
  const response = await fetch(config.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000),
    headers: { Authorization: `Bearer ${process.env.IMAGE_PROBE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(config.body),
  })
  const payload = await response.json()
  const summary = summarizeResponse(payload)
  const passed = response.ok && summary.imageCount > 0
  const report = { checkedAt: new Date().toISOString(), modelId: config.body.model, httpStatus: response.status, durationMs: Date.now() - start, passed, ...summary }
  await mkdir(new URL('../.reports/', import.meta.url), { recursive: true })
  await writeFile(new URL('../.reports/image-probe.json', import.meta.url), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log('No keys, prompt text, raw provider errors or image data were written to the report. A single generation is not full compatibility certification.')
  if (!passed) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('探测失败：请检查网络、API 基址、模型 ID、密钥和响应格式。为避免泄露密钥，不输出原始错误。'); process.exitCode = 1 })
