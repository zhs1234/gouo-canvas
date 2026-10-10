import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../lib/agent/types'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'

const mocks = vi.hoisted(() => ({
  stored: [] as unknown[],
  put: vi.fn(),
  stream: vi.fn(),
  tool: vi.fn(),
  toast: vi.fn(),
  currentScope: true,
  tasks: [] as TaskRecord[],
  storedTasks: [] as TaskRecord[],
  onTasks: undefined as ((state: { tasks: TaskRecord[] }, previous: { tasks: TaskRecord[] }) => void) | undefined,
}))
vi.mock('../store', () => ({
  ensureImageCached: vi.fn(async () => 'data:image/png;base64,aGVsbG8='),
  useStore: { getState: () => ({ tasks: mocks.tasks, showToast: mocks.toast }), subscribe: (listener: typeof mocks.onTasks) => { mocks.onTasks = listener } },
}))
vi.mock('../lib/db', () => ({ getAllAgentConversations: async () => mocks.stored, getAllTasks: async () => mocks.storedTasks, putAgentConversation: mocks.put }))
vi.mock('../lib/documentAssets', () => ({ registerDocumentImageReferences: vi.fn() }))
vi.mock('../lib/storageScope', () => ({ isStorageScopeCurrent: () => mocks.currentScope }))
vi.mock('../lib/agent/api', () => ({ getAgentModels: async () => [{ id: 'model', name: '测试', tool_calls: true, vision: true }], streamAgentCompletion: mocks.stream }))
vi.mock('../lib/agent/tools', () => ({ agentToolDefinitions: [], executeAgentTool: mocks.tool }))

import { buildAgentMessages, markAgentPersisted, normalizeAgentConversation, useAgentStore } from './agentStore'

const base: AgentConversation = { id: 'conversation', schemaVersion: 1, title: '测试', modelId: 'model', messages: [], draft: '画一张海报', referenceImageIds: [], status: 'idle', createdAt: 1, updatedAt: 1, revision: 1 }

beforeEach(async () => {
  await useAgentStore.getState().flush()
  vi.clearAllMocks()
  mocks.stream.mockReset()
  mocks.tool.mockReset()
  mocks.currentScope = true
  mocks.stored = []
  mocks.tasks = []
  mocks.storedTasks = []
  mocks.put.mockResolvedValue(undefined)
  base.revision += 100
  markAgentPersisted(base)
  useAgentStore.setState({ conversations: [structuredClone(base)], models: [{ id: 'model', name: '测试', tool_calls: true, vision: true }], hydrated: true })
})

