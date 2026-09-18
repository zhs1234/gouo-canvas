export type ImageProtocol = 'openai-images' | 'openai-responses' | 'gemini-content' | 'gemini-interactions' | 'fal-queue' | 'provider-native'
export type ImageOperation = 'generate' | 'edit' | 'inpaint' | 'outpaint' | 'upscale' | 'remove-background'
export type ImageFormat = 'png' | 'jpeg' | 'webp'
export type Verification = 'pending' | 'contract-tested' | 'live-verified'

// Capabilities describe a tested subset, not an inferred list of everything a model might support.
export interface ModelCapabilities {
  operations: ImageOperation[]
  maxInputs: number
  maxOutputs: number
  qualities: string[]
  formats: ImageFormat[]
  transparency: boolean
  sizes: string[]
}
export interface PublicModel {
  id: string
  label: string
  protocol: ImageProtocol
  enabled: boolean
  verification: Verification
  capabilities: ModelCapabilities
}
export interface GenerationIntent {
  modelId: string
  operation: ImageOperation
  prompt: string
  inputAssetIds: string[]
  maskAssetId?: string
  count: number
  quality?: string
  size?: string
  format: ImageFormat
  transparent: boolean
}
export interface ValidationIssue { field: string; message: string }

export function validateIntent(model: PublicModel, intent: GenerationIntent): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (field: string, message: string) => issues.push({ field, message })
  const c = model.capabilities
  if (model.id !== intent.modelId) add('modelId', '模型不匹配')
  if (!model.enabled || model.verification !== 'live-verified') add('modelId', '该渠道模型尚未开放真实生成')
  if (!c.operations.includes(intent.operation)) add('operation', '该模型未验证此操作')
  if (!intent.prompt.trim() && !['upscale', 'remove-background'].includes(intent.operation)) add('prompt', '请输入提示词')
  if (!Number.isSafeInteger(intent.count) || intent.count < 1 || intent.count > c.maxOutputs) add('count', '输出数量超出已验证范围')
  if (intent.inputAssetIds.some((id) => !id.trim())) add('inputAssetIds', '素材标识不能为空')
  if (new Set(intent.inputAssetIds).size !== intent.inputAssetIds.length) add('inputAssetIds', '请勿重复选择同一素材')
  if (intent.inputAssetIds.length > c.maxInputs) add('inputAssetIds', '参考图数量超出已验证范围')
  if (intent.operation !== 'generate' && intent.inputAssetIds.length === 0) add('inputAssetIds', '此操作需要输入图片')
  if (intent.operation === 'generate' && intent.inputAssetIds.length > 0) add('operation', '参考图生成应使用 edit 操作')
  if (intent.operation === 'inpaint' && !intent.maskAssetId?.trim()) add('maskAssetId', '局部重绘需要蒙版')
  if (intent.maskAssetId && intent.operation !== 'inpaint') add('maskAssetId', '此操作不接受蒙版')
  if (intent.quality && !c.qualities.includes(intent.quality)) add('quality', '质量选项未被此渠道验证')
  if (intent.size && !c.sizes.includes(intent.size)) add('size', '尺寸未被此渠道验证')
  if (!c.formats.includes(intent.format)) add('format', '输出格式不受支持')
  if (intent.transparent && (!c.transparency || intent.format === 'jpeg')) add('transparent', '此组合不支持透明背景')
  return issues
}

export type JobStatus = 'queued' | 'running' | 'reconciling' | 'succeeded' | 'partially-succeeded' | 'failed' | 'canceled'
const transitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'failed', 'canceled'],
  running: ['reconciling', 'succeeded', 'partially-succeeded', 'failed'],
  reconciling: ['succeeded', 'partially-succeeded', 'failed'],
  succeeded: [], 'partially-succeeded': [], failed: [], canceled: [],
}
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return transitions[from].includes(to)
}
export interface JobSummary {
  id: string; projectId: string; status: JobStatus; outputAssetIds: string[]
  createdAt: string; updatedAt: string; errorCode?: string
}
export interface Project { id: string; title: string; revision: number; createdAt: string; updatedAt: string }
export interface Asset { id: string; mimeType: string; bytes: number; width: number; height: number; contentUrl: string }
export interface Plan { id: string; version: number; name: string; priceMinor: number; currency: string; monthlyUnits: number; storageBytes: number; concurrency: number }
export interface Subscription { id: string; planId: string; state: 'active' | 'expired' | 'canceled'; periodStart: string; periodEnd: string }
export interface UsageEntry { id: string; jobId: string; periodId: string; kind: 'reserve' | 'settle' | 'release'; units: number; idempotencyKey: string }
