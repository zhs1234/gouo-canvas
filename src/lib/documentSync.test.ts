import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation, CanvasProject } from '../types'
import type { GouoCloudAsset } from './gouoBackend'

let projects: Map<string, CanvasProject>
let conversations: Map<string, AgentConversation>
let meta: Map<string, unknown>
let scopeCurrent: boolean
let canvasState: { projects: CanvasProject[] }
let agentState: { conversations: AgentConversation[] }
let backend: ReturnType<typeof vi.fn>
let upload: ReturnType<typeof vi.fn>
let download: ReturnType<typeof vi.fn>
let beforeSave: ((doc: CanvasProject) => Promise<void>) | undefined

const project = (id = 'project'): CanvasProject => ({
  id,
  title: '本地画布',
  schemaVersion: 1,
  revision: 1,
  nodes: [],
  connections: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  showImageInfo: false,
  createdAt: 1,
  updatedAt: 1,
})
const asset: GouoCloudAsset = {
  id: 'cloud-image',
  client_image_id: 'image',
  sha256: 'hash',
  mime_type: 'image/png',
  file_size: 1,
  content_url: '/api/gouo/assets/cloud-image/content',
}
const remote = (doc = project(), revision = 1, assets: GouoCloudAsset[] = []) => ({
  client_id: doc.id,
  title: doc.title,
  revision,
  updated_at: revision,
  hidden_at: 0,
  document: doc,
  assets,
})

class ConflictError extends Error {
  constructor(public current: unknown) {
    super('冲突')
  }
}

class RateLimitError extends Error {
  constructor(public retryAt: number) {
    super('请求过于频繁，请稍后重试')
  }
}

