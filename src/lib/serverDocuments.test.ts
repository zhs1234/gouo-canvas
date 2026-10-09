import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../types'

const conversation = (patch: Partial<AgentConversation> = {}): AgentConversation => ({
  id: 'conv', schemaVersion: 1, title: '会话', modelId: 'model', messages: [], draft: '', referenceImageIds: [], status: 'idle', createdAt: 1, updatedAt: 1, revision: 1, ...patch,
})

let stored: Map<string, AgentConversation>
let meta: Map<string, unknown>
let agentState: { conversations: AgentConversation[]; hydrate: () => Promise<void> }
let requests: Array<{ path: string; body?: Record<string, unknown> }>
let remotePage: unknown[]

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', new EventTarget())
  stored = new Map()
  meta = new Map()
  requests = []
  remotePage = []
  agentState = { conversations: [], hydrate: async () => {} }
  vi.doMock('../store', () => ({ useStore: { getState: () => ({ showToast: vi.fn() }) } }))
  vi.doMock('./storageScope', () => ({ isStorageScopeCurrent: () => true }))
  vi.doMock('./serverLibrary', () => ({ uploadImage: vi.fn(), downloadAsset: vi.fn() }))
  vi.doMock('../stores/canvasStore', () => ({ markCanvasPersisted: vi.fn(), useCanvasStore: { getState: () => ({ projects: [], hydrate: async () => {} }), setState: vi.fn() } }))
  vi.doMock('../stores/agentStore', () => ({
    markAgentPersisted: vi.fn(),
    normalizeAgentConversation: (value: AgentConversation) => value,
    useAgentStore: {
      getState: () => agentState,
      setState: (update: (state: typeof agentState) => Partial<typeof agentState>) => Object.assign(agentState, update(agentState)),
    },
  }))
  vi.doMock('./db', () => ({
    getAllCanvasProjects: async () => [],
    getAllAgentConversations: async () => [...stored.values()],
    getCanvasProject: async () => undefined,
    getAgentConversation: async (id: string) => stored.get(id),
    putCanvasProject: vi.fn(),
    putAgentConversation: async (doc: AgentConversation) => { stored.set(doc.id, doc) },
    getCloudMeta: async (key: string) => meta.get(key),
    putCloudMeta: async (key: string, value: unknown) => { meta.set(key, value) },
  }))
  vi.doMock('./gouoBackend', () => ({
    GouoConflictError: class extends Error {},
    backendRequest: vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (init?.method === 'PUT') return { client_id: 'conv', title: '会话', revision: 3, document: {}, assets: [] }
      return { items: path.includes('canvases') ? [] : remotePage, next_cursor: 'next', has_more: false }
    }),
  }))
})

describe('server documents', () => {
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
})
