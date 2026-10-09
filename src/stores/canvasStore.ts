import { create } from 'zustand'
import type { CanvasProject } from '../lib/canvas/types'
import type { CanvasAgentSnapshot } from '../lib/canvas/agentOps'
import { getAllCanvasProjects, putCanvasProject } from '../lib/db'
import { applyCanvasAgentOps } from '../lib/canvas/agentOps'
import { referencedCanvasImageIds, serializeCanvasProject, validateCanvasProject, validateCanvasTitle } from '../lib/canvas/document'
import { registerDocumentImageReferences } from '../lib/documentAssets'
import { isStorageScopeCurrent } from '../lib/storageScope'

type History = { past: CanvasProject[]; future: CanvasProject[] }
interface CanvasState {
  projects: CanvasProject[]
  hydrated: boolean
  error: string | null
  selectedNodeIds: Record<string, string[]>
  histories: Record<string, History>
  hydrate: () => Promise<void>
  createProject: (title?: string) => Promise<CanvasProject>
  updateProject: (id: string, patch: Partial<CanvasProject>, opts?: { history?: boolean; expectedRevision?: number }) => Promise<CanvasProject>
  renameProject: (id: string, title: string) => Promise<CanvasProject>
  hideProject: (id: string, hidden?: boolean) => Promise<CanvasProject>
  saveProject: (id: string) => Promise<void>
  setSelection: (id: string, selectedIds: string[]) => void
  getSnapshot: (id: string) => CanvasAgentSnapshot
  applyOperations: (id: string, ops: unknown, expectedRevision?: number) => Promise<CanvasProject>
  undo: (id: string) => Promise<void>
  redo: (id: string) => Promise<void>
  checkpoint: (id: string) => void
  getReferencedImageIds: () => string[]
}

let hydration: Promise<void> | null = null
let saves: Promise<unknown> = Promise.resolve()
const persisted = new Map<string, { revision: number; fingerprint: string }>()

function contentFingerprint(project: CanvasProject) {
  const { cloudRevision: _revision, cloudSyncStatus: _status, cloudSyncError: _error, ...content } = serializeCanvasProject(project)
  return JSON.stringify(content)
}

export function markCanvasPersisted(project: CanvasProject) {
  const previous = persisted.get(project.id)
  if (previous && previous.revision > project.revision) return
  persisted.set(project.id, { revision: project.revision, fingerprint: contentFingerprint(project) })
}

