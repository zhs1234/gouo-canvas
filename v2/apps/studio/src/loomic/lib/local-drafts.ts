import { get, set, del, entries } from 'idb-keyval'
import type { CanvasDetail, ChatMessage, ChatSessionSummary } from '../shared'

export type Draft = {
  canvas: CanvasDetail
  sessions: ChatSessionSummary[]
  messages: Record<string, ChatMessage[]>
  thumbnail?: Blob
  updatedAt?: string
}
const pending = new Map<string, Promise<unknown>>()
const deleted = new Set<string>()
const prefix = 'gouo:loomic:v1:'
export function draftKey(owner: string, canvasId: string) {
  if (!/^local:(guest|[1-9]\d*)$/.test(owner) || !/^[\w-]{1,80}$/.test(canvasId)) throw new Error('本地草稿标识无效')
  return `${prefix}${owner}:${canvasId}`
}
export async function readDraft(owner: string, canvasId: string): Promise<Draft> {
  const key = draftKey(owner, canvasId)
  if (deleted.has(key)) throw new Error('画布已删除')
  await pending.get(key)
  return (await get<Draft>(key)) ?? {
    canvas: { id: canvasId, projectId: canvasId, name: '未命名创作', content: { elements: [], appState: {}, files: {} } },
    sessions: [], messages: {},
  }
}
export async function changeDraft(owner: string, canvasId: string, change: (draft: Draft) => void) {
  const key = draftKey(owner, canvasId)
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if (deleted.has(key)) throw new Error('画布已删除')
    const draft = (await get<Draft>(key)) ?? {
      canvas: { id: canvasId, projectId: canvasId, name: '未命名创作', content: { elements: [], appState: {}, files: {} } },
      sessions: [], messages: {},
    }
    change(draft)
    draft.updatedAt = new Date().toISOString()
    await set(key, draft)
    window.dispatchEvent(new CustomEvent('gouo:draft-saved', { detail: { owner, canvasId } }))
    return draft
  })
  pending.set(key, next)
  try { return await next } finally { if (pending.get(key) === next) pending.delete(key) }
}
export type LocalProjectSummary = { id: string; name: string; thumbnailUrl: string | null; primaryCanvas: { id: string }; updatedAt: string }
export async function listDrafts(owner: string): Promise<LocalProjectSummary[]> {
  const start = `${prefix}${owner}:`
  return (await entries<string, Draft>()).filter(([key]) => key.startsWith(start)).map(([, draft]) => ({
    id: draft.canvas.id, name: draft.canvas.name, primaryCanvas: { id: draft.canvas.id },
    thumbnailUrl: draft.thumbnail ? URL.createObjectURL(draft.thumbnail) : null,
    updatedAt: draft.updatedAt ?? new Date(0).toISOString(),
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function deleteDraft(owner: string, id: string) {
  const key = draftKey(owner, id)
  deleted.add(key)
  await pending.get(key)?.catch(() => undefined)
  try { await del(key) } catch (error) { deleted.delete(key); throw error }
}
const sessionCanvas = new Map<string, string>()
export function rememberSessions(owner: string, canvasId: string, sessions: ChatSessionSummary[]) {
  for (const session of sessions) sessionCanvas.set(`${owner}:${session.id}`, canvasId)
}
export function canvasForSession(owner: string, sessionId: string) {
  const canvasId = sessionCanvas.get(`${owner}:${sessionId}`)
  if (!canvasId) throw new Error('本地会话尚未加载')
  return canvasId
}
