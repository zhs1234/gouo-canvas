import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../types'
import type { SkillDocument } from './skills/types'

const conversation = (patch: Partial<AgentConversation> = {}): AgentConversation => ({
  id: 'conv', schemaVersion: 1, title: '会话', modelId: 'model', messages: [], draft: '', referenceImageIds: [], status: 'idle', createdAt: 1, updatedAt: 1, revision: 1, ...patch,
})

let stored: Map<string, AgentConversation>
let meta: Map<string, unknown>
let agentState: { conversations: AgentConversation[]; hydrate: () => Promise<void> }
let requests: Array<{ path: string; body?: Record<string, unknown> }>
let remotePage: unknown[]
let downloadAsset: ReturnType<typeof vi.fn>
let storedSkills: Map<string, SkillDocument>
let skillState: { skills: SkillDocument[]; hydrate: () => Promise<void> }
let remoteSkills: unknown[]
let backendStatus: Record<string, unknown> | null

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', new EventTarget())
  stored = new Map()
  meta = new Map()
  requests = []
  remotePage = []
  agentState = { conversations: [], hydrate: async () => {} }
  storedSkills = new Map()
  skillState = { skills: [], hydrate: async () => {} }
  remoteSkills = []
  backendStatus = null
  downloadAsset = vi.fn()
  vi.doMock('../store', () => ({ deleteImageIfUnreferenced: vi.fn(), useStore: { getState: () => ({ showToast: vi.fn() }) } }))
  vi.doMock('./storageScope', () => ({ isStorageScopeCurrent: () => true }))
  vi.doMock('./serverLibrary', () => ({ uploadImage: vi.fn(), downloadAsset }))
  vi.doMock('../stores/canvasStore', () => ({ markCanvasPersisted: vi.fn(), useCanvasStore: { getState: () => ({ projects: [], hydrate: async () => {} }), setState: vi.fn() } }))
  vi.doMock('../stores/agentStore', () => ({
    markAgentPersisted: vi.fn(),
    normalizeAgentConversation: (value: AgentConversation) => value,
    useAgentStore: {
      getState: () => agentState,
      setState: (update: (state: typeof agentState) => Partial<typeof agentState>) => Object.assign(agentState, update(agentState)),
    },
  }))
  vi.doMock('../stores/skillStore', () => ({
    normalizeSkillDocument: (value: SkillDocument) => value,
    useSkillStore: {
      getState: () => skillState,
      setState: (update: (state: typeof skillState) => Partial<typeof skillState>) => Object.assign(skillState, update(skillState)),
    },
  }))
  vi.doMock('./db', () => ({
    getAllSkills: async () => [...storedSkills.values()],
    getSkill: async (id: string) => storedSkills.get(id),
    putSkill: async (doc: SkillDocument) => { storedSkills.set(doc.id, doc) },
    getAllCanvasProjects: async () => [],
    getAllAgentConversations: async () => [...stored.values()],
    getCanvasProject: async () => undefined,
    getAgentConversation: async (id: string) => stored.get(id),
    putCanvasProject: vi.fn(),
    putAgentConversation: async (doc: AgentConversation) => { stored.set(doc.id, doc) },
    getCloudMeta: async (key: string) => meta.get(key),
    getDocumentWithCloudMeta: async (kind: string, id: string, key: string) => ({ doc: kind === 'skills' ? storedSkills.get(id) : stored.get(id), meta: meta.get(key) }),
    deleteDocuments: async (kind: string, ids: string[]) => { for (const id of ids) (kind === 'skills' ? storedSkills : stored).delete(id) },
    deleteCloudAssetMapItems: vi.fn(),
    putCloudMeta: async (key: string, value: unknown) => { meta.set(key, value) },
  }))
  vi.doMock('./gouoBackend', () => ({
    getLoadedTrashRetentionMs: () => 3 * 24 * 60 * 60 * 1000,
    refreshBackendStatus: async () => {},
    getCachedBackendStatus: () => backendStatus,
    GouoAssetMissingError: class extends Error {},
    GouoConflictError: class extends Error {},
    backendRequest: vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (init?.method === 'PUT') return { client_id: 'conv', title: '会话', revision: 3, document: {}, assets: [] }
      return { items: path.includes('conversations') ? remotePage : path.includes('skills') ? remoteSkills : [], next_cursor: 'next', has_more: false }
    }),
  }))
})

