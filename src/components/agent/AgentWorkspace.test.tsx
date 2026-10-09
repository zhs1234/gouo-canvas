import { renderToStaticMarkup } from 'react-dom/server'
import { Children, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import type { TaskRecord } from '../../types'
import type { AgentConversation, AgentModel, AgentToolCall } from '../../lib/agent/types'
import AgentWorkspace, { ToolCall } from './AgentWorkspace'

const mocks = vi.hoisted(() => ({
  conversations: [] as AgentConversation[],
  models: [{ id: 'available', name: '可用模型', tool_calls: true, vision: false }] as AgentModel[],
  tasks: [] as TaskRecord[],
  configure: vi.fn(),
  setDetailTaskId: vi.fn(),
  setConfirmDialog: vi.fn(),
  acknowledge: vi.fn(),
  tool: vi.fn(),
  backend: false,
  executeTask: vi.fn(),
  modelProps: undefined as { value: string; onChange: (id: string) => void } | undefined,
}))
vi.mock('../../store', () => ({
  ensureImageCached: vi.fn(),
  executeTask: mocks.executeTask,
  useStore: Object.assign((select: (state: typeof mocks) => unknown) => select(mocks), { getState: () => mocks }),
}))
vi.mock('../../stores/agentStore', () => ({
  useAgentStore: Object.assign((select: (state: unknown) => unknown) => select({ ...mocks, modelsLoading: false, modelError: '' }), { getState: () => ({ configureConversation: mocks.configure, acknowledgeImageRecovery: mocks.acknowledge }) }),
}))
vi.mock('../../stores/canvasStore', () => ({ useCanvasStore: (select: (state: { projects: [] }) => unknown) => select({ projects: [] }) }))
vi.mock('../../lib/db', () => ({ storeImageWithSize: vi.fn() }))
vi.mock('../../lib/gouoBackend', () => ({ isBackendAuthEnabled: () => mocks.backend }))
vi.mock('../../lib/agent/tools', () => ({ executeAgentTool: mocks.tool }))
vi.mock('../BackendModelSelector', () => ({ default: () => null }))
vi.mock('../ModelSelect', async (original) => {
  const module = await original<typeof import('../ModelSelect')>()
  return { default: (props: Parameters<typeof module.default>[0]) => { mocks.modelProps = props; return module.default(props) } }
})

const base: AgentConversation = { id: 'conversation', schemaVersion: 1, title: '测试会话', modelId: 'available', draft: '继续构思', referenceImageIds: [], status: 'completed', revision: 1, createdAt: 1, updatedAt: 1, messages: [{ id: 'tool', role: 'tool', toolName: 'create_image_task', content: '{}', createdAt: 1, taskIds: ['task'], referenceImageIds: ['kept-image'] }] }
const render = () => renderToStaticMarkup(<AgentWorkspace conversationId="conversation" onOpenConversation={() => {}} />)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations = [structuredClone(base)]
  mocks.tasks = []
  mocks.backend = false
  mocks.configure.mockImplementation((id: string, patch: Partial<AgentConversation>) => { mocks.conversations = mocks.conversations.map((item) => item.id === id ? { ...item, ...patch } : item) })
})

it('shows an obsolete model as unselected and lets the sole available model actually be selected', () => {
  mocks.conversations[0].modelId = 'removed'
  let markup = render()
  expect(markup).toContain('<option value="" selected="">原模型已不可用，请重新选择</option>')
  expect(markup).toMatch(/aria-label="发送" disabled=""/)
  expect(markup).not.toContain('<option value="available" selected="">')
  mocks.modelProps!.onChange('available')
  expect(mocks.configure).toHaveBeenCalledWith('conversation', { modelId: 'available' })
  markup = render()
  expect(markup).toContain('<option value="available" selected="">可用模型</option>')
  expect(markup).not.toMatch(/aria-label="发送" disabled=""/)
  expect(mocks.tool).not.toHaveBeenCalled()
})

it('renders preserved image attachments after their original task has been deleted', () => {
  const markup = render()
  expect(markup).toContain('图片任务记录已移除')
  expect(markup).toContain('data-image-id="kept-image"')
})

it('shows an unavailable linked canvas explicitly and keeps unlinking and sending available', () => {
  mocks.conversations[0].projectId = 'removed-canvas'
  const markup = render()
  expect(markup).toContain('<option value="removed-canvas" disabled="" selected="">原画布已不可用</option>')
  expect(markup).toContain('<option value="">未关联</option>')
  expect(markup).not.toMatch(/aria-label="关联画布" disabled=""/)
  expect(markup).not.toMatch(/aria-label="发送" disabled=""/)
  expect(mocks.tool).not.toHaveBeenCalled()
})

