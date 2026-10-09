import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { CanvasProject } from '../types'

vi.mock('./storageScope', () => ({ getLoadedStorageName: () => 'document-test', isStorageScopeCurrent: () => true }))
const project = (patch: Partial<CanvasProject> = {}): CanvasProject => ({ id: 'canvas', title: '画布', nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'lines', showImageInfo: false, schemaVersion: 1, revision: 1, createdAt: 1, updatedAt: 1, ...patch })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('window', new EventTarget())
})

describe('画布数据升级和素材安全', () => {
  it('升级 v4 后保留不识别的旧会话及其图片', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('document-test', 4)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('agentConversations', { keyPath: 'id' }).put({ id: 'legacy', messages: [{ imageIds: ['legacy-image'] }] })
        req.result.createObjectStore('images', { keyPath: 'id' }).put({ id: 'legacy-image', dataUrl: 'data:image/png;base64,aA==' })
      }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    const db = await import('./db')
    await db.putCanvasProject(project())
    expect(await db.getAllCanvasProjects()).toHaveLength(1)
    expect(await db.getAllAgentConversations()).toEqual([])
    await db.clearImages()
    expect(await db.getImage('legacy-image')).toBeDefined()
  })

  it('删除历史图片时保护画布引用，拒绝过期版本覆盖', async () => {
    const db = await import('./db')
    await db.putImage({ id: 'used', dataUrl: 'data:image/png;base64,aA==', createdAt: 1, source: 'upload' })
    await db.putImage({ id: 'free', dataUrl: 'data:image/png;base64,Yg==', createdAt: 1, source: 'upload' })
    await db.putCanvasProject(project({ nodes: [{ id: 'node', type: 'image', title: '参考图', position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { imageId: 'used' } }] }))
    await db.clearImages()
    expect(await db.getImage('used')).toBeDefined()
    expect(await db.getImage('free')).toBeUndefined()
    await expect(db.putCanvasProject(project({ revision: 3 }), 0)).rejects.toThrow('变更')
    await db.putCanvasProject(project({ revision: 2, title: '更新' }), 1)
    await expect(db.putCanvasProject(project())).rejects.toThrow('变更')
    await expect(db.putCanvasProject(project({ revision: 2, title: '另一个标签' }))).rejects.toThrow('变更')
    expect((await db.getCanvasProject('canvas'))?.title).toBe('更新')
  })

  it('备份恢复发生图片冲突时原子回滚画布、会话及任务', async () => {
    const db = await import('./db')
    await db.putImage({ id: 'duplicate', dataUrl: 'data:image/png;base64,aA==', createdAt: 1, source: 'upload' })
    await expect(db.importTaskData([], [{ id: 'duplicate', dataUrl: 'data:image/png;base64,Yg==', createdAt: 1, source: 'upload' }], [], { canvases: [project()], conversations: [] })).rejects.toThrow('冲突')
    expect(await db.getAllCanvasProjects()).toEqual([])
    expect((await db.getImage('duplicate'))?.dataUrl).toBe('data:image/png;base64,aA==')
  })
})
