import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'

const fixtures = vi.hoisted(() => ({ state: {} as Record<string, unknown>, saved: [] as TaskRecord[], execute: vi.fn() }))
vi.mock('../store', () => ({
  useStore: { getState: () => fixtures.state, setState: vi.fn() },
  ensureImageCached: vi.fn(async () => 'data:image/png;base64,aA=='),
  cacheImage: vi.fn(),
  createSettingsForApiProfile: (settings: unknown) => settings,
  executeTask: fixtures.execute,
}))
vi.mock('./db', () => ({ putTask: vi.fn(async (task: TaskRecord) => { fixtures.saved.push(task) }), storeImage: vi.fn(async () => 'image') }))
vi.mock('./gouoBackend', () => ({ isBackendAuthEnabled: () => false, getImageModelQuote: vi.fn() }))
vi.mock('./canvasImage', () => ({ validateMaskMatchesImage: vi.fn(async () => 'partial') }))

import { submitImageTask } from './imageTasks'
import { validateMaskMatchesImage } from './canvasImage'

beforeEach(() => {
  fixtures.saved.length = 0
  fixtures.execute.mockClear()
  vi.mocked(validateMaskMatchesImage).mockResolvedValue('partial')
  fixtures.state = {
    settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', profiles: DEFAULT_SETTINGS.profiles.map((profile) => ({ ...profile, apiKey: 'test-key' })) },
    prompt: '首页草稿', params: DEFAULT_PARAMS, inputImages: [], tasks: [],
    showToast: vi.fn(), setConfirmDialog: vi.fn(), setTasks: (tasks: TaskRecord[]) => { fixtures.state.tasks = tasks },
  }
})

describe('统一图片任务入口', () => {
  it('并发相同 requestId 只提交一次，保留首页草稿', async () => {
    const input = { prompt: '绘制一座灯塔', source: { kind: 'agent' as const, conversationId: '7c2d0d72-25c5-4e3e-8401-625c36d42b94' }, requestId: 'agent:7c2d0d72-25c5-4e3e-8401-625c36d42b94:call_1' }
    const [first, second] = await Promise.all([submitImageTask(input), submitImageTask(input)])
    expect(first).toBe(second)
    expect(fixtures.saved).toHaveLength(1)
    expect(fixtures.execute).toHaveBeenCalledTimes(1)
    expect(fixtures.state.prompt).toBe('首页草稿')
    expect(fixtures.saved[0].source).toEqual(input.source)
    expect(fixtures.saved[0].requestId).toBe(input.requestId)
    expect(await submitImageTask(input)).toBe(first)
    expect(fixtures.saved).toHaveLength(1)
  })
  it('拒绝无效图片数量和空提示词，不派发付费请求', async () => {
    await expect(submitImageTask({ prompt: ' ', source: { kind: 'canvas' } })).rejects.toThrow('提示词')
    await expect(submitImageTask({ prompt: '测试', params: { n: 0 }, source: { kind: 'canvas' } })).rejects.toThrow('数量')
    await expect(submitImageTask({ prompt: '测试', requestId: 'call id', source: { kind: 'agent' } })).rejects.toThrow('请求标识')
    expect(fixtures.execute).not.toHaveBeenCalled()
  })
  it('画布遮罩重排主图并保留首页遮罩草稿', async () => {
    const draft = { targetImageId: 'homepage', maskDataUrl: 'homepage-mask' }
    fixtures.state.maskDraft = draft
    await submitImageTask({ prompt: '只修改招牌', inputImageIds: ['reference', 'target'], maskImageId: 'mask', maskTargetImageId: 'target', source: { kind: 'canvas' } })
    expect(fixtures.saved[0].inputImageIds).toEqual(['target', 'reference'])
    expect(fixtures.saved[0].maskTargetImageId).toBe('target')
    expect(fixtures.saved[0].maskImageId).toBe('image')
    expect(fixtures.state.maskDraft).toBe(draft)
    expect(validateMaskMatchesImage).toHaveBeenCalledTimes(1)
  })
  it('显式遮罩无效或整图未确认时拒绝提交，确认后才能继续', async () => {
    const input = { prompt: '修改招牌', inputImageIds: ['target'], maskImageId: 'mask', source: { kind: 'canvas' as const } }
    await expect(submitImageTask({ ...input, maskTargetImageId: 'missing' })).rejects.toThrow('主图已不存在')
    vi.mocked(validateMaskMatchesImage).mockResolvedValue('full')
    await expect(submitImageTask(input)).rejects.toThrow('确认全图重绘')
    expect(fixtures.execute).not.toHaveBeenCalled()
    expect(fixtures.state.setConfirmDialog).not.toHaveBeenCalled()
    await submitImageTask({ ...input, allowFullMask: true })
    expect(fixtures.execute).toHaveBeenCalledTimes(1)
  })
})