it('shows partial failure counts and causes, with an existing details entry and no duplicate result images', () => {
  mocks.tasks = [{ id: 'task', prompt: '海报', params: { ...DEFAULT_PARAMS, n: 3 }, inputImageIds: [], outputImages: ['kept-image'], outputErrors: [{ requestIndex: 1, error: '上游超时' }, { requestIndex: 2, error: '内容拒绝' }], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 }]
  const markup = render()
  expect(markup).toContain('成功 1 张，失败 2 张（共 3 张）')
  expect(markup).toContain('第 2 张：上游超时')
  expect(markup).toContain('第 3 张：内容拒绝')
  expect(markup).toContain('查看结果与失败原因')
  expect(markup.match(/data-image-id="kept-image"/g)).toHaveLength(1)
  expect(mocks.tool).not.toHaveBeenCalled()
})

it('offers read-only result recovery for a failed platform task', () => {
  mocks.backend = true
  mocks.tasks = [{ id: 'task', prompt: '海报', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'error', error: 'Failed to fetch', gouoPriceVersion: 'quote', requestId: 'original-request', createdAt: 1, finishedAt: 2, elapsed: 1 }]
  expect(render()).toContain('取回原结果（不重新扣费）')
  mocks.tasks[0].gouoPriceVersion = undefined
  expect(render()).not.toContain('取回原结果（不重新扣费）')
  expect(mocks.executeTask).not.toHaveBeenCalled()
})

it('labels a successful image submission without claiming the image has finished', () => {
  const markup = renderToStaticMarkup(<ToolCall conversationId="conversation" call={{ id: 'submitted', name: 'create_image_task', arguments: '{}', status: 'done' }} />)
  expect(markup).toContain('已提交')
  expect(markup).not.toContain('已完成')
})

it('requires the existing confirmation dialog before acknowledging an uncertain image request', () => {
  const buttons: (() => void)[] = []
  const visit = (nodes: ReactNode) => Children.forEach(nodes, (node) => {
    if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return
    if (node.type === 'button' && node.props.onClick) buttons.push(node.props.onClick)
    visit(node.props.children)
  })
  visit(ToolCall({ conversationId: 'conversation', call: { id: 'uncertain', name: 'create_image_task', arguments: '{}', status: 'error', recovery: 'unconfirmed' } }))
  expect(buttons).toHaveLength(1)
  buttons[0]()
  expect(mocks.acknowledge).not.toHaveBeenCalled()
  const dialog = mocks.setConfirmDialog.mock.calls[0][0]
  expect(dialog.message).toContain('原请求可能已经扣费')
  expect(dialog.message).toContain('不会自动重新生成')
  // 关闭/取消弹层不会执行 action；只有确认才能改变会话。
  mocks.setConfirmDialog(null)
  expect(mocks.acknowledge).not.toHaveBeenCalled()
  buttons[0]()
  mocks.setConfirmDialog.mock.calls[2][0].action()
  expect(mocks.acknowledge).toHaveBeenCalledWith('conversation', 'uncertain')
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each([undefined, 'unconfirmed', 'acknowledged'] as const)('shows an unexecuted image call as not submitted despite legacy recovery %s', (recovery) => {
  const call: AgentToolCall = { id: 'unexecuted', name: 'create_image_task', arguments: '{"prompt":"', status: 'error', execution: 'not_started', recovery }
  const markup = renderToStaticMarkup(<ToolCall conversationId="conversation" call={call} />)
  expect(markup).toContain('未执行')
  expect(markup).toContain('图片请求尚未提交，可继续对话完成。')
  expect(markup).not.toContain('结果待核对')
  expect(markup).not.toContain('已核对原请求')
  expect(markup).not.toContain('原请求可能已提交')
  expect(markup).not.toContain('<button')
  expect(mocks.setConfirmDialog).not.toHaveBeenCalled()
  expect(mocks.tool).not.toHaveBeenCalled()
})

it.each([undefined, 'started'] as const)('preserves reconciliation protection when execution is %s', (execution) => {
  const call: AgentToolCall = { id: 'uncertain', name: 'create_image_task', arguments: '{}', status: 'error', execution, recovery: 'unconfirmed' }
  const markup = renderToStaticMarkup(<ToolCall conversationId="conversation" call={call} />)
  expect(markup).toContain('结果待核对')
  expect(markup).toContain('原请求可能已提交，请核对我的作品和使用记录。')
  expect(markup).not.toContain('尚未提交，可继续对话完成')
})

it.each(['stopped', 'interrupted', 'error'] as const)('distinguishes pending steps from submitted tasks when continuing a %s conversation', (status) => {
  mocks.conversations[0].status = status
  const markup = render()
  expect(markup).toContain('已提交的任务请勿重复提交，尚未提交的步骤可继续完成。')
  expect(markup).toContain('继续对话')
  if (status === 'stopped') expect(markup).toContain('已停止；已提交的图片任务继续生成。')
  expect(mocks.tool).not.toHaveBeenCalled()
})
