import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation } from './types'
import type { CanvasProject } from '../canvas/types'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  apply: vi.fn(),
  snapshot: vi.fn(),
  getImage: vi.fn(),
  projects: [] as Pick<CanvasProject, 'id' | 'nodes' | 'hiddenAt'>[],
  tasks: [] as Array<{ id: string; status: string; outputImages: string[]; prompt: string; error: string | null; params: { n: number } }>,
  dialog: null as null | { message?: string; action?: () => void; cancelAction?: () => void },
  backend: false,
  models: vi.fn(),
  listeners: new Set<(state: { confirmDialog: unknown }) => void>(),
}))
vi.mock('../../store', () => ({
  useStore: {
    getState: () => ({ tasks: mocks.tasks, settings: {}, confirmDialog: mocks.dialog, setConfirmDialog: (dialog: typeof mocks.dialog) => {
      mocks.dialog = dialog
      for (const listener of [...mocks.listeners]) listener({ confirmDialog: dialog })
    } }),
    subscribe: (listener: (state: { confirmDialog: unknown }) => void) => {
      mocks.listeners.add(listener)
      return () => mocks.listeners.delete(listener)
    },
  },
}))
vi.mock('../apiProfiles', () => ({ getActiveApiProfile: () => ({ model: 'gpt-image-2' }) }))
vi.mock('../gouoBackend', () => ({ isBackendAuthEnabled: () => mocks.backend, getImageModels: mocks.models }))
vi.mock('../../stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ projects: mocks.projects, hydrate: async () => {}, getSnapshot: mocks.snapshot, applyOperations: mocks.apply }) } }))
vi.mock('../db', () => ({ getImage: mocks.getImage }))
vi.mock('../imageTasks', () => ({ submitImageTask: mocks.submit }))

import { executeAgentTool, parseToolArguments } from './tools'
import { applyCanvasAgentOps } from '../canvas/agentOps'
import type { CanvasAgentSnapshot } from '../canvas/agentOps'

const conversation: AgentConversation = { id: 'conversation', schemaVersion: 1, title: '测试', modelId: 'model', projectId: 'canvas', messages: [], draft: '', referenceImageIds: ['reference'], status: 'idle', createdAt: 1, updatedAt: 1, revision: 1 }
const run = (name: string, args: unknown, item = conversation) => executeAgentTool({ conversation: item, name, arguments: JSON.stringify(args), callId: 'call_1', signal: new AbortController().signal })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tasks = []
  mocks.dialog = null
  mocks.backend = false
  mocks.projects = [{ id: 'canvas', nodes: [{ id: 'canvas-image', type: 'image', title: '参考图', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { imageId: 'canvas-reference' } }] }]
  mocks.snapshot.mockReturnValue({ id: 'canvas', nodes: [], revision: 2 })
  mocks.apply.mockResolvedValue({ id: 'canvas', nodes: [], revision: 3 })
  mocks.submit.mockResolvedValue('task')
})