beforeEach(() => {
  vi.resetModules()
  projects = new Map()
  conversations = new Map()
  meta = new Map()
  scopeCurrent = true
  canvasState = { projects: [] }
  agentState = { conversations: [] }
  beforeSave = undefined
  backend = vi.fn(async () => ({ items: [], next_cursor: '', has_more: false }))
  upload = vi.fn(async () => asset)
  download = vi.fn(async () => ({ id: 'image', dataUrl: 'data:image/png;base64,a' }))
  vi.doMock('../store', () => ({ useStore: { getState: () => ({ showToast: vi.fn() }) } }))
  vi.doMock('./storageScope', () => ({ isStorageScopeCurrent: () => scopeCurrent }))
  vi.doMock('./gouoBackend', () => ({ backendRequest: backend, GouoConflictError: ConflictError, GouoRateLimitError: RateLimitError }))
  vi.doMock('./cloudSync', () => ({ uploadImage: upload, downloadAsset: download }))
  vi.doMock('../stores/canvasStore', () => ({
    markCanvasPersisted: vi.fn(),
    useCanvasStore: {
      getState: () => canvasState,
      setState: (patch: Partial<typeof canvasState> | ((state: typeof canvasState) => Partial<typeof canvasState>)) =>
        Object.assign(canvasState, typeof patch === 'function' ? patch(canvasState) : patch),
    },
  }))
  vi.doMock('../stores/agentStore', () => ({
    markAgentPersisted: vi.fn(),
    normalizeAgentConversation: (value: AgentConversation) => (value.schemaVersion === 1 ? value : undefined),
    useAgentStore: {
      getState: () => agentState,
      setState: (patch: Partial<typeof agentState> | ((state: typeof agentState) => Partial<typeof agentState>)) =>
        Object.assign(agentState, typeof patch === 'function' ? patch(agentState) : patch),
    },
  }))
  vi.doMock('./db', () => ({
    getAllCanvasProjects: async () => [...projects.values()].map((doc) => structuredClone(doc)),
    getAllAgentConversations: async () => [...conversations.values()].map((doc) => structuredClone(doc)),
    getCanvasProject: async (id: string) => structuredClone(projects.get(id)),
    getAgentConversation: async (id: string) => structuredClone(conversations.get(id)),
    getCloudSyncMeta: async (key: string) => meta.get(key),
    putCloudSyncMeta: async (key: string, value: unknown) => {
      meta.set(key, value)
    },
    putCanvasProject: async (doc: CanvasProject) => {
      if (!scopeCurrent) throw new Error('账号已切换')
      await beforeSave?.(doc)
      projects.set(doc.id, structuredClone(doc))
    },
    putAgentConversation: async (doc: AgentConversation) => {
      if (!scopeCurrent) throw new Error('账号已切换')
      conversations.set(doc.id, structuredClone(doc))
    },
  }))
})

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('document cloud sync', () => {
  it.each(['upload', 'document', 'list', 'download', 'conflict-download'] as const)(
    'stops on a rate limit from %s and preserves the retry deadline and error instance',
    async (source) => {
      const limit = new RateLimitError(Date.now() + 180_000)
      const first = project('first')
      const second = project('second')
      if (source !== 'list' && source !== 'download') {
        if (source === 'upload')
          first.nodes = [{ id: 'node', type: 'image', title: '', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { imageId: 'image' } }]
        projects.set(first.id, first)
        projects.set(second.id, second)
        canvasState.projects = [first, second]
      }
      if (source === 'upload') upload.mockRejectedValueOnce(limit)
      if (source === 'download' || source === 'conflict-download') download.mockRejectedValueOnce(limit)
      backend.mockImplementation(async (_path: string, init?: RequestInit) => {
        if (source === 'document' || source === 'list') throw limit
        if (source === 'conflict-download' && init?.method === 'PUT') throw new ConflictError(remote(first, 2, [asset]))
        return { items: [remote(first, 2, [asset]), remote(second)], next_cursor: 'later-page', has_more: true }
      })
      const sync = await import('./documentSync')
      await expect(sync.syncDocuments()).rejects.toBe(limit)
      expect(limit.retryAt).toBeGreaterThan(Date.now() + 120_000)
      expect(backend).toHaveBeenCalledTimes(source === 'upload' ? 0 : 1)
      expect(download).toHaveBeenCalledTimes(source === 'download' || source === 'conflict-download' ? 1 : 0)
      expect(meta.has('documents-cursor:canvases')).toBe(false)
      expect(canvasState.projects.find((doc) => doc.id === 'first')?.cloudSyncStatus).not.toBe('error')
    },
  )

  it('one upload failure marks only that document and still uploads the following document', async () => {
    const broken = {
      ...project('broken'),
      nodes: [{ id: 'image', type: 'image', title: '参考图', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { imageId: 'missing' } }],
    }
    const good = project('good')
    projects.set(broken.id, broken)
    projects.set(good.id, good)
    canvasState.projects = [broken, good]
    upload.mockRejectedValueOnce(new Error('素材无法读取'))
    backend.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? remote(project(path.split('/').pop())) : { items: [], next_cursor: '', has_more: false },
    )
    const sync = await import('./documentSync')
    const result = await sync.syncDocuments()
    expect(result.failures).toEqual([{ kind: 'canvases', id: 'broken', title: broken.title, error: '素材无法读取' }])
    expect(canvasState.projects.find((doc) => doc.id === 'broken')).toMatchObject({ cloudSyncStatus: 'error', cloudSyncError: '素材无法读取' })
    expect(projects.get('good')).toMatchObject({ cloudSyncStatus: 'synced', cloudRevision: 1 })
    expect(backend.mock.calls.some((call) => call[0] === '/api/gouo/canvases/good' && call[1]?.method === 'PUT')).toBe(true)
  })

  it('preserves old overlong titles, accepts 200 Unicode characters and recovers after renaming', async () => {
    const old = { ...project('old'), title: '原'.repeat(201) }
    const unicode = { ...project('unicode'), title: '𠮷'.repeat(200) }
    projects.set(old.id, old)
    projects.set(unicode.id, unicode)
    canvasState.projects = [old, unicode]
    backend.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? remote(JSON.parse(String(init.body)).document) : { items: [], next_cursor: '', has_more: false },
    )
    const sync = await import('./documentSync')
    const result = await sync.syncDocuments()
    expect(result.failures[0]).toMatchObject({ id: 'old', error: expect.stringContaining('200') })
    expect(projects.get('old')?.title).toBe(old.title)
    expect(projects.get('unicode')?.cloudSyncStatus).toBe('synced')
    const renamed = { ...projects.get('old')!, title: '已恢复标题', revision: 2 }
    projects.set('old', renamed)
    canvasState.projects = canvasState.projects.map((doc) => (doc.id === 'old' ? renamed : doc))
    expect((await sync.syncDocuments()).failures).toEqual([])
    expect(projects.get('old')).toMatchObject({ title: '已恢复标题', cloudSyncStatus: 'synced', cloudSyncError: undefined })
  })

  it('writing cloud status cannot overwrite another tab that saved during an upload', async () => {
    const doc = project()
    projects.set(doc.id, doc)
    canvasState.projects = [doc]
    backend.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        projects.set(doc.id, { ...doc, revision: 2, title: '其他标签页的更新' })
        return remote(doc)
      }
      return { items: [], next_cursor: '', has_more: false }
    })
    const sync = await import('./documentSync')
    await sync.syncDocuments()
    expect(projects.get(doc.id)).toMatchObject({ revision: 2, title: '其他标签页的更新' })
  })

  it.each(['canvases', 'conversations'] as const)('a stale %s tab cannot upload old content using another tab\'s cloud revision', async (kind) => {
    const doc = kind === 'canvases' ? project() : {
      id: 'conversation', title: '旧会话', schemaVersion: 1 as const, revision: 1, createdAt: 1, updatedAt: 1,
      modelId: 'model', messages: [], referenceImageIds: [], draft: '', status: 'idle' as const,
    }
    const changed = { ...doc, revision: 2, title: '另一标签页已同步的新内容' }
    if (kind === 'canvases') {
      projects.set(doc.id, changed as CanvasProject)
      canvasState.projects = [doc as CanvasProject]
    } else {
      conversations.set(doc.id, changed as AgentConversation)
      agentState.conversations = [doc as AgentConversation]
    }
    const sync = await import('./documentSync')
    meta.set(`document:${kind}:${doc.id}`, { revision: 2, fingerprint: sync.documentFingerprint(changed) })
    const result = await sync.syncDocuments()
    expect(result.failures).toHaveLength(1)
    expect(backend.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false)
    expect((kind === 'canvases' ? projects : conversations).get(doc.id)?.title).toBe(changed.title)
    expect((kind === 'canvases' ? canvasState.projects : agentState.conversations)[0]).toMatchObject({ title: doc.title, cloudSyncStatus: 'error' })
    expect(meta.get(`document:${kind}:${doc.id}`)).toEqual({ revision: 2, fingerprint: sync.documentFingerprint(changed) })
  })

  it('preserves an unsaved draft until it reaches local storage, then syncs it normally', async () => {
    const doc = project()
    const draft = { ...doc, revision: 2, title: '尚未保存的草稿' }
    projects.set(doc.id, doc)
    canvasState.projects = [draft]
    const sync = await import('./documentSync')
    meta.set('document:canvases:project', { revision: 1, fingerprint: sync.documentFingerprint(doc) })
    backend.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? remote(JSON.parse(String(init.body)).document, 2) : { items: [], next_cursor: '', has_more: false },
    )
    expect((await sync.syncDocuments()).failures).toHaveLength(1)
    expect(backend.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false)
    expect(projects.get(doc.id)?.title).toBe(doc.title)
    expect(canvasState.projects[0].title).toBe(draft.title)
    projects.set(doc.id, structuredClone(canvasState.projects[0]))
    expect((await sync.syncDocuments()).failures).toEqual([])
    expect(projects.get(doc.id)).toMatchObject({ title: draft.title, cloudSyncStatus: 'synced', cloudRevision: 2 })
  })

  it('compares and uploads serialized image nodes without transient previews', async () => {
    const doc = project()
    doc.nodes = [{
      id: 'image', type: 'image', title: '图片', position: { x: 0, y: 0 }, width: 100, height: 100,
      metadata: {
        imageId: 'image', content: 'data:image/png;base64,preview',
        images: [{ id: 'image', storageKey: 'image', content: 'data:image/png;base64,preview', status: 'success', naturalWidth: 100, naturalHeight: 100, bytes: 1, mimeType: 'image/png' }],
      },
    }]
    const { serializeCanvasProject } = await import('./canvas/document')
    projects.set(doc.id, serializeCanvasProject(doc))
    canvasState.projects = [doc]
    backend.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? remote(JSON.parse(String(init.body)).document) : { items: [], next_cursor: '', has_more: false },
    )
    const sync = await import('./documentSync')
    expect((await sync.syncDocuments()).failures).toEqual([])
    const body = JSON.parse(backend.mock.calls.find((call) => call[1]?.method === 'PUT')![1].body)
    expect(body.document.nodes[0].metadata.content).toBe('')
    expect(body.document.nodes[0].metadata.images[0].content).toBe('')
    expect(projects.get(doc.id)?.nodes[0].metadata?.images?.[0].content).toBe('')
    expect(projects.get(doc.id)?.cloudSyncStatus).toBe('synced')
  })

  it('a failed remote document does not block later pages or conversations, while its cursor stays retryable', async () => {
    const bad = { ...project('bad'), schemaVersion: 2 }
    const good = project('good')
    const conversation: AgentConversation = {
      id: 'chat',
      title: '会话',
      schemaVersion: 1,
      modelId: 'model',
      messages: [],
      referenceImageIds: [],
      draft: '',
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    }
    backend.mockImplementation(async (path: string) => {
      if (path === '/api/gouo/canvases?cursor=') return { items: [remote(bad as CanvasProject)], next_cursor: 'page-2', has_more: true }
      if (path === '/api/gouo/canvases?cursor=page-2') return { items: [remote(good)], next_cursor: 'end', has_more: false }
      return { items: [{ ...remote(), client_id: 'chat', document: conversation }], next_cursor: 'chats-end', has_more: false }
    })
    const sync = await import('./documentSync')
    const result = await sync.syncDocuments()
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].id).toBe('bad')
    expect(projects.has('good')).toBe(true)
    expect(conversations.has('chat')).toBe(true)
    expect(meta.has('documents-cursor:canvases')).toBe(false)
    expect(meta.get('documents-cursor:conversations')).toBe('chats-end')
  })

  it('uploads every local image mapping while deduplicating cloud asset IDs', async () => {
    const doc = project()
    doc.nodes = ['image', 'same-image'].map((id) => ({
      id,
      type: 'image',
      title: id,
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      metadata: { imageId: id },
    }))
    projects.set(doc.id, doc)
    canvasState.projects = [doc]
    backend.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? remote(doc) : { items: [], next_cursor: '', has_more: false },
    )
    const sync = await import('./documentSync')
    await sync.syncDocuments()
    const body = JSON.parse(backend.mock.calls.find((call) => call[1]?.method === 'PUT')![1].body)
    expect(body.asset_ids).toEqual(['cloud-image'])
    expect(body.assets).toEqual([
      { asset_id: 'cloud-image', client_image_id: 'image' },
      { asset_id: 'cloud-image', client_image_id: 'same-image' },
    ])
    expect(body.expected_revision).toBe(0)
    expect(meta.get('document:canvases:project')).toMatchObject({ revision: 1 })
    backend.mockClear()
    await sync.syncDocuments()
    expect(backend.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false)
  })

  it('downloads document assets using their original local IDs', async () => {
    const doc = project()
    backend.mockImplementation(async (path: string) => ({
      items: path.includes('/canvases?') ? [remote(doc, 3, [asset])] : [],
      next_cursor: 'next',
      has_more: false,
    }))
    const sync = await import('./documentSync')
    await sync.syncDocuments()
    expect(download).toHaveBeenCalledWith(asset, 'image')
    expect(projects.get(doc.id)).toMatchObject({ cloudRevision: 3, cloudSyncStatus: 'synced' })
    expect(canvasState.projects).toHaveLength(1)
    expect(meta.get('documents-cursor:canvases')).toBe('next')
  })

  it('preserves a local conflict copy before accepting the remote revision', async () => {
    const doc = project()
    projects.set(doc.id, doc)
    canvasState.projects = [doc]
    const changed = { ...doc, title: '另一台设备的画布', revision: 4 }
    backend.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new ConflictError(remote(changed, 4))
      return { items: [], next_cursor: '', has_more: false }
    })
    const sync = await import('./documentSync')
    await sync.syncDocuments()
    expect(projects.get(doc.id)?.title).toBe(changed.title)
    expect([...projects.values()].find((item) => item.id !== doc.id)).toMatchObject({ title: '本地画布（本地冲突副本）', cloudSyncStatus: 'pending' })
  })

  it('defers a remote update when a user edits while its asset downloads', async () => {
    const doc = project()
    projects.set(doc.id, doc)
    canvasState.projects = [doc]
    const sync = await import('./documentSync')
    meta.set('document:canvases:project', { revision: 1, fingerprint: sync.documentFingerprint(doc) })
    backend.mockImplementation(async (path: string) => ({
      items: path.includes('/canvases?') ? [remote({ ...doc, title: '云端稿', revision: 2 }, 2, [asset])] : [],
      next_cursor: 'next',
      has_more: false,
    }))
    download.mockImplementation(async () => {
      const edited = { ...doc, title: '正在编辑', revision: 3 }
      canvasState.projects = [edited]
      projects.set(doc.id, edited)
    })
    await sync.syncDocuments()
    expect(projects.get(doc.id)?.title).toBe('正在编辑')
    expect(meta.has('documents-cursor:canvases')).toBe(false)
  })

  it('stops before sending a document if the account changes during image upload', async () => {
    const doc = project()
    doc.nodes = [{ id: 'node', type: 'image', title: '', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { imageId: 'image' } }]
    projects.set(doc.id, doc)
    canvasState.projects = [doc]
    upload.mockImplementation(async () => {
      scopeCurrent = false
      return asset
    })
    backend.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? remote(doc) : { items: [], next_cursor: '', has_more: false },
    )
    const sync = await import('./documentSync')
    await expect(sync.syncDocuments()).rejects.toThrow('账号已切换')
    expect(backend).not.toHaveBeenCalled()
    expect(meta.size).toBe(0)
  })

  it('does not replace an edit that arrives while the remote document is being saved', async () => {
    const doc = project()
    projects.set(doc.id, doc)
    canvasState.projects = [doc]
    const sync = await import('./documentSync')
    meta.set('document:canvases:project', { revision: 1, fingerprint: sync.documentFingerprint(doc) })
    backend.mockImplementation(async (path: string) => ({
      items: path.includes('/canvases?') ? [remote({ ...doc, title: '云端稿', revision: 2 }, 2)] : [],
      next_cursor: 'next',
      has_more: false,
    }))
    beforeSave = async () => {
      beforeSave = undefined
      const edited = { ...doc, title: '保存期间编辑', revision: 3 }
      canvasState.projects = [edited]
      projects.set(doc.id, edited)
    }
    await sync.syncDocuments()
    expect(canvasState.projects[0].title).toBe('保存期间编辑')
    expect(projects.get(doc.id)?.title).toBe('保存期间编辑')
    expect(meta.has('documents-cursor:canvases')).toBe(false)
  })
})