const save = (project: CanvasProject) => {
  saves = saves
    .catch(() => {})
    .then(async () => {
      if (!isStorageScopeCurrent()) throw new Error('账号已切换，请刷新后再保存画布')
      const current = persisted.get(project.id)
      const serialized = serializeCanvasProject(project)
      if (current && current.revision >= project.revision) {
        if (current.fingerprint === contentFingerprint(project)) return
        throw new Error('画布已在其他位置更新，请导出本地内容后重新打开')
      }
      await putCanvasProject(serialized, current?.revision ?? 0)
      markCanvasPersisted(project)
    })
  return saves
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  projects: [],
  hydrated: false,
  error: null,
  selectedNodeIds: {},
  histories: {},
  hydrate: () => {
    if (get().hydrated) return Promise.resolve()
    if (hydration) return hydration
    hydration = getAllCanvasProjects()
      .then((projects) => {
        persisted.clear()
        for (const project of projects) {
          validateCanvasProject(project)
          markCanvasPersisted(project)
        }
        set({ projects, hydrated: true, error: null })
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : '读取画布失败'
        set({ error })
        console.error('读取画布失败', err)
        throw err
      })
      .finally(() => {
        hydration = null
      })
    return hydration
  },
  createProject: async (title = '未命名画布') => {
    validateCanvasTitle(title)
    await get().hydrate()
    const now = Date.now()
    const project: CanvasProject = {
      id: crypto.randomUUID(),
      title: title.trim() || '未命名画布',
      schemaVersion: 1,
      revision: 1,
      nodes: [],
      connections: [],
      viewport: { x: 200, y: 180, k: 1 },
      backgroundMode: 'lines',
      showImageInfo: false,
      createdAt: now,
      updatedAt: now,
      cloudSyncStatus: 'pending',
    }
    validateCanvasProject(project)
    await save(project)
    set((state) => ({ projects: [project, ...state.projects], error: null }))
    return project
  },
  updateProject: async (id, patch, opts = {}) => {
    const state = get()
    const current = state.projects.find((project) => project.id === id)
    if (!current) throw new Error('画布不存在，请重新打开画布列表')
    if (patch.title !== undefined && patch.title !== current.title) validateCanvasTitle(patch.title)
    if (opts.expectedRevision !== undefined && current.revision !== opts.expectedRevision) throw new Error('画布已被修改，请读取最新版本后重试')
    const project = {
      ...current,
      ...patch,
      id,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      cloudSyncStatus: 'pending' as const,
      cloudSyncError: undefined,
    }
    validateCanvasProject(project)
    if (opts.history !== false) get().checkpoint(id)
    set((state) => ({ projects: state.projects.map((item) => (item.id === id ? project : item)) }))
    try {
      await save(project)
      set({ error: null })
    } catch (err) {
      set({ error: '画布尚未保存，请重试或立即导出备份' })
      console.error('保存画布失败', err)
      throw err
    }
    return project
  },
  renameProject: (id, title) => get().updateProject(id, { title: title.trim() || '未命名画布' }),
  hideProject: (id, hidden = true) => get().updateProject(id, { hiddenAt: hidden ? Date.now() : undefined }),
  saveProject: async (id) => {
    const project = get().projects.find((item) => item.id === id)
    if (!project) throw new Error('画布不存在')
    await save(project)
    set({ error: null })
  },
  setSelection: (id, selectedIds) => set((state) => ({ selectedNodeIds: { ...state.selectedNodeIds, [id]: selectedIds } })),
  getSnapshot: (id) => {
    const project = get().projects.find((item) => item.id === id)
    if (!project || project.hiddenAt) throw new Error('画布不存在或已在回收站')
    return structuredClone({ ...serializeCanvasProject(project), projectId: id, selectedNodeIds: get().selectedNodeIds[id] || [] })
  },
  applyOperations: async (id, ops, expectedRevision) => {
    await get().hydrate()
    const current = get().getSnapshot(id)
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('画布版本冲突，请重新读取画布')
    const next = applyCanvasAgentOps(current, ops)
    const project = await get().updateProject(
      id,
      { nodes: next.nodes, connections: next.connections, viewport: next.viewport },
      { expectedRevision: current.revision },
    )
    get().setSelection(id, next.selectedNodeIds)
    return project
  },
  checkpoint: (id) => {
    const project = get().projects.find((item) => item.id === id)
    if (!project) return
    set((state) => ({
      histories: { ...state.histories, [id]: { past: [...(state.histories[id]?.past || []), structuredClone(project)].slice(-50), future: [] } },
    }))
  },
  undo: async (id) => {
    const history = get().histories[id]
    const previous = history?.past[history.past.length - 1]
    const current = get().projects.find((item) => item.id === id)
    if (!previous || !current) return
    await get().updateProject(id, previous, { history: false })
    set((state) => ({ histories: { ...state.histories, [id]: { past: history.past.slice(0, -1), future: [current, ...history.future].slice(0, 50) } } }))
  },
  redo: async (id) => {
    const history = get().histories[id]
    const next = history?.future[0]
    const current = get().projects.find((item) => item.id === id)
    if (!next || !current) return
    await get().updateProject(id, next, { history: false })
    set((state) => ({ histories: { ...state.histories, [id]: { past: [...history.past, current].slice(-50), future: history.future.slice(1) } } }))
  },
  getReferencedImageIds: () => {
    const state = get()
    const projects = [...state.projects, ...Object.values(state.histories).flatMap((history) => [...history.past, ...history.future])]
    return [...new Set(projects.flatMap(referencedCanvasImageIds))]
  },
}))

registerDocumentImageReferences(() => useCanvasStore.getState().getReferencedImageIds())