describe('Agent tool boundary', () => {
  it('rejects unknown tools and unexpected project targets', () => {
    expect(() => parseToolArguments('execute_shell', '{}')).toThrow('不支持')
    expect(() => parseToolArguments('get_canvas', '{"projectId":"other"}')).toThrow('不支持的字段')
    expect(() => parseToolArguments('get_canvas', '[]')).toThrow('必须为对象')
    expect(() => parseToolArguments('apply_canvas_operations', '{"expectedRevision":2,"operations":[{"__proto__":{"polluted":true}}]}')).toThrow('禁止的字段')
  })

  it('asks the user before an Agent run submits more than 4 images for one message', async () => {
    const call = (id: string, n: number, status: 'done' | 'error' = 'done') => ({ id, name: 'create_image_task', arguments: JSON.stringify({ prompt: '图', params: { n } }), status })
    const earlier = { ...conversation, messages: [
      { id: 'old-user', role: 'user' as const, content: '上一条', createdAt: 1 },
      { id: 'old-assistant', role: 'assistant' as const, content: '', createdAt: 2, toolCalls: [call('old', 4)] },
      { id: 'user', role: 'user' as const, content: '画几张海报', createdAt: 3 },
      { id: 'assistant', role: 'assistant' as const, content: '', createdAt: 4, toolCalls: [call('done', 2), call('failed', 4, 'error')] },
    ] }
    // 本条消息已提交 2 张（失败的、上一条消息的不计），再提交 2 张不超过上限，无需确认
    await expect(run('create_image_task', { prompt: '海报', params: { n: 2 } }, earlier)).resolves.toMatchObject({ taskIds: ['task'] })
    expect(mocks.dialog).toBeNull()

    // 再提交 3 张超过上限：用户取消则不提交
    const cancelled = run('create_image_task', { prompt: '海报', params: { n: 3 } }, earlier)
    await vi.waitFor(() => expect(mocks.dialog).not.toBeNull())
    mocks.dialog!.cancelAction!()
    await expect(cancelled).rejects.toThrow('没有确认')
    expect(mocks.submit).toHaveBeenCalledTimes(1)

    // 用户确认后提交
    mocks.dialog = null
    const confirmed = run('create_image_task', { prompt: '海报', params: { n: 10 } }, earlier)
    await vi.waitFor(() => expect(mocks.dialog).not.toBeNull())
    mocks.dialog!.action!()
    await expect(confirmed).resolves.toMatchObject({ taskIds: ['task'] })
    expect(mocks.submit).toHaveBeenCalledTimes(2)
  })

  it('shows the expected charge from the current model price in the confirmation', async () => {
    mocks.backend = true
    mocks.models.mockResolvedValue([{ id: 'gpt-image-2', price_cny: 0.15 }])
    const pending = run('create_image_task', { prompt: '海报', params: { n: 5 } })
    await vi.waitFor(() => expect(mocks.dialog).not.toBeNull())
    expect(mocks.dialog!.message).toContain('每张 ¥0.15')
    expect(mocks.dialog!.message).toContain('预计扣费 ¥0.75')
    mocks.dialog!.action!()
    await expect(pending).resolves.toMatchObject({ taskIds: ['task'] })

    // 读取价格失败时仍要求确认，只是不显示金额
    mocks.dialog = null
    mocks.models.mockRejectedValue(new Error('offline'))
    const fallback = run('create_image_task', { prompt: '海报', params: { n: 5 } })
    await vi.waitFor(() => expect(mocks.dialog).not.toBeNull())
    expect(mocks.dialog!.message).toContain('按所选图片模型的价格计费')
    mocks.dialog!.cancelAction!()
    await expect(fallback).rejects.toThrow('没有确认')
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })

  it('treats closing the confirmation without choosing as cancel', async () => {
    const pending = run('create_image_task', { prompt: '海报', params: { n: 5 } })
    await vi.waitFor(() => expect(mocks.dialog).not.toBeNull())
    // 点遮罩或按 Esc：弹窗直接被清掉，不经过 cancelAction
    for (const listener of [...mocks.listeners]) listener({ confirmDialog: null })
    await expect(pending).rejects.toThrow('没有确认')
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.listeners.size).toBe(0)
  })

  it('does not submit when the run is stopped while waiting for confirmation', async () => {
    const controller = new AbortController()
    const pending = executeAgentTool({ conversation, name: 'create_image_task', arguments: JSON.stringify({ prompt: '海报', params: { n: 5 } }), callId: 'call_1', signal: controller.signal })
    await vi.waitFor(() => expect(mocks.dialog).not.toBeNull())
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(mocks.dialog).toBeNull()
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('sends image work through the shared task service with a stable request ID', async () => {
    expect(await run('create_image_task', { prompt: '海报', inputImageIds: ['reference'], params: { n: 1 } })).toMatchObject({ taskIds: ['task'] })
    expect(mocks.submit).toHaveBeenCalledWith({ prompt: '海报', inputImageIds: ['reference'], params: { n: 1 }, source: { kind: 'agent', conversationId: 'conversation', projectId: 'canvas' }, requestId: 'agent:conversation:call_1', signal: expect.any(AbortSignal) })
  })

  it.each([undefined, false, true])('ends after image submission only when explicitly requested (%s)', async (finishAfterSubmit) => {
    const output = await run('create_image_task', { prompt: '海报', finishAfterSubmit })
    expect(output).toMatchObject({ taskIds: ['task'], finishAfterSubmit: finishAfterSubmit === true })
    expect(JSON.parse(output.result)).toMatchObject({ status: 'running' })
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-boolean finish flag before creating a paid task', async () => {
    await expect(run('create_image_task', { prompt: '海报', finishAfterSubmit: 'true' })).rejects.toThrow('布尔')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('does not finish early when an already-submitted task has failed', async () => {
    mocks.tasks = [{ id: 'task', status: 'error', outputImages: [], prompt: '海报', error: '上游拒绝', params: { n: 1 } }]
    const output = await run('create_image_task', { prompt: '海报', finishAfterSubmit: true })
    expect(output.finishAfterSubmit).toBe(false)
    expect(JSON.parse(output.result)).toMatchObject({ status: 'error', error: '上游拒绝' })
  })

  it('rejects unprovided images and invalid generation counts before submitting', async () => {
    await expect(run('create_image_task', { prompt: '图', inputImageIds: ['other-user-image'] })).rejects.toThrow('只能使用')
    await expect(run('create_image_task', { prompt: '图', params: { n: 1.5 } })).rejects.toThrow('数量无效')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'missing'])('allows image generation and conversation references when the linked canvas is %s', async (status) => {
    if (status === 'hidden') mocks.projects[0].hiddenAt = 1
    else mocks.projects = []
    mocks.snapshot.mockImplementation(() => { throw new Error('画布不存在或已在回收站') })

    await run('create_image_task', { prompt: '大熊猫', inputImageIds: [] })
    await run('create_image_task', { prompt: '参考图片生成' })
    expect(mocks.submit).toHaveBeenCalledTimes(2)
    expect(mocks.submit).toHaveBeenLastCalledWith(expect.objectContaining({ inputImageIds: ['reference'] }))
    await expect(run('select_reference', { imageIds: ['reference'] })).resolves.toMatchObject({ referenceImageIds: ['reference'] })
    await expect(run('create_image_task', { prompt: '图', inputImageIds: ['canvas-reference'] })).rejects.toThrow('只能使用')
    await expect(run('get_canvas', {})).rejects.toThrow('画布不存在')
    expect(mocks.submit).toHaveBeenCalledTimes(2)
  })

  it('allows reference images from an available linked canvas', async () => {
    await run('create_image_task', { prompt: '海报', inputImageIds: ['canvas-reference'] })
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ inputImageIds: ['canvas-reference'] }))
  })

  it('blocks a new paid tool call when an earlier submission is still unconfirmed', async () => {
    const interrupted: AgentConversation = { ...conversation, messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [{ id: 'older-call', name: 'create_image_task', arguments: '{}', status: 'error', recovery: 'unconfirmed' }] }] }
    await expect(run('create_image_task', { prompt: '继续生成' }, interrupted)).rejects.toThrow('不会再次提交')
    expect(mocks.submit).not.toHaveBeenCalled()
    interrupted.messages[0].toolCalls![0].recovery = 'acknowledged'
    await run('create_image_task', { prompt: '已核对后新的创作' }, interrupted)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })

  it('reports partial failures to the Agent instead of describing the whole task as successful', async () => {
    const task = { id: 'task', status: 'done', outputImages: ['image'], params: { n: 3 }, outputErrors: [{ requestIndex: 1, error: 'timeout' }, { requestIndex: 2, error: 'denied' }], prompt: '图', error: null }
    mocks.tasks = [task]
    const output = await run('get_task_status', { taskId: 'task' }, { ...conversation, messages: [{ id: 'm', role: 'tool', content: '{}', createdAt: 1, taskIds: ['task'] }] })
    expect(JSON.parse(output.result)).toMatchObject({ requestedCount: 3, successCount: 1, failedCount: 2, outputErrors: task.outputErrors })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('requires revision and rejects image injection inside update operations', async () => {
    await expect(run('apply_canvas_operations', { expectedRevision: -1, operations: [{ type: 'delete_node', id: 'x' }] })).rejects.toThrow('revision')
    await expect(run('apply_canvas_operations', { expectedRevision: 2, operations: [{ type: 'update_node', id: 'x', patch: { metadata: { imageId: 'unknown' } } }] })).rejects.toThrow('未授权')
    await expect(run('apply_canvas_operations', { expectedRevision: 2, operations: [{ type: 'add_node', nodeType: 'image', metadata: { content: 'https://example.com/track.png' } }] })).rejects.toThrow('图片 ID')
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('returns a document-only snapshot without embedded images or unrelated private fields', async () => {
    mocks.snapshot.mockReturnValue({ id: 'canvas', nodes: [{ id: 'image', type: 'image', metadata: { content: 'data:image/png;base64,private', imageId: 'reference', apiKey: 'node-secret' } }], connections: [], apiKey: 'secret-token', revision: 2 })
    const output = await run('get_canvas', {})
    expect(output.result).not.toContain('data:image')
    expect(output.result).not.toContain('secret-token')
    expect(output.result).not.toContain('node-secret')
    expect(output.result).toContain('reference')
  })

  it('cannot query or attach an unrelated task', async () => {
    mocks.tasks = [{ id: 'other', status: 'done', outputImages: ['image'], prompt: '图', error: null, params: { n: 1 } }]
    await expect(run('get_task_status', { taskId: 'other' })).rejects.toThrow('本会话')
  })

  it('adds a completed result using the canvas operation schema', async () => {
    mocks.tasks = [{ id: 'task', status: 'done', outputImages: ['image'], prompt: '图', error: null, params: { n: 1 } }]
    mocks.getImage.mockResolvedValue({ id: 'image', width: 1024, height: 1024 })
    await run('add_task_output', { taskId: 'task' }, { ...conversation, messages: [{ id: 'm', role: 'tool', content: '{}', createdAt: 1, taskIds: ['task'] }] })
    expect(mocks.apply).toHaveBeenCalledWith('canvas', [expect.objectContaining({ type: 'add_node', nodeType: 'image', metadata: expect.objectContaining({ imageId: 'image', taskId: 'task' }) })], 2)
  })

  it('adds a generated image next to a real text document and survives strict canvas validation', async () => {
    const snapshot: CanvasAgentSnapshot = { id: 'canvas', projectId: 'canvas', title: '现有画布', schemaVersion: 1, revision: 2, createdAt: 1, updatedAt: 1, nodes: [{ id: 'text', type: 'text', title: '笔记', position: { x: 80, y: 80 }, width: 340, height: 240, metadata: { content: '测试文本', status: 'idle' } }], connections: [], selectedNodeIds: [], viewport: { x: 200, y: 180, k: 1 }, backgroundMode: 'lines', showImageInfo: false }
    mocks.snapshot.mockReturnValue(snapshot)
    mocks.tasks = [{ id: 'task', status: 'done', outputImages: ['image'], prompt: '生成一张雨后城市海报', error: null, params: { n: 1 } }]
    mocks.getImage.mockResolvedValue({ id: 'image', width: 1024, height: 1536 })
    mocks.apply.mockImplementation(async (_id, operations, expectedRevision) => {
      expect(expectedRevision).toBe(snapshot.revision)
      const result = applyCanvasAgentOps(snapshot, operations)
      expect(result.nodes).toHaveLength(2)
      expect(result.nodes[1]).toMatchObject({ type: 'image', metadata: { imageId: 'image', storageKey: 'image', content: '' } })
      return result
    })
    const output = await run('add_task_output', { taskId: 'task' }, { ...conversation, messages: [{ id: 'm', role: 'tool', content: '{}', createdAt: 1, taskIds: ['task'] }] })
    expect(JSON.parse(output.result).added).toBe(1)
  })
})
