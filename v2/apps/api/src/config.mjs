import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { validateNormalRouting } from './relay.mjs'
import { trialPolicySchema } from './trial-funding.mjs'

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
  const relayRoutingMode = z.enum(['pinned', 'model']).parse(env.GOUO_RELAY_ROUTING_MODE || 'pinned')
  let normalRoutingEvidence
  if (relayRoutingMode === 'model') {
    if (!env.GOUO_NORMAL_ROUTING_EVIDENCE_FILE) throw new Error('普通模型路由缺少 GOUO_NORMAL_ROUTING_EVIDENCE_FILE 人工核验记录')
    try { normalRoutingEvidence = JSON.parse(readFileSync(env.GOUO_NORMAL_ROUTING_EVIDENCE_FILE, 'utf8')) }
    catch { throw new Error('无法读取普通模型路由人工核验记录') }
    validateNormalRouting(normalRoutingEvidence, gateway.toString(), models)
  }
  const relayCredentialMode = z.enum(['personal', 'user-token']).parse(env.GOUO_RELAY_CREDENTIAL_MODE || 'personal')
  let userTokenQuotaCap, userTokenLifetimeSeconds
  if (relayCredentialMode === 'user-token') {
    if (new URL(env.GOUO_BACKEND_DEV_TARGET || gateway.origin).origin !== gateway.origin) throw new Error('每用户账号与扣费网关必须属于同一 New API 实例')
    if (env.GOUO_RELAY_API_KEY || env.GOUO_RELAY_API_KEY_FILE || env.GOUO_RELAY_OWNER_ID || relayRoutingMode !== 'model') throw new Error('每用户模式不能使用共享令牌、固定 owner 或管理员渠道后缀')
    userTokenQuotaCap = z.coerce.number().int().positive().max(2147483647).parse(env.GOUO_USER_TOKEN_QUOTA_CAP)
    userTokenLifetimeSeconds = z.coerce.number().int().min(60).max(31536000).parse(env.GOUO_USER_TOKEN_LIFETIME_SECONDS)
  }
  if (env.GOUO_RELAY_API_KEY && env.GOUO_RELAY_API_KEY_FILE) throw new Error('统一 relay 只能选择环境变量或密钥文件其中一种')
  let relayKey = env.GOUO_RELAY_API_KEY || ''
  if (env.GOUO_RELAY_API_KEY_FILE) {
    try { relayKey = readFileSync(env.GOUO_RELAY_API_KEY_FILE, 'utf8').trim() }
    catch { throw new Error('无法读取统一 relay 密钥文件，请检查挂载和权限') }
    if (!relayKey || /[\r\n]/.test(relayKey)) throw new Error('统一 relay 密钥文件内容无效')
  }
  if (relayRoutingMode === 'model' && /-\d+$/.test(relayKey)) throw new Error('普通模型路由需要无渠道后缀的基础令牌')
  const relayOwnerId = env.GOUO_RELAY_OWNER_ID ? Number(env.GOUO_RELAY_OWNER_ID) : undefined
  if (relayOwnerId !== undefined && (!Number.isSafeInteger(relayOwnerId) || relayOwnerId <= 0)) throw new Error('网关令牌所属账号 ID 无效')
  if (env.GOUO_ENABLE_GENERATION === 'true' && relayKey && relayOwnerId === undefined) throw new Error('启用个人 relay 生成前必须配置 GOUO_RELAY_OWNER_ID 为令牌所属账号 ID')
  let trial
  if (env.GOUO_ENABLE_TRIAL === 'true') {
    if (relayCredentialMode !== 'user-token' || relayRoutingMode !== 'model' || !env.GOUO_TRIAL_POLICY_FILE) throw new Error('注册试用需要每用户普通模型路由与批准的 GOUO_TRIAL_POLICY_FILE')
    trial = trialPolicySchema.parse(JSON.parse(readFileSync(env.GOUO_TRIAL_POLICY_FILE, 'utf8')))
    if (trial.gatewayOrigin !== gateway.origin || trial.sourceCommit !== normalRoutingEvidence.sourceCommit) throw new Error('注册试用必须绑定已核验的同一固定版本 New API 网关')
  }
  const accountInstanceId = env.GOUO_ACCOUNT_INSTANCE_ID ? z.string().uuid().parse(env.GOUO_ACCOUNT_INSTANCE_ID) : trial?.instanceId
  if (trial && accountInstanceId !== trial.instanceId) throw new Error('账号实例标识必须与批准试用实例一致')
  if (relayCredentialMode === 'user-token' && !accountInstanceId) throw new Error('每用户模式需要稳定的 GOUO_ACCOUNT_INSTANCE_ID；关闭试用不能复用另一实例的账号 ID')
  let tokenRenewalPolicy
  if (env.GOUO_ENABLE_TOKEN_RENEWAL === 'true') {
    if (relayCredentialMode !== 'user-token' || !env.GOUO_TOKEN_RENEWAL_POLICY_FILE) throw new Error('权限续用需要每用户模式及私有受控入口核验记录')
    tokenRenewalPolicy = z.object({ sourceCommit: z.literal(normalRoutingEvidence.sourceCommit), gatewayOrigin: z.literal(gateway.origin),
      instanceId: z.literal(accountInstanceId), operatorVerified: z.literal(true), relayIngress: z.literal('studio-only'),
      tokenWrites: z.literal('studio-only'), completeKeys: z.literal('studio-only'), redisEnabled: z.literal(false), batchUpdateEnabled: z.literal(false),
    }).strict().parse(JSON.parse(readFileSync(env.GOUO_TOKEN_RENEWAL_POLICY_FILE, 'utf8')))
  }
  return {
    models, gateway: gateway.toString().replace(/\/$/, ''),
    authOrigin: env.GOUO_BACKEND_DEV_TARGET || gateway.origin,
    relayKey,
    relayRoutingMode, normalRoutingEvidence,
    relayOwnerId, relayCredentialMode, userTokenQuotaCap, userTokenLifetimeSeconds, trial, accountInstanceId, tokenRenewalPolicy,
    allowGeneration: env.GOUO_ENABLE_GENERATION === 'true',
    ledgerPath: env.GOUO_STUDIO_LEDGER_PATH || fileURLToPath(new URL('../../../.local/studio-requests.sqlite', import.meta.url)),
  }
}
export function generationEnabled(config) {
  if (config.relayCredentialMode === 'user-token') return Boolean(config.allowGeneration && config.relayRoutingMode === 'model' && config.userTokenQuotaCap > 0 && config.userTokenLifetimeSeconds >= 60)
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
      description: m.kind === 'video' ? '后续接入视频生成' : m.availabilityReason ?? (isAvailable(config, m) ? '已配置并经过渠道验证' : '尚未配置或验证'),
    })),
  }
}