describe('server documents', () => {
  it('首次拉取结束后标记文档已拉取，拉取失败也标记，画布页据此判定画布是否存在', async () => {
    const setState = vi.fn()
    vi.doMock('../stores/canvasStore', () => ({ markCanvasPersisted: vi.fn(), useCanvasStore: { getState: () => ({ projects: [], hydrate: async () => {} }), setState } }))
    const docs = await import('./serverDocuments')
    await docs.startServerDocuments()
    expect(setState).toHaveBeenCalledWith({ documentsPulled: true })

    vi.resetModules()
    setState.mockClear()
    const backend = await import('./gouoBackend')
    vi.mocked(backend.backendRequest).mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failed = await import('./serverDocuments')
    await failed.startServerDocuments()
    expect(setState).toHaveBeenCalledWith({ documentsPulled: true })
  })

  it('导入的技能和会话一样写到服务端，并读取其他设备导入的技能', async () => {
    const skill = (patch: Partial<SkillDocument> = {}): SkillDocument => ({ id: 'skill', schemaVersion: 1, name: 'poster', title: '海报', description: '用途', body: '正文', files: [], enabled: true, createdAt: 1, updatedAt: 1, revision: 1, ...patch })
    storedSkills.set('skill', skill())
    remoteSkills = [{ client_id: 'remote-skill', title: '远端', revision: 2, document: skill({ id: 'remote-skill', name: 'remote', revision: 4 }), assets: [] }]
    const docs = await import('./serverDocuments')
    await docs.startServerDocuments()
    expect(requests.find((request) => request.path === '/api/gouo/skills/skill')?.body).toMatchObject({ client_id: 'skill', title: '海报', document: { name: 'poster', body: '正文' } })
    expect(storedSkills.get('remote-skill')).toMatchObject({ name: 'remote', revision: 4 })
    expect(skillState.skills.map((item) => item.id)).toEqual(['remote-skill'])
  })

  it('后台关闭 Agent 或技能时不推送对应文档，也不报错', async () => {
    stored.set('conv', conversation())
    storedSkills.set('skill', { id: 'skill', schemaVersion: 1, name: 'poster', title: '海报', description: '', body: '', files: [], enabled: true, createdAt: 1, updatedAt: 1, revision: 1 })
    backendStatus = { gouo_skills_enabled: false }
    const docs = await import('./serverDocuments')
    await docs.pushDocuments()
    expect(requests.map((request) => request.path)).toEqual(['/api/gouo/conversations/conv'])
    requests = []
    meta.clear()
    backendStatus = { gouo_agent_enabled: false }
    await docs.pushDocuments()
    expect(requests).toEqual([])
  })

  it('writes changed documents to the server once and skips unchanged ones', async () => {
    stored.set('conv', conversation())
    const docs = await import('./serverDocuments')
    await docs.pushDocuments()
    const puts = requests.filter((request) => request.body)
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({ path: '/api/gouo/conversations/conv', body: { client_id: 'conv', expected_revision: 0 } })
    expect(meta.get('document:conversations:conv')).toMatchObject({ revision: 3 })
    await docs.pushDocuments()
    expect(requests.filter((request) => request.body)).toHaveLength(1)
  })

  it('记下已写入的版本号，隐藏请求失败后重试不会和自己冲突', async () => {
    stored.set('conv', conversation({ hiddenAt: 5 }))
    const backend = await import('./gouoBackend')
    vi.mocked(backend.backendRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path.endsWith('/hide')) throw new Error('offline')
      return { client_id: 'conv', title: '会话', revision: 3, document: {}, assets: [] }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const docs = await import('./serverDocuments')
    await docs.pushDocuments()
    expect(meta.get('document:conversations:conv')).toEqual({ revision: 3, fingerprint: '' })
    vi.mocked(backend.backendRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return { client_id: 'conv', title: '会话', revision: path.endsWith('/hide') ? 5 : 4, hidden_at: path.endsWith('/hide') ? 9 : undefined, document: {}, assets: [] }
    })
    await docs.pushDocuments()
    expect(requests.filter((request) => request.body?.expected_revision !== undefined).map((request) => request.body?.expected_revision)).toEqual([0, 3, 3, 4])
    expect(meta.get('document:conversations:conv')).toMatchObject({ revision: 5 })
  })

  it('稍后重试因本地正在运行而暂未采用服务端版本的冲突', async () => {
    vi.useFakeTimers()
    try {
      const running = conversation({ status: 'running' })
      stored.set('conv', conversation())
      agentState.conversations = [running]
      const backend = await import('./gouoBackend')
      vi.mocked(backend.backendRequest).mockImplementation(async (path: string, init?: RequestInit) => {
        requests.push({ path })
        if (init?.method === 'PUT') throw new backend.GouoConflictError('conflict', { client_id: 'conv', title: '远端', revision: 9, document: conversation({ title: '远端' }), assets: [] })
        return { items: [], next_cursor: '', has_more: false }
      })
      const docs = await import('./serverDocuments')
      await docs.pushDocuments()
      const puts = () => requests.filter((request) => request.path === '/api/gouo/conversations/conv').length
      expect(puts()).toBe(1)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(puts()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes a newer server version and keeps unsaved local edits as a copy', async () => {
    const local = conversation({ title: '本地改动' })
    stored.set('conv', local)
    agentState.conversations = [local]
    meta.set('document:conversations:conv', { revision: 1, fingerprint: 'older-content' })
    remotePage = [{ client_id: 'conv', title: '服务端', revision: 2, document: conversation({ title: '服务端', revision: 5 }), assets: [] }]
    const docs = await import('./serverDocuments')
    await docs.startServerDocuments()
    const titles = [...stored.values()].map((doc) => doc.title).sort()
    expect(titles).toEqual(['服务端', '本地改动（本地冲突副本）'])
    expect(stored.get('conv')?.revision).toBe(5)
    expect(meta.get('documents-cursor:conversations')).toBe('next')
  })

  it('drops canvas undo history when the server version replaces the local one', async () => {
    const canvas = (patch: Record<string, unknown>) => ({ id: 'cv', title: '画布', nodes: [], revision: 1, ...patch })
    const local = canvas({ title: '本地' })
    const canvasState: { projects: unknown[]; histories: Record<string, unknown> } = { projects: [local], histories: { cv: { past: [canvas({ title: '冲突前' })], future: [] }, other: { past: [], future: [] } } }
    meta.set('document:canvases:cv', { revision: 1, fingerprint: JSON.stringify(local) })
    vi.doMock('./canvas/document', () => ({ serializeCanvasProject: (doc: unknown) => doc, validateCanvasProject: () => {} }))
    vi.doMock('../stores/canvasStore', () => ({
      markCanvasPersisted: vi.fn(),
      useCanvasStore: {
        getState: () => ({ ...canvasState, hydrate: async () => {} }),
        setState: (update: Partial<typeof canvasState> | ((state: typeof canvasState) => Partial<typeof canvasState>)) => Object.assign(canvasState, typeof update === 'function' ? update(canvasState) : update),
      },
    }))
    const backend = await import('./gouoBackend')
    vi.mocked(backend.backendRequest).mockImplementation(async (path: string) => ({ items: path.includes('canvases') ? [{ client_id: 'cv', title: '服务端', revision: 2, document: canvas({ title: '服务端', revision: 3 }), assets: [] }] : [], next_cursor: 'next', has_more: false }) as never)
    const docs = await import('./serverDocuments')
    await docs.startServerDocuments()
    // 换成其他设备的版本后不能再撤销回冲突前的内容，否则会把对方的修改覆盖回去
    expect(canvasState.histories).not.toHaveProperty('cv')
    expect(canvasState.histories).toHaveProperty('other')
  })

  it('keeps a draft typed while remote assets are downloading', async () => {
    const local = conversation({ draft: '' })
    stored.set('conv', local)
    agentState.conversations = [local]
    meta.set('document:conversations:conv', { revision: 1, fingerprint: '' })
    const docs = await import('./serverDocuments')
    meta.set('document:conversations:conv', { revision: 1, fingerprint: docs.documentFingerprint(local) })
    let finishDownload = () => {}
    downloadAsset.mockImplementation(() => new Promise<void>((resolve) => { finishDownload = resolve }))
    remotePage = [{ client_id: 'conv', title: '服务端', revision: 2, document: conversation({ title: '服务端', revision: 5 }), assets: [{ id: 'asset', client_image_id: 'image' }] }]
    const started = docs.startServerDocuments()
    await vi.waitFor(() => expect(downloadAsset).toHaveBeenCalled())
    // 300 ms 防抖尚未写库：内存 revision 已经递增
    agentState.conversations = [{ ...local, draft: '新输入', revision: 2 }]
    finishDownload()
    await started
    expect(agentState.conversations[0]).toMatchObject({ draft: '新输入', revision: 2 })
    expect(stored.get('conv')?.title).toBe('会话')
    expect(meta.get('documents-cursor:conversations')).toBeUndefined()
  })

  it('saves edits made while the server version is written as a copy', async () => {
    const local = conversation()
    agentState.conversations = [local]
    stored.set('conv', local)
    const docs = await import('./serverDocuments')
    meta.set('document:conversations:conv', { revision: 1, fingerprint: docs.documentFingerprint(local) })
    const db = await import('./db')
    const put = db.putAgentConversation
    vi.spyOn(db, 'putAgentConversation').mockImplementation(async (doc: AgentConversation, ...rest: unknown[]) => {
      // 写库期间用户继续输入
      if (doc.id === 'conv') agentState.conversations = [{ ...local, draft: '写库时输入', revision: 2 }]
      return (put as (...args: unknown[]) => Promise<void>)(doc, ...rest)
    })
    remotePage = [{ client_id: 'conv', title: '服务端', revision: 2, document: conversation({ title: '服务端', revision: 5 }), assets: [] }]
    await docs.startServerDocuments()
    expect(agentState.conversations.find((item) => item.id === 'conv')?.title).toBe('服务端')
    expect([...stored.values()].find((doc) => doc.id !== 'conv')).toMatchObject({ draft: '写库时输入', title: '会话（本地冲突副本）' })
  })

  it('recreates a locally edited document that was purged from the server', async () => {
    stored.set('conv', conversation({ title: '离线期间的修改' }))
    meta.set('document:conversations:conv', { revision: 4, fingerprint: 'older-content' })
    const backend = await import('./gouoBackend')
    vi.mocked(backend.backendRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ path, body })
      // 云端记录已被回收站清理删除：冲突且没有当前版本
      if (body?.expected_revision === 4) throw new backend.GouoConflictError('conflict', null)
      return { client_id: 'conv', title: '离线期间的修改', revision: 1, document: {}, assets: [] }
    })
    const docs = await import('./serverDocuments')
    await docs.pushDocuments()
    expect(requests.filter((request) => request.body).map((request) => request.body?.expected_revision)).toEqual([4, 0])
    expect(meta.get('document:conversations:conv')).toMatchObject({ revision: 1 })
  })

  it('pushes the stored document with its own sync record, not an older list snapshot', async () => {
    const docs = await import('./serverDocuments')
    const stale = conversation({ title: '旧内容' })
    const fresh = conversation({ title: '新内容', revision: 2 })
    // 另一个标签页已写入并推送了新内容，这里列表读到的仍是旧快照
    stored.set('conv', fresh)
    meta.set('document:conversations:conv', { revision: 7, fingerprint: docs.documentFingerprint(fresh) })
    const db = await import('./db')
    vi.spyOn(db, 'getAllAgentConversations').mockResolvedValue([stale])
    await docs.pushDocuments()
    expect(requests.filter((request) => request.body)).toEqual([])
  })

  it('deletes canvases and conversations kept in the recycle bin past the retention period', async () => {
    const day = 24 * 60 * 60 * 1000
    const old = conversation({ id: 'old', hiddenAt: Date.now() - 4 * day })
    const recent = conversation({ id: 'recent', hiddenAt: Date.now() - day })
    for (const item of [old, recent, conversation()]) stored.set(item.id, item)
    agentState.conversations = [old, recent, conversation()]
    const docs = await import('./serverDocuments')
    for (const item of stored.values()) meta.set(`document:conversations:${item.id}`, { revision: 1, fingerprint: docs.documentFingerprint(item) })
    await docs.startServerDocuments()
    expect([...stored.keys()].sort()).toEqual(['conv', 'recent'])
    expect(agentState.conversations.map((item) => item.id).sort()).toEqual(['conv', 'recent'])
  })
})
