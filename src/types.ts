// ===== 设置 =====

export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'

export interface AppSettings {
  /** 按账号记忆选择的图片模型；报价只用于提交确认，最终由服务端结算。 */
  model: string
  gouoModelSelected?: boolean
  gouoPriceVersion?: string
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  alwaysShowRetryButton: boolean
  taskCompletionNotification: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  // 批量下载多张图片时打包为 ZIP；关闭时逐张下载
  zipBatchDownload: boolean
  // 用户停用的内置技能名称
  disabledSkills: string[]
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
  transparent_output: boolean
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
  transparent_output: false,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

type TaskStatus = 'running' | 'done' | 'error'

export interface TaskRecord {
  source?: { kind: 'generate' | 'canvas' | 'agent'; projectId?: string; nodeId?: string; conversationId?: string }
  requestId?: string
  id: string
  prompt: string
  params: TaskParams
  /** 生成时使用的模型 ID */
  apiModel?: string
  gouoPriceVersion?: string
  gouoPriceCNY?: number
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 是否启用透明背景后处理 */
  transparentOutput?: boolean
  /** 实际发送给 API 的透明背景辅助提示词 */
  transparentPrompt?: string
  /** 透明背景后处理前的原始输出图片 id，顺序对应 outputImages */
  transparentOriginalImages?: string[]
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 并发多图中失败的输出槽位，requestIndex 为从 0 开始的请求序号 */
  outputErrors?: Array<{ requestIndex: number; error: string }>
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 所属收藏夹 ID 列表 */
  favoriteCollectionIds?: string[]
  /** 云端作品库任务 ID */
  cloudId?: string
  /** 云端隐藏时间，非零时显示在回收站 */
  cloudHiddenAt?: number
}

export interface FavoriteCollection {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  canvasProjects?: import('./lib/canvas/types').CanvasProject[]
  agentConversations?: import('./lib/agent/types').AgentConversation[]
  skills?: import('./lib/skills/types').SkillDocument[]
  version: number
  exportedAt: string
  settings?: AppSettings
  tasks?: TaskRecord[]
  favoriteCollections?: FavoriteCollection[]
  defaultFavoriteCollectionId?: string | null
  /** imageId → 图片信息 */
  imageFiles?: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
    width?: number
    height?: number
  }>
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<string, {
    path: string
    width?: number
    height?: number
    thumbnailVersion?: number
  }>
}

export type { CanvasProject } from './lib/canvas/types'
export type { AgentConversation } from './lib/agent/types'
