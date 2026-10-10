import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { TaskRecord } from '../../types'
import type { CanvasProject } from './types'

const mocks = vi.hoisted(() => ({ submit: vi.fn(), mask: vi.fn(), projects: new Map<string, CanvasProject>(), beforeSave: undefined as ((project: CanvasProject) => void) | undefined }))
vi.mock('../db', () => ({
  getAllCanvasProjects: async () => [...mocks.projects.values()],
  getAllTasks: async () => [],
  putCanvasProject: async (project: CanvasProject) => {
    mocks.beforeSave?.(project)
    mocks.projects.set(project.id, structuredClone(project))
  },
}))
vi.mock('../storageScope', () => ({ isStorageScopeCurrent: () => true }))
vi.mock('../imageTasks', () => ({ submitImageTask: mocks.submit }))
vi.mock('../canvasImage', () => ({ validateMaskMatchesImage: mocks.mask }))
vi.mock('../../store', () => ({ useStore: create<{ tasks: TaskRecord[] }>(() => ({ tasks: [] })), ensureImageCached: async (id: string) => `image:${id}` }))

import { useStore } from '../../store'
import { useCanvasStore } from '../../stores/canvasStore'
import { generateCanvasNode, reconcileCanvasTasks } from './generation'

beforeEach(() => {
  mocks.projects.clear()
  mocks.submit.mockReset()
  mocks.mask.mockReset().mockResolvedValue('partial')
  mocks.beforeSave = undefined
  useCanvasStore.setState({ projects: [], hydrated: false, histories: {}, selectedNodeIds: {}, error: null })
  useStore.setState({ tasks: [] })
})

