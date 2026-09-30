import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const model = z.object({
  id: z.string().min(1).max(100), displayName: z.string().min(1).max(100),
  kind: z.enum(['chat', 'image', 'video']), upstreamModelId: z.string().min(1).max(100),
  enabled: z.boolean().default(false), verification: z.enum(['pending', 'contract-tested', 'live-verified']).default('pending'),
  qualities: z.array(z.string()).default([]), sizes: z.record(z.string()).default({}),
  operations: z.array(z.enum(['generate', 'edit'])).default(['generate']),
  vision: z.boolean().default(false), responseFormat: z.enum(['b64_json']).optional(),
}).strict()
export function loadConfig(env = process.env) {
  const file = env.GOUO_STUDIO_MODELS_FILE || fileURLToPath(new URL('../../../config/loomic.models.example.json', import.meta.url))
  const models = z.array(model).parse(JSON.parse(readFileSync(file, 'utf8')).models)
  if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('模型目录有重复 ID')
  const gateway = new URL(env.GOUO_GATEWAY_BASE_URL || 'http://127.0.0.1:3000/v1')
  if (!['http:', 'https:'].includes(gateway.protocol) || gateway.username || gateway.password || gateway.search || gateway.hash) throw new Error('网关地址格式无效')
  return {
    models, gateway: gateway.toString().replace(/\/$/, ''),
    authOrigin: env.GOUO_BACKEND_DEV_TARGET || gateway.origin,
    relayKey: env.GOUO_RELAY_API_KEY || '',
    allowGeneration: env.GOUO_ENABLE_GENERATION === 'true',
    ledgerPath: env.GOUO_STUDIO_LEDGER_PATH || fileURLToPath(new URL('../../../.local/studio-requests.sqlite', import.meta.url)),
  }
}
export function isAvailable(config, model) {
  return Boolean(config.relayKey && config.allowGeneration && model.enabled && model.verification === 'live-verified' && model.kind !== 'video')
}
export function catalog(config) {
  return {
    generationEnabled: config.allowGeneration && Boolean(config.relayKey),
    models: config.models.map(m => ({ id: m.id, displayName: m.displayName, kind: m.kind, accessible: isAvailable(config, m),
      provider: 'New API', qualities: m.qualities ?? [], aspectRatios: Object.keys(m.sizes ?? {}),
      ...(m.kind === 'image' ? { operations: m.operations } : {}),
      description: m.kind === 'video' ? '后续接入视频生成' : isAvailable(config, m) ? '已配置并经过渠道验证' : '尚未配置或验证',
    })),
  }
}