describe('Agent durable runtime', () => {
  it('acknowledges a terminal image submission without another model request', async () => {
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ id: 'finish-call', name: 'create_image_task', arguments: '{"prompt":"海报","finishAfterSubmit":true}', status: 'pending' }] }).mockResolvedValue({ content: '不应再请求模型', calls: [] })
    mocks.tool.mockResolvedValueOnce({ result: '{"taskId":"poster","status":"running"}', taskIds: ['poster'], finishAfterSubmit: true })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    const conversation = useAgentStore.getState().conversations[0]
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    expect(conversation.messages.find((message) => message.taskIds?.includes('poster'))).toBeDefined()
    expect(conversation.messages[conversation.messages.length - 1].content).toContain('后台')
    expect(conversation.messages[conversation.messages.length - 1].content).toContain('不代表图片已生成完成')
  })

  it('submits every planned image task before the final submission ends the run', async () => {
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ id: 'first', name: 'create_image_task', arguments: '{"prompt":"海报一","finishAfterSubmit":false}', status: 'pending' }] })
      .mockResolvedValueOnce({ content: '', calls: [{ id: 'last', name: 'create_image_task', arguments: '{"prompt":"海报二","finishAfterSubmit":true}', status: 'pending' }] })
      .mockResolvedValue({ content: '不应再请求模型', calls: [] })
    mocks.tool.mockResolvedValueOnce({ result: '{"taskId":"one","status":"running"}', taskIds: ['one'], finishAfterSubmit: false })
      .mockResolvedValueOnce({ result: '{"taskId":"two","status":"running"}', taskIds: ['two'], finishAfterSubmit: true })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.stream).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenCalledTimes(2)
    expect(useAgentStore.getState().conversations[0].messages.flatMap((message) => message.taskIds || [])).toEqual(['one', 'two'])
  })

  it.each([undefined, false])('preserves follow-up canvas work when finishAfterSubmit is %s', async (finishAfterSubmit) => {
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ id: 'create', name: 'create_image_task', arguments: JSON.stringify({ prompt: '海报', finishAfterSubmit }), status: 'pending' }] })
      .mockResolvedValueOnce({ content: '', calls: [{ id: 'canvas', name: 'get_canvas', arguments: '{}', status: 'pending' }] })
      .mockResolvedValueOnce({ content: '已读取画布，图片后台继续生成', calls: [] })
    mocks.tool.mockResolvedValueOnce({ result: '{"taskId":"poster","status":"running"}', taskIds: ['poster'], finishAfterSubmit })
      .mockResolvedValueOnce({ result: '{"projectId":"canvas","revision":1}' })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.stream).toHaveBeenCalledTimes(3)
    expect(mocks.tool).toHaveBeenCalledTimes(2)
    expect(mocks.tool).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'get_canvas' }))
  })

  it('keeps planning when another tool follows a marked submission in the same batch', async () => {
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [
      { id: 'create', name: 'create_image_task', arguments: '{"prompt":"海报","finishAfterSubmit":true}', status: 'pending' },
      { id: 'canvas', name: 'get_canvas', arguments: '{}', status: 'pending' },
    ] }).mockResolvedValueOnce({ content: '已读取画布，继续安排后续操作', calls: [] })
    mocks.tool.mockResolvedValueOnce({ result: '{"taskId":"poster","status":"running"}', taskIds: ['poster'], finishAfterSubmit: true })
      .mockResolvedValueOnce({ result: '{"projectId":"canvas","revision":1}' })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.tool).toHaveBeenCalledTimes(2)
    expect(mocks.stream).toHaveBeenCalledTimes(2)
  })

  it.each(['submission', 'following-operation'])('does not acknowledge completion when %s fails', async (source) => {
    const calls = [{ id: 'create', name: 'create_image_task', arguments: '{"prompt":"海报","finishAfterSubmit":true}', status: 'pending' }]
    if (source === 'following-operation') {
      calls.push({ id: 'canvas', name: 'get_canvas', arguments: '{}', status: 'pending' })
      mocks.tool.mockResolvedValueOnce({ result: '{"taskId":"poster","status":"running"}', taskIds: ['poster'], finishAfterSubmit: true })
    }
    mocks.tool.mockRejectedValueOnce(new Error('工具暂时不可用'))
    mocks.stream.mockResolvedValueOnce({ content: '', calls }).mockResolvedValueOnce({ content: '工具暂时不可用，请检查后继续', calls: [] })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.stream).toHaveBeenCalledTimes(2)
    const messages = useAgentStore.getState().conversations[0].messages
    expect(messages[messages.length - 1].content).toBe('工具暂时不可用，请检查后继续')
  })

  it('does not mark a stream parsing failure as a submitted image request', async () => {
    mocks.stream.mockImplementationOnce(async ({ onUpdate }) => {
      onUpdate('准备生成', [{ id: 'call_partial', name: 'create_image_task', arguments: '{"prompt":"', status: 'pending' }])
      throw new Error('Agent 服务事件无效')
    })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('error'))
    await useAgentStore.getState().flush()
    const conversation = useAgentStore.getState().conversations[0]
    const call = conversation.messages.find((message) => message.role === 'assistant')?.toolCalls?.[0]
    expect(call).toMatchObject({ execution: 'not_started', status: 'error' })
    expect(call?.recovery).toBeUndefined()
    expect(call?.result).toContain('not_started')
    expect(mocks.tool).not.toHaveBeenCalled()
    const messages = await buildAgentMessages(conversation, useAgentStore.getState().models[0])
    expect(messages.some((message) => message.role === 'tool' || message.tool_calls?.length)).toBe(false)
    expect(messages[0].content).toContain('未提交任务')
  })

  it('submits an image tool once after repeated stream IDs and persists execution before dispatch', async () => {
    const api = await vi.importActual<typeof import('../lib/agent/api')>('../lib/agent/api')
    const callId = `call_${'a'.repeat(32)}`
    const args = JSON.stringify({ prompt: '竹林中的大熊猫' })
    const events = Array.from({ length: Math.ceil(args.length / 3) }, (_, index) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: callId, function: { name: 'create_image_task', arguments: args.slice(index * 3, index * 3 + 3) } }] }, finish_reason: null }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    mocks.stream.mockImplementationOnce(({ onUpdate, signal }) => api.consumeChatStream(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(events)); controller.close() } }), onUpdate, signal)).mockResolvedValueOnce({ content: '图片已提交，后台继续生成', calls: [] })
    mocks.tool.mockImplementationOnce(async () => {
      expect(mocks.put.mock.calls.some(([conversation]) => conversation.messages.some((message: AgentConversation['messages'][number]) => message.toolCalls?.some((call) => call.id === callId && call.execution === 'started' && call.status === 'running')))).toBe(true)
      return { result: '{"taskId":"panda-task","status":"running"}', taskIds: ['panda-task'] }
    })
    await useAgentStore.getState().send('conversation', '帮我生成一张大熊猫图片')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    expect(mocks.tool).toHaveBeenCalledWith(expect.objectContaining({ name: 'create_image_task', callId, arguments: args }))
    expect(useAgentStore.getState().conversations[0].messages.find((message) => message.taskIds?.includes('panda-task'))).toBeDefined()
    const sentCall = mocks.stream.mock.calls[1][0].messages.find((message: { tool_calls?: unknown[] }) => message.tool_calls?.length).tool_calls[0]
    expect(sentCall).toMatchObject({ id: callId, function: { name: 'create_image_task', arguments: args } })
  })

  it.each(['disk', 'cloud'])('repairs the old %s parsing failure and omits its malformed tool protocol when continuing', async (source) => {
    const oldId = `call_${'a'.repeat(32)}`.repeat(5)
    const oldResult = JSON.stringify({ status: 'unconfirmed', requestId: `agent:conversation:${oldId}` })
    mocks.stored = [{ ...base, status: 'error', error: 'Agent 工具参数超过长度上限', messages: [
      { id: 'user', role: 'user', content: '帮我生成一张大熊猫图片', createdAt: 1 },
      { id: 'assistant', role: 'assistant', content: '准备生成', createdAt: 2, toolCalls: [{ id: oldId, name: 'create_image_task', arguments: '{"prompt":"大熊猫', status: 'error', recovery: 'unconfirmed', result: oldResult }] },
      { id: 'tool', role: 'tool', content: oldResult, toolCallId: oldId, toolName: 'create_image_task', createdAt: 2 },
    ] }]
    if (source === 'disk') {
      useAgentStore.setState({ hydrated: false, conversations: [] })
      await useAgentStore.getState().hydrate()
      const restored = useAgentStore.getState().conversations[0]
      expect(restored.messages[1].toolCalls?.[0]).toMatchObject({ id: oldId, execution: 'not_started' })
      expect(restored.messages[1].toolCalls?.[0].recovery).toBeUndefined()
    } else {
      useAgentStore.setState({ conversations: mocks.stored as AgentConversation[] })
    }
    expect(mocks.tool).not.toHaveBeenCalled()
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ id: 'new-call', name: 'create_image_task', arguments: '{"prompt":"大熊猫"}', status: 'pending' }] }).mockResolvedValueOnce({ content: '已提交', calls: [] })
    mocks.tool.mockResolvedValueOnce({ result: '{"taskId":"new-task"}', taskIds: ['new-task'] })
    await useAgentStore.getState().send('conversation', '请继续完成上一个请求')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    const history = mocks.stream.mock.calls[0][0].messages
    expect(history.some((message: { role: string; tool_calls?: unknown[] }) => message.role === 'tool' || message.tool_calls?.length)).toBe(false)
    expect(history[0].content).toContain('未提交任务')
    expect(mocks.tool).toHaveBeenCalledTimes(1)
  })

  it.each(['running', 'done', 'error'] as const)('reconciles an interrupted submitted %s image task from disk before the app task store loads', async (status) => {
    const call = { id: 'lost-call', name: 'create_image_task', arguments: '{"prompt":"海报"}', status: 'running' as const }
    mocks.stored = [{ ...base, status: 'running', messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [call] }] }]
    mocks.storedTasks = [{ id: 'recovered-task', requestId: 'agent:conversation:lost-call', source: { kind: 'agent', conversationId: 'conversation' }, status, outputImages: status === 'done' ? ['saved-image'] : [], params: { ...DEFAULT_PARAMS, n: 1 }, error: status === 'error' ? '原请求超时' : null, prompt: '海报', inputImageIds: [], createdAt: 1, finishedAt: null, elapsed: null }]
    useAgentStore.setState({ hydrated: false, conversations: [] })
    await useAgentStore.getState().hydrate()
    const recovered = useAgentStore.getState().conversations[0]
    expect(recovered.status).toBe('interrupted')
    expect(recovered.messages[0].toolCalls?.[0]).toMatchObject({ status: 'done', recovery: 'matched' })
    expect(recovered.messages[1]).toMatchObject({ role: 'tool', toolCallId: 'lost-call', taskIds: ['recovered-task'], referenceImageIds: status === 'done' ? ['saved-image'] : [] })
    expect(JSON.parse(recovered.messages[1].content)).toMatchObject({ taskId: 'recovered-task', status })
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ messages: recovered.messages, revision: base.revision + 1 }), base.revision)
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.tool).not.toHaveBeenCalled()
    mocks.stored = [recovered]
    mocks.put.mockClear()
    useAgentStore.setState({ hydrated: false })
    await useAgentStore.getState().hydrate()
    expect(useAgentStore.getState().conversations[0].messages).toHaveLength(2)
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('keeps unmatched results explicit and reconciles later-loaded tasks without submitting anything', async () => {
    mocks.stored = [{ ...base, status: 'running', messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [{ id: 'lost-call', name: 'create_image_task', arguments: '{}', status: 'running' }] }] }]
    useAgentStore.setState({ hydrated: false, conversations: [] })
    await useAgentStore.getState().hydrate()
    let conversation = useAgentStore.getState().conversations[0]
    expect(conversation.messages[0].toolCalls?.[0].recovery).toBe('unconfirmed')
    expect(conversation.messages[1].content).toContain('不能认定未扣费')
    const messages = await buildAgentMessages(conversation, useAgentStore.getState().models[0])
    expect(messages[messages.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'lost-call', content: expect.stringContaining('unconfirmed') })
    const previous = mocks.tasks
    mocks.tasks = [{ id: 'later-task', requestId: 'agent:conversation:lost-call', source: { kind: 'agent', conversationId: 'conversation' }, status: 'running', outputImages: [], params: { ...DEFAULT_PARAMS, n: 1 }, error: null, prompt: '海报', inputImageIds: [], createdAt: 1, finishedAt: null, elapsed: null }]
    mocks.onTasks!({ tasks: mocks.tasks }, { tasks: previous })
    conversation = useAgentStore.getState().conversations[0]
    expect(conversation.messages).toHaveLength(2)
    expect(conversation.messages[0].toolCalls?.[0].recovery).toBe('matched')
    expect(conversation.messages[1].taskIds).toEqual(['later-task'])
    const runningTasks = mocks.tasks
    mocks.tasks = [{ ...mocks.tasks[0], status: 'done', outputImages: ['finished-image'] }]
    mocks.onTasks!({ tasks: mocks.tasks }, { tasks: runningTasks })
    expect(useAgentStore.getState().conversations[0].messages[1].referenceImageIds).toEqual(['finished-image'])
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.tool).not.toHaveBeenCalled()
    await useAgentStore.getState().flush()
  })

  it('rejects an obsolete model until the one available model is explicitly selected', async () => {
    useAgentStore.setState({ conversations: [{ ...base, modelId: 'removed-model' }] })
    await expect(useAgentStore.getState().send('conversation')).rejects.toThrow('选择可用')
    expect(mocks.stream).not.toHaveBeenCalled()
    useAgentStore.getState().configureConversation('conversation', { modelId: 'model' })
    mocks.stream.mockResolvedValueOnce({ content: '可用模型回复', calls: [] })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ model: 'model' }))
  })

  it('does not execute a paid call again when a resumed model repeats the recovered tool ID', async () => {
    const call = { id: 'lost-call', name: 'create_image_task', arguments: '{"prompt":"海报"}', status: 'running' as const }
    mocks.stored = [{ ...base, status: 'running', messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [call] }] }]
    mocks.storedTasks = [{ id: 'recovered-task', requestId: 'agent:conversation:lost-call', source: { kind: 'agent', conversationId: 'conversation' }, status: 'running', outputImages: [], params: { ...DEFAULT_PARAMS, n: 1 }, error: null, prompt: '海报', inputImageIds: [], createdAt: 1, finishedAt: null, elapsed: null }]
    useAgentStore.setState({ hydrated: false, conversations: [] })
    await useAgentStore.getState().hydrate()
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ ...call, status: 'pending' }] }).mockResolvedValueOnce({ content: '原任务继续生成', calls: [] })
    await useAgentStore.getState().send('conversation', '继续')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.tool).not.toHaveBeenCalled()
    expect(useAgentStore.getState().conversations[0].messages.filter((message) => message.taskIds?.includes('recovered-task'))).toHaveLength(1)
  })

  it('persists an explicit acknowledgement, keeps the original result and still caches its tool ID', async () => {
    const call = { id: 'unknown-call', name: 'create_image_task', arguments: '{"prompt":"海报"}', status: 'running' as const }
    mocks.stored = [{ ...base, status: 'running', messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [call] }] }]
    useAgentStore.setState({ hydrated: false, conversations: [] })
    await useAgentStore.getState().hydrate()
    const originalResult = useAgentStore.getState().conversations[0].messages[0].toolCalls![0].result
    expect(useAgentStore.getState().conversations[0].messages[0].toolCalls![0].recovery).toBe('unconfirmed')
    useAgentStore.getState().acknowledgeImageRecovery('conversation', 'unknown-call')
    await useAgentStore.getState().flush()
    mocks.stored = [useAgentStore.getState().conversations[0]]
    useAgentStore.setState({ hydrated: false })
    await useAgentStore.getState().hydrate()
    expect(useAgentStore.getState().conversations[0].messages[0].toolCalls![0]).toMatchObject({ recovery: 'acknowledged', result: originalResult })
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ ...call, status: 'pending' }] }).mockResolvedValueOnce({ content: '原任务不会重做', calls: [] })
    await useAgentStore.getState().send('conversation', '继续')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.tool).not.toHaveBeenCalled()
    expect(mocks.stream.mock.calls[0][0].messages[0].content).toContain('用户已手动核对以下原图片请求：unknown-call')
  })

  it('flush waits for an IndexedDB write which has already left the debounce timer', async () => {
    let finish: () => void = () => {}
    mocks.put.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    useAgentStore.getState().updateDraft('conversation', '必须进入备份的草稿')
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalled(), { timeout: 1000 })
    let flushed = false
    const flush = useAgentStore.getState().flush().then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    finish()
    await flush
    expect(flushed).toBe(true)
  })

  it('uses the last persisted revision and preserves unsaved text on cross-tab conflict', async () => {
    mocks.put.mockRejectedValueOnce(new Error('文档已变更，请读取最新内容后重试'))
    useAgentStore.getState().updateDraft('conversation', '本标签新草稿')
    await expect(useAgentStore.getState().flush()).rejects.toThrow('文档已变更')
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ draft: '本标签新草稿', revision: base.revision + 1 }), base.revision)
    expect(useAgentStore.getState().conversations[0].draft).toBe('本标签新草稿')
    await useAgentStore.getState().flush()
  })

  it('keeps the newer cloud baseline when an older persistence marker arrives late', async () => {
    const remote = { ...base, revision: base.revision + 20 }
    markAgentPersisted(remote)
    markAgentPersisted(base)
    useAgentStore.setState({ conversations: [remote] })
    useAgentStore.getState().updateDraft('conversation', '云端版本后的编辑')
    await useAgentStore.getState().flush()
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ revision: remote.revision + 1 }), remote.revision)
  })

  it('shows the actual persistence conflict rather than a storage-space diagnosis', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mocks.put.mockRejectedValueOnce(new Error('文档已变更，请读取最新内容后重试'))
      useAgentStore.getState().updateDraft('conversation', '保留本地草稿')
      await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('会话未能保存：文档已变更，请读取最新内容后重试', 'error'), { timeout: 1000 })
      expect(useAgentStore.getState().conversations[0].draft).toBe('保留本地草稿')
      await useAgentStore.getState().flush()
    } finally { warn.mockRestore() }
  })
  it('restores unfinished runs as interrupted and retains legacy records outside runtime', () => {
    expect(normalizeAgentConversation({ ...base, status: 'running' })).toMatchObject({ status: 'interrupted', error: expect.stringContaining('手动继续') })
    expect(normalizeAgentConversation({ id: 'old-conversation', messages: [] })).toBeUndefined()
  })

  it('reuses a completed call result instead of dispatching the same paid task twice', async () => {
    const call = { id: 'tool_1', name: 'create_image_task', arguments: '{"prompt":"海报"}', status: 'pending' }
    mocks.stream.mockResolvedValueOnce({ content: '', calls: [{ ...call }] }).mockResolvedValueOnce({ content: '', calls: [{ ...call }] }).mockResolvedValueOnce({ content: '完成', calls: [] })
    mocks.tool.mockResolvedValue({ result: '{"taskId":"task"}', taskIds: ['task'] })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    expect(mocks.tool).toHaveBeenCalledTimes(1)
    expect(useAgentStore.getState().conversations[0].messages.filter((message) => message.taskIds?.includes('task'))).toHaveLength(1)
    expect(mocks.put).toHaveBeenCalled()
  })

  it('blocks a second simultaneous send and allows stopping a live response', async () => {
    mocks.stream.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }) }))
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalled())
    await expect(useAgentStore.getState().send('conversation', '另一个请求')).rejects.toThrow('正在运行')
    useAgentStore.getState().stop('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('stopped'))
  })

  it('continues an existing run while another conversation is opened and completed', async () => {
    let finishFirst: (value: { content: string; calls: [] }) => void = () => {}
    mocks.stream.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve })).mockResolvedValueOnce({ content: '第二个会话完成', calls: [] })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(1))
    const second = await useAgentStore.getState().createConversation()
    await useAgentStore.getState().send(second.id, '另一个想法')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations.find((item) => item.id === second.id)?.status).toBe('completed'))
    expect(useAgentStore.getState().conversations.find((item) => item.id === 'conversation')?.status).toBe('running')
    finishFirst({ content: '第一个会话也完成', calls: [] })
    await vi.waitFor(() => expect(useAgentStore.getState().conversations.find((item) => item.id === 'conversation')?.status).toBe('completed'))
  })

  it('prevents a ninth tool action within one run', async () => {
    for (let round = 0; round < 5; round += 1) mocks.stream.mockResolvedValueOnce({ content: '', calls: [0, 1].map((index) => ({ id: `call_${round}_${index}`, name: 'get_canvas', arguments: '{}', status: 'pending' })) })
    mocks.tool.mockResolvedValue({ result: '{}' })
    await useAgentStore.getState().send('conversation')
    await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('error'))
    expect(mocks.tool).toHaveBeenCalledTimes(8)
    expect(useAgentStore.getState().conversations[0].error).toContain('8 次')
  })

  it('attaches image data only to the latest user message', async () => {
    useAgentStore.setState({ conversations: [{ ...structuredClone(base), referenceImageIds: ['img-a', 'img-b'] }] })
    mocks.stream.mockResolvedValue({ content: '好的', calls: [] })
    for (const text of ['第一条', '第二条', '第三条']) {
      await useAgentStore.getState().send('conversation', text)
      await vi.waitFor(() => expect(useAgentStore.getState().conversations[0].status).toBe('completed'))
    }
    const counts = mocks.stream.mock.calls.map(([input]) => (input.messages as { content: unknown }[]).flatMap((message) => Array.isArray(message.content) ? message.content : []).filter((part) => part.type === 'image_url').length)
    expect(counts).toEqual([2, 2, 2])
    const last = mocks.stream.mock.calls[2][0].messages as { role: string; content: unknown }[]
    expect(last.filter((message) => message.role === 'user').map((message) => typeof message.content === 'string')).toEqual([true, true, false])
    expect(last[1].content).toContain('img-a')
  })

  it('leaves a conversation running in another tab untouched and holds the run lock while running', async () => {
    const call = { id: 'busy-call', name: 'create_image_task', arguments: '{"prompt":"海报"}', status: 'running' as const }
    mocks.stored = [
      { ...base, status: 'running', messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [call] }] },
      { ...base, id: 'abandoned', status: 'running', messages: [] },
    ]
    const names: string[] = []
    vi.stubGlobal('navigator', { locks: {
      query: async () => ({ held: [{ name: 'gouo-agent-run:conversation' }] }),
      request: async (name: string, _opts: unknown, callback: () => Promise<void>) => { names.push(name); return callback() },
    } })
    try {
      useAgentStore.setState({ hydrated: false, conversations: [] })
      await useAgentStore.getState().hydrate()
      const byId = Object.fromEntries(useAgentStore.getState().conversations.map((item) => [item.id, item]))
      expect(byId.conversation.status).toBe('running')
      expect(byId.conversation.messages[0].toolCalls?.[0].status).toBe('running')
      expect(byId.abandoned.status).toBe('interrupted')
      expect(mocks.put.mock.calls.map(([saved]) => saved.id)).toEqual(['abandoned'])
      mocks.onTasks?.({ tasks: [] }, { tasks: [] as TaskRecord[] })
      await useAgentStore.getState().flush()
      expect(mocks.put.mock.calls.map(([saved]) => saved.id)).toEqual(['abandoned'])

      mocks.stream.mockResolvedValue({ content: '好的', calls: [] })
      await useAgentStore.getState().send('abandoned', '继续')
      await vi.waitFor(() => expect(useAgentStore.getState().conversations.find((item) => item.id === 'abandoned')?.status).toBe('completed'))
      expect(names).toEqual(['gouo-agent-run:abandoned'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('omits unfinished tool calls from resumed API history', async () => {
    const messages = await buildAgentMessages({ ...base, messages: [
      { id: 'user', role: 'user', content: '画海报', createdAt: 1 },
      { id: 'reply', role: 'assistant', content: '开始', createdAt: 2, toolCalls: [{ id: 'pending', name: 'create_image_task', arguments: '{}', status: 'running' }] },
    ] }, { id: 'model', name: '测试', tool_calls: true, vision: true })
    expect(messages[messages.length - 1]).toEqual({ role: 'assistant', content: '开始' })
  })

  it('does not dispatch after account scope changes', async () => {
    mocks.currentScope = false
    await expect(useAgentStore.getState().send('conversation')).rejects.toThrow('账号已切换')
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
