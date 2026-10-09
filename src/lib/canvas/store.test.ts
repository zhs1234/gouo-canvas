import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from './types'

const db = vi.hoisted(() => ({ projects: new Map<string, CanvasProject>(), fail: false, delay: 0 }))
vi.mock('../db', () => ({
  getAllCanvasProjects: async () => [...db.projects.values()],
  putCanvasProject: async (project: CanvasProject, expectedRevision?: number) => {
    if (db.fail) throw new Error('quota')
    if (db.delay) await new Promise((resolve) => setTimeout(resolve, db.delay))
    if ((db.projects.get(project.id)?.revision ?? 0) !== expectedRevision) throw new Error('revision conflict')
    db.projects.set(project.id, structuredClone(project))
  },
}))
vi.mock('../storageScope', () => ({ isStorageScopeCurrent: () => true }))

import { useCanvasStore } from '../../stores/canvasStore'
import { createCanvasViewportPersistence } from './viewport'

beforeEach(() => {
  db.projects.clear()
  db.fail = false
  db.delay = 0
  useCanvasStore.setState({ projects: [], hydrated: false, histories: {}, selectedNodeIds: {}, error: null })
})

describe('画布状态持久化与撤销', () => {
  it('连续撤销不等上一次保存完成时，仍能逐步重做回最新状态', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    for (const title of ['A', 'B', 'C']) await state.updateProject(project.id, { title })
    db.delay = 20
    await Promise.all([state.undo(project.id), state.undo(project.id)])
    expect(state.getSnapshot(project.id).title).toBe('A')
    const titles = []
    for (let i = 0; i < 2; i++) {
      await state.redo(project.id)
      titles.push(state.getSnapshot(project.id).title)
    }
    expect(titles).toEqual(['B', 'C'])
  })

  it.each(['拖动', '尺寸调整'])('待存视口在%s开始前提交，交互期间的视口变更不使文档版本过期', async () => {
    vi.useFakeTimers()
    const writes: Promise<unknown>[] = []
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'text', nodeType: 'text' }])
    const persistence = createCanvasViewportPersistence((viewport) => {
      writes.push(state.updateProject(project.id, { viewport }, { history: false }))
    })
    try {
      persistence.schedule({ x: 100, y: 50, k: 1 })
      vi.advanceTimersByTime(100)
      persistence.beginInteraction()
      const start = state.getSnapshot(project.id)
      persistence.schedule({ x: 110, y: 50, k: 1.2 })
      vi.advanceTimersByTime(500)
      expect(state.getSnapshot(project.id).revision).toBe(start.revision)
      await state.updateProject(
        project.id,
        { nodes: start.nodes.map((node) => ({ ...node, position: { x: 80, y: 0 }, width: 500 })) },
        { expectedRevision: start.revision },
      )
      persistence.endInteraction()
      await Promise.all(writes)
      expect(state.getSnapshot(project.id).nodes[0]).toMatchObject({ position: { x: 80, y: 0 }, width: 500 })
      expect(state.getSnapshot(project.id).viewport).toEqual({ x: 110, y: 50, k: 1.2 })
    } finally {
      persistence.dispose()
      vi.useRealTimers()
    }
  })

  it('交互期间真实 Agent 修改仍会拒绝旧快照，取消及卸载不留下延迟保存', async () => {
    vi.useFakeTimers()
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    const writes: Promise<unknown>[] = []
    const saveViewport = vi.fn((viewport) => {
      writes.push(state.updateProject(project.id, { viewport }, { history: false }))
    })
    const persistence = createCanvasViewportPersistence(saveViewport)
    try {
      persistence.beginInteraction()
      const start = state.getSnapshot(project.id)
      await state.applyOperations(project.id, [{ type: 'add_node', id: 'agent-node', nodeType: 'text' }])
      await expect(state.updateProject(project.id, { nodes: start.nodes }, { expectedRevision: start.revision })).rejects.toThrow('画布已被修改')
      persistence.schedule({ x: 10, y: 20, k: 1 })
      persistence.endInteraction()
      persistence.schedule({ x: 30, y: 40, k: 1 })
      persistence.dispose()
      vi.runAllTimers()
      await Promise.all(writes)
      expect(saveViewport).toHaveBeenCalledTimes(2)
      expect(state.getSnapshot(project.id).nodes[0].id).toBe('agent-node')
    } finally {
      persistence.dispose()
      vi.useRealTimers()
    }
  })

  it('标题按 Unicode 字符限制 200，旧长标题可打开、修改内容并重命名恢复', async () => {
    const state = useCanvasStore.getState()
    const title = '𠮷'.repeat(200)
    const project = await state.createProject(title)
    await expect(state.renameProject(project.id, `${title}字`)).rejects.toThrow('200')
    const legacy = { ...project, title: '旧'.repeat(250) }
    db.projects.set(project.id, legacy)
    useCanvasStore.setState({ projects: [], hydrated: false })
    await state.hydrate()
    expect(state.getSnapshot(project.id).title).toBe(legacy.title)
    await state.applyOperations(project.id, [{ type: 'add_node', nodeType: 'text' }])
    await state.renameProject(project.id, '恢复后的标题')
    expect(state.getSnapshot(project.id)).toMatchObject({ title: '恢复后的标题' })
  })
  it('不挂载页面也能应用Agent操作，拒绝过期版本，撤销保留图片引用', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject('Agent画布')
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'image', nodeType: 'image', metadata: { imageId: 'protected' } }], project.revision)
    await expect(state.applyOperations(project.id, [{ type: 'add_node', nodeType: 'text' }], project.revision)).rejects.toThrow('版本冲突')
    await state.applyOperations(project.id, [{ type: 'delete_node', id: 'image' }])
    expect(state.getSnapshot(project.id).nodes).toHaveLength(0)
    expect(state.getReferencedImageIds()).toContain('protected')
    await state.undo(project.id)
    expect(state.getSnapshot(project.id).nodes[0].metadata?.imageId).toBe('protected')
    await state.redo(project.id)
    expect(state.getSnapshot(project.id).nodes).toHaveLength(0)
    expect(db.projects.get(project.id)?.revision).toBe(5)
  })

  it('存储失败显示错误并保留可导出的内存更改，重试成功清除错误', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    db.fail = true
    await expect(state.renameProject(project.id, '未保存的更改')).rejects.toThrow('quota')
    expect(state.getSnapshot(project.id).title).toBe('未保存的更改')
    expect(useCanvasStore.getState().error).toContain('尚未保存')
    db.fail = false
    await state.saveProject(project.id)
    expect(db.projects.get(project.id)?.title).toBe('未保存的更改')
    expect(useCanvasStore.getState().error).toBeNull()
  })

  it('其他标签页抢先保存时拒绝覆盖，并保留本地草稿供导出', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject('原始')
    db.projects.set(project.id, { ...project, title: '其他标签页', revision: 2 })
    await expect(state.renameProject(project.id, '本地草稿')).rejects.toThrow('revision conflict')
    expect(db.projects.get(project.id)?.title).toBe('其他标签页')
    expect(state.getSnapshot(project.id).title).toBe('本地草稿')
    await expect(state.saveProject(project.id)).rejects.toThrow('revision conflict')
  })
})
