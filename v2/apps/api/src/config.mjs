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
  channelId: z.number().int().positive().optional(),
  toolCalling: z.boolean().default(false),
  maxChatCalls: z.number().int().min(1).max(3).default(3),
  maxTokens: z.number().int().min(64).max(4096).default(2000),
}).strict()
export function loadConfig(env = process.env) {
  const file = env.GOUO_STUDIO_MODELS_FILE || fileURLToPath(new URL('../../../config/loomic.models.example.json', import.meta.url))
  const models = z.array(model).parse(JSON.parse(readFileSync(file, 'utf8')).models)
  if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('模型目录有重复 ID')
  const gateway = new URL(env.GOUO_GATEWAY_BASE_URL || 'http://127.0.0.1:3000/v1')
  if (!['http:', 'https:'].includes(gateway.protocol) || gateway.username || gateway.password || gateway.search || gateway.hash) throw new Error('网关地址格式无效')
  if (env.GOUO_RELAY_API_KEY && env.GOUO_RELAY_API_KEY_FILE) throw new Error('统一 relay 只能选择环境变量或密钥文件其中一种')
  let relayKey = env.GOUO_RELAY_API_KEY || ''
  if (env.GOUO_RELAY_API_KEY_FILE) {
    try { relayKey = readFileSync(env.GOUO_RELAY_API_KEY_FILE, 'utf8').trim() }
    catch { throw new Error('无法读取统一 relay 密钥文件，请检查挂载和权限') }
    if (!relayKey || /[\r\n]/.test(relayKey)) throw new Error('统一 relay 密钥文件内容无效')
  }
  const relayOwnerId = env.GOUO_RELAY_OWNER_ID ? Number(env.GOUO_RELAY_OWNER_ID) : undefined
  if (relayOwnerId !== undefined && (!Number.isSafeInteger(relayOwnerId) || relayOwnerId <= 0)) throw new Error('网关令牌所属账号 ID 无效')
  if (env.GOUO_ENABLE_GENERATION === 'true' && relayKey && relayOwnerId === undefined) throw new Error('启用个人 relay 生成前必须配置 GOUO_RELAY_OWNER_ID 为令牌所属账号 ID')
  return {
    models, gateway: gateway.toString().replace(/\/$/, ''),
    authOrigin: env.GOUO_BACKEND_DEV_TARGET || gateway.origin,
    relayKey,
    relayOwnerId,
    allowGeneration: env.GOUO_ENABLE_GENERATION === 'true',
    ledgerPath: env.GOUO_STUDIO_LEDGER_PATH || fileURLToPath(new URL('../../../.local/studio-requests.sqlite', import.meta.url)),
  }
}
export function generationEnabled(config) {
  return Boolean(config.relayKey && config.allowGeneration && Number.isSafeInteger(config.relayOwnerId) && config.relayOwnerId > 0)
}
export function isAvailable(config, model) {
  return Boolean(generationEnabled(config) && model.enabled && model.verification === 'live-verified' && model.kind !== 'video')
}
export function catalog(config) {
  return {
    generationEnabled: generationEnabled(config),
    conversationMode: config.models.some(m => m.kind === 'chat' && isAvailable(config, m)) ? 'agent'
      : config.models.some(m => m.kind === 'image' && isAvailable(config, m)) ? 'image' : 'unavailable',
    models: config.models.map(m => ({ id: m.id, displayName: m.displayName, kind: m.kind, accessible: isAvailable(config, m),
      provider: 'New API', qualities: m.qualities ?? [], aspectRatios: Object.keys(m.sizes ?? {}),
      ...(m.kind === 'image' ? { operations: m.operations } : {}),
      description: m.kind === 'video' ? '后续接入视频生成' : isAvailable(config, m) ? '已配置并经过渠道验证' : '尚未配置或验证',
    })),
  }
}