describe('画布生成任务闭环', () => {
  it('等待前一张画布保存期间的编辑不会被后一张画布的结果回填覆盖', async () => {
    const state = useCanvasStore.getState()
    const second = await state.createProject('第二张')
    const first = await state.createProject('第一张')
    for (const project of [first, second]) {
      await state.applyOperations(project.id, [{
        type: 'add_node', id: 'output', nodeType: 'image', metadata: { status: 'loading', taskId: project.id },
      }])
    }
    let edited: Promise<unknown> | undefined
    mocks.beforeSave = (project) => {
      if (project.id !== first.id) return
      mocks.beforeSave = undefined
      edited = state.applyOperations(second.id, [{ type: 'add_node', id: 'new-text', nodeType: 'text', metadata: { content: '刚输入的文字' } }])
    }
    useStore.setState({ tasks: [first, second].map((project) => ({
      id: project.id, status: 'done', outputImages: ['result'], params: { output_format: 'png' },
    } as unknown as TaskRecord)) })
    await vi.waitFor(() => expect(mocks.projects.get(second.id)?.nodes.find((node) => node.id === 'output')?.metadata?.status).toBe('success'))
    await edited
    expect(edited).toBeDefined()
    expect(state.getSnapshot(second.id).nodes.find((node) => node.id === 'new-text')?.metadata?.content).toBe('刚输入的文字')
    expect(mocks.projects.get(second.id)?.nodes.find((node) => node.id === 'new-text')?.metadata?.content).toBe('刚输入的文字')
  })

  it('全图遮罩失败后仍要求确认，确认重试沿用主图和遮罩而不静默失败', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [
      { type: 'add_node', id: 'image', nodeType: 'image', metadata: { prompt: '重绘', imageId: 'source', maskImageId: 'mask', maskTargetImageId: 'source' } },
    ])
    mocks.mask.mockResolvedValue('full')
    mocks.submit.mockRejectedValueOnce(new Error('模型暂时不可用'))
    await expect(generateCanvasNode(project.id, 'image', undefined, true)).rejects.toThrow('模型暂时不可用')
    const failed = state.getSnapshot(project.id).nodes.find((node) => node.metadata?.status === 'error')!
    await expect(generateCanvasNode(project.id, failed.id)).rejects.toThrow('确认全图重绘')
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    mocks.submit.mockResolvedValueOnce('retry-task')
    await generateCanvasNode(project.id, failed.id, undefined, true)
    expect(mocks.submit.mock.calls[1][0]).toMatchObject({ allowFullMask: true, maskImageId: 'mask', maskTargetImageId: 'source', inputImageIds: ['source'] })
  })

  it('部分失败保留成功图及逐项错误，刷新后的节点仍可显示失败数量和原因', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'config', nodeType: 'config', metadata: { prompt: '四张海报', count: 4 } }])
    mocks.submit.mockImplementationOnce(async (input) => {
      useStore.setState({
        tasks: [{ id: 'partial', requestId: input.requestId, status: 'running', params: { output_format: 'png' }, outputImages: [] } as unknown as TaskRecord],
      })
      return 'partial'
    })
    await generateCanvasNode(project.id, 'config')
    const errors = [
      { requestIndex: 2, error: '上游限流' },
      { requestIndex: 3, error: '请求超时' },
    ]
    useStore.setState({ tasks: [{ ...useStore.getState().tasks[0], status: 'done', outputImages: ['success-a', 'success-b'], outputErrors: errors }] })
    await reconcileCanvasTasks()
    await vi.waitFor(() =>
      expect(state.getSnapshot(project.id).nodes.find((node) => node.metadata?.taskId === 'partial')?.metadata?.outputErrors).toEqual(errors),
    )
    const metadata = mocks.projects.get(project.id)?.nodes.find((node) => node.metadata?.taskId === 'partial')?.metadata
    expect(metadata?.images).toHaveLength(2)
    expect(metadata?.outputErrors).toEqual(errors)
  })
  it('逐项错误是整页 HTML 时截断后回填，不因超过元数据上限而一直停在生成中', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'out', nodeType: 'image', metadata: { status: 'loading', taskId: 'html' } }])
    const errors = Array.from({ length: 120 }, (_, idx) => ({ requestIndex: idx, error: '<html>'.repeat(30000) }))
    useStore.setState({ tasks: [{ id: 'html', status: 'error', outputImages: [], outputErrors: errors, params: { output_format: 'png' } } as unknown as TaskRecord] })
    await reconcileCanvasTasks()
    await vi.waitFor(() => expect(mocks.projects.get(project.id)?.nodes.find((node) => node.id === 'out')?.metadata?.status).toBe('error'))
    const metadata = mocks.projects.get(project.id)?.nodes.find((node) => node.id === 'out')?.metadata
    expect(metadata?.outputErrors).toHaveLength(100)
    expect(metadata?.outputErrors?.[0].error).toHaveLength(10000)
  })

  it('一张画布保存失败时，其他画布的生成结果照常回填', async () => {
    const state = useCanvasStore.getState()
    // 新建的画布排在前面，先处理失败的那张
    const ok = await state.createProject('正常')
    const broken = await state.createProject('失败')
    for (const project of [broken, ok]) {
      await state.applyOperations(project.id, [{ type: 'add_node', id: 'out', nodeType: 'image', metadata: { status: 'loading', taskId: project.id } }])
    }
    mocks.beforeSave = (project) => {
      if (project.id === broken.id) throw new Error('quota')
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      useStore.setState({ tasks: [broken, ok].map((project) => ({
        id: project.id, status: 'done', outputImages: ['result'], params: { output_format: 'png' },
      } as unknown as TaskRecord)) })
      await reconcileCanvasTasks()
      await vi.waitFor(() => expect(mocks.projects.get(ok.id)?.nodes.find((node) => node.id === 'out')?.metadata?.status).toBe('success'))
    } finally {
      error.mockRestore()
    }
  })

  it('撤销恢复出生成中的节点时，按已完成的任务重新回填结果', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'out', nodeType: 'image', metadata: { status: 'loading', requestId: 'request-1' } }])
    useStore.setState({ tasks: [{ id: 'task-1', requestId: 'request-1', status: 'running', outputImages: [], params: { output_format: 'png' } } as unknown as TaskRecord] })
    // 生成期间做了别的编辑，撤销点里的 out 仍是生成中
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'note', nodeType: 'text' }])
    useStore.setState({ tasks: [{ id: 'task-1', requestId: 'request-1', status: 'done', outputImages: ['result'], params: { output_format: 'png' } } as unknown as TaskRecord] })
    await vi.waitFor(() => expect(state.getSnapshot(project.id).nodes.find((node) => node.id === 'out')?.metadata?.status).toBe('success'))
    await state.undo(project.id)
    await vi.waitFor(() => expect(state.getSnapshot(project.id).nodes.find((node) => node.id === 'out')?.metadata).toMatchObject({ status: 'success', imageId: 'result' }))
  })

  it('节点单独选择的模型带上画布展示的价格版本提交', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [{ type: 'add_node', id: 'config', nodeType: 'config', metadata: { prompt: '海报', model: 'image-b' } }])
    mocks.submit.mockResolvedValue('task')
    await generateCanvasNode(project.id, 'config', undefined, false, 'quote-b')
    expect(mocks.submit.mock.calls[0][0]).toMatchObject({ model: 'image-b', priceVersion: 'quote-b' })
  })

  it('共用任务入口、传递模型与上游引用、运行中重复点击不重复提交', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [
      { type: 'add_node', id: 'prompt', nodeType: 'text', metadata: { content: '月光下的山' } },
      { type: 'add_node', id: 'reference', nodeType: 'image', metadata: { imageId: 'source-image' } },
      { type: 'add_node', id: 'config', nodeType: 'config', metadata: { prompt: '写实风格', model: 'image-model', count: 2 } },
      { type: 'connect_nodes', fromNodeId: 'prompt', toNodeId: 'config' },
      { type: 'connect_nodes', fromNodeId: 'reference', toNodeId: 'config' },
    ])
    mocks.submit.mockImplementation(async (input) => {
      useStore.setState({
        tasks: [
          { id: 'generated-task', requestId: input.requestId, status: 'running', outputImages: [], params: { output_format: 'png' } } as unknown as TaskRecord,
        ],
      })
      return 'generated-task'
    })
    const first = generateCanvasNode(project.id, 'config')
    const simultaneous = generateCanvasNode(project.id, 'config')
    expect(first).toBe(simultaneous)
    expect(await first).toBe('generated-task')
    expect(await generateCanvasNode(project.id, 'config')).toBe('generated-task')
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.submit.mock.calls[0][0]).toMatchObject({
      prompt: '写实风格\n\n月光下的山',
      model: 'image-model',
      params: { n: 2 },
      inputImageIds: ['source-image'],
    })
    const task = useStore.getState().tasks[0]
    useStore.setState({ tasks: [{ ...task, status: 'done', outputImages: ['result-a', 'result-b'], error: null }] })
    await reconcileCanvasTasks()
    await vi.waitFor(() => expect(state.getSnapshot(project.id).nodes.find((node) => node.metadata?.taskId === task.id)?.metadata?.status).toBe('success'))
    const result = state.getSnapshot(project.id).nodes.find((node) => node.metadata?.taskId === task.id)!
    expect(result.metadata?.images?.map((image) => image.storageKey)).toEqual(['result-a', 'result-b'])
    expect(result.metadata?.imageId).toBe('result-a')
    expect(state.getReferencedImageIds()).toContain('result-b')
  })

  it('任务提交失败保留错误节点，既不假装生成成功也不自动重试', async () => {
    const state = useCanvasStore.getState()
    const project = await state.createProject()
    await state.applyOperations(project.id, [
      {
        type: 'add_node',
        id: 'config',
        nodeType: 'config',
        metadata: { prompt: '测试', model: 'retry-model', size: '1024x1024', quality: 'high', count: 2, references: ['reference-a'] },
      },
    ])
    mocks.submit.mockRejectedValueOnce(new Error('余额不足'))
    await expect(generateCanvasNode(project.id, 'config')).rejects.toThrow('余额不足')
    const result = state.getSnapshot(project.id).nodes.find((node) => node.id !== 'config')!
    expect(result.metadata).toMatchObject({
      status: 'error',
      errorDetails: '余额不足',
      model: 'retry-model',
      size: '1024x1024',
      quality: 'high',
      count: 2,
      references: ['reference-a'],
    })
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    mocks.submit.mockRejectedValueOnce(new Error('余额不足'))
    await expect(generateCanvasNode(project.id, result.id)).rejects.toThrow('余额不足')
    expect(mocks.submit.mock.calls[1][0]).toMatchObject({
      prompt: '测试',
      model: 'retry-model',
      params: { size: '1024x1024', quality: 'high', n: 2 },
      inputImageIds: ['reference-a'],
    })
  })
})
