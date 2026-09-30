import { request } from '../api'
export type StudioDocument = { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown>; processedSourceIds?: string[] }
export type StudioProject = { id: string; title: string; revision: number; document: StudioDocument; sourceAssetId?: string; createdAt: string; updatedAt: string }
export type StudioProjectSummary = Omit<StudioProject, 'document'>
export type StudioAsset = { id: string; mimeType: string; width: number; height: number; bytes: number; sha256: string; createdAt: string; dataURL?: string }
export type RunAssetReference = { runId: string; toolCallId: string; artifactIndex: number }
export const listProjects = async (offset = 0, signal?: AbortSignal) => {
  const result = await request<{ items: StudioProjectSummary[]; nextOffset: number | null }>(`/api/studio/projects?offset=${offset}`, { signal })
  return { items: result.items, projects: result.items, nextOffset: result.nextOffset }
}
export const createProject = (title?: string, signal?: AbortSignal) => request<StudioProject>('/api/studio/projects', { method: 'POST', signal, body: JSON.stringify({ title }) })
export const getProject = (id: string, signal?: AbortSignal) => request<StudioProject>(`/api/studio/projects/${encodeURIComponent(id)}`, { signal })
export const saveProject = (id: string, expectedRevision: number, changes: { document?: StudioDocument; title?: string }, signal?: AbortSignal) => request<StudioProject>(`/api/studio/projects/${encodeURIComponent(id)}`, { method: 'PATCH', signal, body: JSON.stringify({ expectedRevision, ...changes }) })
export const materializeAsset = (reference: RunAssetReference, signal?: AbortSignal) => request<StudioAsset>('/api/studio/assets/from-run', { method: 'POST', signal, body: JSON.stringify(reference) })
export const getAsset = (id: string, signal?: AbortSignal) => request<StudioAsset>(`/api/studio/assets/${encodeURIComponent(id)}`, { signal })
export const openProjectFromAsset = (assetId: string, signal?: AbortSignal) => request<StudioProject>('/api/studio/projects/from-asset', { method: 'POST', signal, body: JSON.stringify({ assetId }) })
