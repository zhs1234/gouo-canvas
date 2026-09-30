// Loomic UI boundary: IndexedDB documents, authenticated /api/studio/* model requests.
import type { CanvasDetail, ChatMessage, ChatMessageCreateRequest, ContentBlock } from '../shared'
import { request } from '../../api'
import { readDraft, changeDraft, rememberSessions, canvasForSession, deleteDraft } from './local-drafts'
import { fetchCatalog, type GatewayModel } from './gateway'
import { billingChanged, type StudioUsage } from './billing'
export class ApiAuthError extends Error {}
export class ApiApplicationError extends Error {
  constructor(public code: string, message: string) { super(message) }
}
export type ImageModelInfo = GatewayModel & { creditCost?: number; minTier?: string; iconUrl?: string }
export type VideoModelInfo = ImageModelInfo & {
  capabilities?: { textToVideo: boolean; imageToVideo: boolean; videoToVideo: boolean; audio: boolean }
  limits?: { maxDuration: number; allowedDurations?: number[]; maxResolution: '480p' | '720p' | '1080p' | '2160p'; maxInputImages: number }
  pricing?: { currency: 'CNY'; billingUnit: 'generated_second'; providerPointsName: string; evidenceDate: string; rates: Array<{ resolution: '720p' | '1080p'; displayResolution: string; providerPointsPerSecond: number; cnyPerSecond: { min: number; max: number } }> }
}
export type GenerateImageResponse = { url: string; prompt: string; mimeType: string; width: number; height: number }
export type GenerateVideoResponse = GenerateImageResponse & { assetId: string; durationSeconds: number }
export async function fetchCanvas(owner: string, id: string): Promise<{ canvas: CanvasDetail }> { return { canvas: (await readDraft(owner, id)).canvas } }
export async function fetchProject(owner: string, id: string) { return { project: { id, name: (await readDraft(owner, id)).canvas.name, brand_kit_id: null } } }
export async function saveCanvas(owner: string, id: string, content: CanvasDetail['content']) { await changeDraft(owner, id, d => { d.canvas.content = content }) }
export async function updateProject(owner: string, id: string, data: { name?: string }) {
  await changeDraft(owner, id, d => { if (data.name) d.canvas.name = data.name.trim().slice(0, 100) })
}
export async function deleteProject(owner: string, id: string) {
  await deleteDraft(owner, id)
}
export async function uploadThumbnail(owner: string, id: string, thumbnail: Blob) { await changeDraft(owner, id, d => { d.thumbnail = thumbnail }) }
export async function fetchSessions(owner: string, id: string) {
  const draft = await changeDraft(owner, id, d => {
    if (!d.sessions.length) d.sessions.push({ id: crypto.randomUUID(), title: '新对话', updatedAt: new Date().toISOString() })
  })
  rememberSessions(owner, id, draft.sessions)
  return { sessions: draft.sessions }
}
export async function createSession(owner: string, id: string, title = '新对话') {
  const session = { id: crypto.randomUUID(), title, updatedAt: new Date().toISOString() }
  const draft = await changeDraft(owner, id, d => { d.sessions.unshift(session) })
  rememberSessions(owner, id, draft.sessions)
  return { session }
}
export async function updateSessionTitle(owner: string, id: string, title: string) {
  await changeDraft(owner, canvasForSession(owner, id), d => { const s = d.sessions.find(s => s.id === id); if (s) s.title = title.slice(0, 80) })
}
export async function deleteSession(owner: string, id: string) {
  await changeDraft(owner, canvasForSession(owner, id), d => { d.sessions = d.sessions.filter(s => s.id !== id); delete d.messages[id] })
}
export async function fetchMessages(owner: string, id: string): Promise<{ messages: ChatMessage[] }> {
  return { messages: (await readDraft(owner, canvasForSession(owner, id))).messages[id] ?? [] }
}
export async function saveMessage(owner: string, id: string, data: ChatMessageCreateRequest) {
  const message: ChatMessage = { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  await changeDraft(owner, canvasForSession(owner, id), d => { (d.messages[id] ??= []).push(message) })
  return { message }
}
export async function replaceMessages(owner: string, id: string, messages: Array<{ id: string; role: 'user' | 'assistant'; contentBlocks: ContentBlock[] }>) {
  await changeDraft(owner, canvasForSession(owner, id), d => { d.messages[id] = messages.map(m => ({ ...m, content: '', createdAt: new Date().toISOString() })) })
}
export async function uploadFile(owner: string, file: File, projectId?: string) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('请选择 15 MB 以内的 PNG、JPEG 或 WebP 图片')
  const bitmap = await createImageBitmap(file); const pixels = bitmap.width * bitmap.height; bitmap.close()
  if (pixels > 24_000_000) throw new Error('图片超过 2400 万像素，请先缩小尺寸')
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file)
  })
  return { url, asset: { id: crypto.randomUUID(), bucket: 'project-assets' as const, objectPath: file.name, mimeType: file.type, byteSize: file.size, workspaceId: owner, projectId: projectId ?? null, createdAt: new Date().toISOString() } }
}
export async function fetchModels() {
  const models = (await fetchCatalog()).models
    .filter(m => m.kind === 'chat' && m.accessible)
  return { models: models.map(m => ({ id: m.id, name: m.displayName, provider: m.provider })) }
}
export async function fetchImageModels(): Promise<{ models: ImageModelInfo[] }> { return { models: (await fetchCatalog()).models.filter(m => m.kind === 'image') } }
export async function fetchVideoModels(): Promise<{ models: VideoModelInfo[] }> { return { models: (await fetchCatalog()).models.filter(m => m.kind === 'video') } }
export async function fetchWorkspaceSkills(_owner: string) { return { skills: [] as Array<{ id: string; name: string; slug: string; description: string; enabled: boolean }> } }
export async function generateImageDirect(_owner: string, prompt: string, options?: { model?: string; aspectRatio?: string; quality?: string; inputImages?: string[] }, signal?: AbortSignal) {
  let usage: StudioUsage | undefined
  try {
    const result = await request<GenerateImageResponse & { usage?: StudioUsage }>('/api/studio/images', { method: 'POST', signal, headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ prompt, ...options }) })
    usage = result.usage
    return result
  } finally { billingChanged(_owner, usage) }
}
export async function generateVideoDirect(_owner: string, _prompt: string, _options?: { model?: string; duration?: number; resolution?: string; aspectRatio?: string; inputImages?: string[] }): Promise<GenerateVideoResponse> {
  throw new ApiApplicationError('video_not_enabled', '视频生成将在后续接入；当前可以使用图片画布')
}
