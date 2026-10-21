import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, normalizeSettings } from './lib/settings'
import type { ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import type { SkillDocument } from './lib/skills/types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
    getAllSkills: async () => [],
    getAllSkillIds: vi.fn(async () => []),
    putSkill: async () => {},
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    importTaskData: vi.fn(async (addedTasks: TaskRecord[], addedImages: StoredImage[], addedThumbnails: StoredImageThumbnail[]) => {
      for (const image of addedImages) {
        if (images.has(image.id) && images.get(image.id)?.dataUrl !== image.dataUrl) throw new Error('图片 ID 冲突')
      }
      for (const task of addedTasks) tasks.set(task.id, task)
      for (const image of addedImages) images.set(image.id, image)
      for (const thumbnail of addedThumbnails) thumbnails.set(thumbnail.id, thumbnail)
    }),
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    getCloudAssetMapItem: async () => undefined,
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    deleteImages: async (ids: string[]) => {
      for (const id of ids) {
        images.delete(id)
        thumbnails.delete(id)
      }
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    },
    storeImageWithSize: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      const size = dataUrl.match(/(\d+)x(\d+)/)
      const width = size ? Number(size[1]) : undefined
      const height = size ? Number(size[2]) : undefined
      images.set(id, { id, dataUrl, source, createdAt: Date.now(), width, height })
      return { id, width, height }
    },
  }
})
vi.mock('./lib/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/transparentImage', () => ({
  GREEN_KEY_COLOR: '#00FF00',
  MAGENTA_KEY_COLOR: '#FF00FF',
  createTransparentOutputMeta: vi.fn((prompt: string) => ({
    transparentOutput: true,
    effectivePrompt: `transparent:${prompt}`,
  })),
  getTransparentRequestParams: vi.fn((params: typeof DEFAULT_PARAMS) => ({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
  })),
  removeKeyedBackgroundFromDataUrl: vi.fn(async (dataUrl: string) => `transparent:${dataUrl}`),
}))
import { clearImages, clearTasks, getAllTasks, getImage, importTaskData, putImage, putTask as putDbTask } from './lib/db'
import { removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { refreshBackendStatus } from './lib/gouoBackend'
import { clearFailedTasks, deleteFavoriteCollection, editOutputs, getErrorToastMessage, getPersistedState, importData, initStore, markInterruptedOpenAIRunningTasks, retryTask, reuseConfig, submitTask, taskMatchesFilterStatus, taskMatchesSearchQuery, toggleTaskFavorite, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

const models = [
  { id: 'image-a', name: '图片 A', price_cny: 0.1, price_version: 'quote-a', reference: true, mask: true, max_outputs: 2, quota: 100, sizes: ['1K', '2K', '4K'] },
  { id: 'image-b', name: '图片 B', price_cny: 0.3, price_version: 'quote-b', reference: false, mask: false, max_outputs: 1, quota: 300, sizes: ['1K', '2K', '4K'] },
]

// 后端令牌、模型目录和账号信息都返回同一份模型目录；账号信息里没有余额时由服务端判断
async function mockBackend() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify({ success: true, data: String(url).includes('/token/') ? 'user-token' : models }), { status: 200 }))
  const { createBackendSettings } = await import('./lib/gouoBackend')
  await createBackendSettings(true)
}

describe('product model task snapshots', () => {
  beforeEach(async () => {
    await clearTasks()
    await mockBackend()
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({ model: 'image-a', gouoPriceVersion: 'quote-a', gouoModelSelected: true }),
      tasks: [], prompt: '图片', params: { ...DEFAULT_PARAMS }, inputImages: [], maskDraft: null,
      showToast: vi.fn(), setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores and sends the selected model and quote even after the picker changes', async () => {
    await submitTask()
    useStore.getState().setSettings({ model: 'image-b', gouoPriceVersion: 'quote-b' })
    const { callImageApi } = await import('./lib/api')
    expect(useStore.getState().tasks[0]).toMatchObject({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1 })
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ model: 'image-a', gouoPriceVersion: 'quote-a' })
    expect(getPersistedState(useStore.getState()).settings).toMatchObject({ model: 'image-b', gouoPriceVersion: 'quote-b', gouoModelSelected: true })
  })

  it('refuses prompts longer than the server limit before creating a task', async () => {
    useStore.setState({ prompt: '猫'.repeat(32001) })
    await submitTask()
    const { callImageApi } = await import('./lib/api')
    expect(useStore.getState().showToast).toHaveBeenCalledWith('提示词不能超过 32000 字，请精简后再生成', 'error')
    expect(useStore.getState().tasks).toHaveLength(0)
    expect(callImageApi).not.toHaveBeenCalled()
    const { submitImageTask } = await import('./lib/imageTasks')
    await expect(submitImageTask({ prompt: '猫'.repeat(32001), source: { kind: 'generate' } })).rejects.toThrow('提示词不能超过 32000 字')
  })

  it('accepts a non-BMP prompt that is within 32000 code points', async () => {
    const prompt = `${'a'.repeat(31999)}😀`
    expect(prompt.length).toBeGreaterThan(32000)
    useStore.setState({ prompt })
    await submitTask()
    expect(useStore.getState().showToast).not.toHaveBeenCalledWith('提示词不能超过 32000 字，请精简后再生成', 'error')
    expect(useStore.getState().tasks).toHaveLength(1)
    expect(useStore.getState().tasks[0].prompt).toBe(prompt)
  })

  it('blocks duplicate submissions until task creation and then permits the next task', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(fetch).mockImplementation(async () => {
      await gate
      return new Response(JSON.stringify({ success: true, data: models }))
    })
    const first = submitTask()
    expect(useStore.getState().isSubmitting).toBe(true)
    expect(getPersistedState(useStore.getState())).not.toHaveProperty('isSubmitting')
    await submitTask()
    release()
    await first
    const { callImageApi } = await import('./lib/api')
    expect(useStore.getState().tasks).toHaveLength(1)
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(useStore.getState().isSubmitting).toBe(false)
    useStore.getState().setPrompt('下一张')
    await submitTask()
    expect(useStore.getState().tasks).toHaveLength(2)
    expect(callImageApi).toHaveBeenCalledTimes(2)
  })

  it.each(['quote', 'save'])('unlocks submission and preserves the draft after a %s failure', async (failure) => {
    if (failure === 'quote') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    else {
      const db = await import('./lib/db')
      vi.spyOn(db, 'putTask').mockRejectedValueOnce(new Error('storage full'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    }
    await submitTask()
    expect(useStore.getState().isSubmitting).toBe(false)
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().prompt).toBe('图片')
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
    await submitTask()
    expect(useStore.getState().tasks).toHaveLength(1)
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(useStore.getState().prompt).toBe('')
  })

  it.each(['prompt', 'images', 'mask'])('preserves the next draft when its %s changes during the quote', async (changed) => {
    await putImage(imageA)
    useStore.getState().setInputImages([imageA])
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(fetch).mockImplementation(async () => {
      await gate
      return new Response(JSON.stringify({ success: true, data: models }))
    })
    const first = submitTask()
    if (changed === 'prompt') useStore.getState().setPrompt('下一条草稿')
    if (changed === 'images') useStore.getState().addInputImage(imageB)
    if (changed === 'mask') useStore.getState().setMaskDraft({ targetImageId: imageA.id, maskDataUrl: 'data:image/png;base64,new-mask', updatedAt: Date.now() })
    const draft = useStore.getState()
    release()
    await first
    expect(useStore.getState().prompt).toBe(draft.prompt)
    expect(useStore.getState().inputImages).toBe(draft.inputImages)
    expect(useStore.getState().maskDraft).toBe(draft.maskDraft)
    expect(useStore.getState().tasks[0]).toMatchObject({ prompt: '图片', inputImageIds: [imageA.id], maskImageId: null })
    await vi.waitFor(() => expect(useStore.getState().tasks[0].status).not.toBe('running'))
  })

  it('clears an unchanged draft only after the task is saved', async () => {
    await putImage(imageA)
    useStore.getState().setInputImages([imageA])
    await submitTask()
    expect(useStore.getState().prompt).toBe('')
    expect(useStore.getState().inputImages).toEqual([])
    expect((await getAllTasks())[0]).toMatchObject({ prompt: '图片', inputImageIds: [imageA.id] })
    await vi.waitFor(() => expect(useStore.getState().tasks[0].status).not.toBe('running'))
  })

  it('retries the original task model rather than the current picker model', async () => {
    useStore.getState().setSettings({ model: 'image-b', gouoPriceVersion: 'quote-b' })
    await retryTask(task({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1, status: 'error' }))
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
    expect(useStore.getState().tasks).toEqual([])
    const confirmation = vi.mocked(useStore.getState().setConfirmDialog).mock.calls.slice(-1)[0]?.[0]
    expect(confirmation).toMatchObject({ title: '确认付费重试', message: expect.stringContaining('全部成功预计扣费 10 积分') })
    await confirmation?.action?.()
    expect(useStore.getState().tasks[0]).toMatchObject({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1 })
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ model: 'image-a', gouoPriceVersion: 'quote-a' })
  })

  it('requires confirmation before retrying a legacy task at the current price', async () => {
    await retryTask(task({ apiModel: 'image-a', status: 'error' }))
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '确认重试价格', message: expect.stringContaining('当前价格为 10 积分/张。重试会新建 1 次单图请求') }))
  })

  it('rechecks the quote after the user confirms a retry', async () => {
    await retryTask(task({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1, status: 'error' }))
    const confirmation = vi.mocked(useStore.getState().setConfirmDialog).mock.calls.slice(-1)[0]?.[0]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true, data: [{ ...models[0], price_cny: 0.5, price_version: 'changed' }] })))
    await confirmation?.action?.()
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().setConfirmDialog).toHaveBeenLastCalledWith(expect.objectContaining({ title: '确认重试价格', message: expect.stringContaining('50 积分') }))
  })

  it('preserves billing guidance when a running backend task is interrupted', () => {
    const result = markInterruptedOpenAIRunningTasks([task({ status: 'running' })])
    expect(result.tasks[0].error).toContain('自动退回积分')
  })

  it('distinguishes local save failure after a paid result from an upstream failure', async () => {
    const { callImageApi } = await import('./lib/api')
    const db = await import('./lib/db')
    vi.mocked(callImageApi).mockResolvedValueOnce({ images: ['data:image/png;base64,test'], actualParams: {}, actualParamsList: [], revisedPrompts: [] })
    vi.spyOn(db, 'storeImageWithSize').mockRejectedValueOnce(new DOMException('storage full', 'QuotaExceededError'))
    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0].status).toBe('error'))
    expect(useStore.getState().tasks[0].error).toContain('生成结果已返回，但本地处理或保存失败')
    expect(useStore.getState().tasks[0].error).toContain('自动退回积分')
    expect(callImageApi).toHaveBeenCalledTimes(1)
  })

  it('blocks a new task when its selected model is no longer available', async () => {
    useStore.getState().setSettings({ model: 'image-removed' })
    await submitTask()
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().showToast).toHaveBeenCalledWith(expect.stringContaining('已不可用'), 'error')
  })

  it.each([undefined, 'quote-b'])('confirms the whole batch retry cost with quote %s', async (gouoPriceVersion) => {
    const original = task({
      apiModel: 'image-b', gouoPriceVersion, gouoPriceCNY: 0.3,
      params: { ...DEFAULT_PARAMS, n: 2 }, outputImages: ['previous-success'],
      outputErrors: [{ requestIndex: 1, error: '失败' }],
    })
    useStore.setState({ tasks: [original] })
    await retryTask(original)
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
    const confirmation = vi.mocked(useStore.getState().setConfirmDialog).mock.calls.slice(-1)[0]?.[0]
    expect(confirmation?.message).toContain('2 次单图请求')
    expect(confirmation?.message).toContain('全部成功预计扣费 60 积分')
    expect(confirmation?.message).toContain('包含已经成功的图片')
    await confirmation?.action?.()
    expect(useStore.getState().tasks).toHaveLength(2)
    expect(useStore.getState().tasks.find((item) => item.id === original.id)?.outputImages).toEqual(['previous-success'])
    const created = useStore.getState().tasks.find((item) => item.id !== original.id)!
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ params: { n: 2 }, requestId: created.id })
  })

  it('preserves parallel partial success after the single-request watchdog deadline', async () => {
    vi.useFakeTimers()
    try {
      const { callImageApi } = await import('./lib/api')
      let finish!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
      vi.mocked(callImageApi).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      const running = task({ status: 'running', createdAt: Date.now(), params: { ...DEFAULT_PARAMS, n: 2 } })
      useStore.setState({ tasks: [running] })
      const { executeTask } = await import('./store')
      const execution = executeTask(running.id)
      await vi.advanceTimersByTimeAsync(601_000)
      expect(useStore.getState().tasks[0].status).toBe('running')
      finish({ images: ['data:image/png;base64,success'], actualParamsList: [{ size: '1024x1024' }], failedRequests: [{ requestIndex: 1, error: '请求超时' }] })
      await execution
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', outputErrors: [{ requestIndex: 1, error: '请求超时' }] })
      expect(useStore.getState().tasks[0].outputImages).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a paid result that arrives after the watchdog marked the task as timed out', async () => {
    vi.useFakeTimers()
    try {
      const { callImageApi } = await import('./lib/api')
      let finish!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
      vi.mocked(callImageApi).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      const running = task({ status: 'running', gouoPriceVersion: 'quote-a', createdAt: Date.now() })
      useStore.setState({ tasks: [running] })
      const { executeTask } = await import('./store')
      const execution = executeTask(running.id)
      // 后端最长 15 分钟，请求还会自己超时并恢复结果：10 分钟时不能判为失败，否则用户重试会重复扣费
      await vi.advanceTimersByTimeAsync(600_000)
      expect(useStore.getState().tasks[0].status).toBe('running')
      await vi.advanceTimersByTimeAsync(1_380_000)
      expect(useStore.getState().tasks[0].status).toBe('error')
      // 请求自身的超时恢复随后取回了已扣费的结果
      finish({ images: ['data:image/png;base64,late-result'] })
      await execution
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', error: null })
      expect(useStore.getState().tasks[0].outputImages).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers an old failed task with its original request ID without requiring deleted inputs or creating a new task', async () => {
    const { callImageApi } = await import('./lib/api')
    const { executeTask } = await import('./store')
    vi.mocked(callImageApi).mockResolvedValueOnce({ images: ['data:image/png;base64,recovered'] })
    const failed = task({ status: 'error', requestId: 'agent:conversation:call-original', gouoPriceVersion: 'quote-a', createdAt: 1, inputImageIds: ['missing-input'], maskImageId: 'missing-mask' })
    useStore.setState({ tasks: [failed] })
    await executeTask(failed.id, true)
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ recoverOnly: true, requestId: failed.requestId, inputImageDataUrls: [] })
    expect(useStore.getState().tasks).toHaveLength(1)
    expect(useStore.getState().tasks[0]).toMatchObject({ id: failed.id, status: 'done', requestId: failed.requestId })
    expect(useStore.getState().tasks[0].outputImages).toHaveLength(1)
  })

  it('does not start recovery twice while the same task is running', async () => {
    const { callImageApi } = await import('./lib/api')
    const { executeTask } = await import('./store')
    let finish!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
    vi.mocked(callImageApi).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const failed = task({ status: 'error', gouoPriceVersion: 'quote-a' })
    useStore.setState({ tasks: [failed] })
    const recovery = executeTask(failed.id, true)
    await executeTask(failed.id, true)
    expect(callImageApi).toHaveBeenCalledTimes(1)
    finish({ images: ['data:image/png;base64,recovered'] })
    await recovery
    expect(useStore.getState().tasks[0].status).toBe('done')
  })

  it('completes with the received result when saving it crosses the watchdog deadline', async () => {
    vi.useFakeTimers()
    try {
      const { callImageApi } = await import('./lib/api')
      const { executeTask } = await import('./store')
      const db = await import('./lib/db')
      let releaseSave!: () => void
      vi.mocked(callImageApi).mockResolvedValueOnce({ images: ['data:image/png;base64,in-time'] })
      const save = db.storeImageWithSize
      const gate = new Promise<void>((resolve) => { releaseSave = resolve })
      vi.spyOn(db, 'storeImageWithSize').mockImplementationOnce(async (...args) => { await gate; return save(...args) })
      const running = task({ status: 'running', gouoPriceVersion: 'quote-a', createdAt: Date.now() })
      useStore.setState({ tasks: [running] })
      const execution = executeTask(running.id)
      // 结果在截止前已到，保存图片跨过截止时间：不能判为超时，也不能丢掉结果
      await vi.advanceTimersByTimeAsync(601_000)
      expect(useStore.getState().tasks[0].status).toBe('running')
      releaseSave()
      await execution
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', error: null })
      expect((await getImage(useStore.getState().tasks[0].outputImages[0]))?.dataUrl).toBe('data:image/png;base64,in-time')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['failure', 'success'])('ignores an old execution %s after watchdog timeout and result recovery starts', async (outcome) => {
    vi.useFakeTimers()
    try {
      const { callImageApi } = await import('./lib/api')
      const { executeTask } = await import('./store')
      const db = await import('./lib/db')
      let finishOld!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
      let failOld!: (error: Error) => void
      let finishRecovery!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
      vi.mocked(callImageApi)
        .mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; failOld = reject }))
        .mockImplementationOnce(() => new Promise((resolve) => { finishRecovery = resolve }))
      const running = task({ status: 'running', gouoPriceVersion: 'quote-a', requestId: 'original-request', createdAt: Date.now() })
      useStore.setState({ tasks: [running] })
      const original = executeTask(running.id)
      await vi.advanceTimersByTimeAsync(1_980_000)
      expect(useStore.getState().tasks[0].status).toBe('error')
      const recovery = executeTask(running.id, true)
      if (outcome === 'failure') failOld(new Error('old request aborted'))
      else finishOld({ images: ['data:image/png;base64,stale-original'] })
      await original
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'running', error: null, outputImages: [] })
      expect((await db.getAllImages()).some((image) => image.dataUrl === 'data:image/png;base64,stale-original')).toBe(false)
      await vi.advanceTimersByTimeAsync(601_000)
      expect(useStore.getState().tasks[0].status).toBe('running')
      finishRecovery({ images: ['data:image/png;base64,recovery-result'] })
      await recovery
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', error: null, requestId: 'original-request' })
      expect((await getImage(useStore.getState().tasks[0].outputImages[0]))?.dataUrl).toBe('data:image/png;base64,recovery-result')
      expect(vi.mocked(callImageApi).mock.calls.map(([opts]) => Boolean(opts.recoverOnly))).toEqual([false, true])
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists every failed child request when a whole batch fails', async () => {
    const { callImageApi } = await import('./lib/api')
    const failedRequests = [{ requestIndex: 0, error: '请求超时' }, { requestIndex: 1, error: '上游错误' }]
    vi.mocked(callImageApi).mockRejectedValueOnce(Object.assign(new Error('请求超时'), { failedRequests }))
    useStore.getState().setParams({ n: 2 })
    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0].status).toBe('error'))
    expect(useStore.getState().tasks[0].outputErrors).toEqual(failedRequests)
    expect((await getAllTasks())[0].outputErrors).toEqual(failedRequests)
  })
})

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('图像请求失败：接口拒绝了很长的提示词内容')).toBe('图像请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function importFile(data: ExportData, files: Record<string, Uint8Array> = {}): File {
  const zipped = zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { size: buffer.byteLength, arrayBuffer: async () => buffer } as File
}

describe('favorite collection deletion', () => {
  const collectionA = { id: 'collection-a', name: '收藏夹 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '收藏夹 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionA.id,
      activeFavoriteCollectionId: collectionA.id,
      selectedFavoriteCollectionIds: [collectionA.id],
      selectedTaskIds: [],
      inputImages: [],
      showToast: vi.fn(),
    })
  })

  it('keeps tasks that are still referenced by another collection when deleting collection tasks', async () => {
    const sharedTask = task({
      id: 'shared-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id, collectionB.id],
    })
    const collectionOnlyTask = task({
      id: 'collection-only-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id],
    })
    useStore.setState({ tasks: [sharedTask, collectionOnlyTask] })
    await putDbTask(sharedTask)
    await putDbTask(collectionOnlyTask)

    await deleteFavoriteCollection(collectionA.id, true)

    const state = useStore.getState()
    expect(state.favoriteCollections.map((collection) => collection.id)).toEqual([collectionB.id])
    expect(state.activeFavoriteCollectionId).toBeNull()
    expect(state.selectedFavoriteCollectionIds).toEqual([])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: sharedTask.id,
      isFavorite: true,
      favoriteCollectionIds: [collectionB.id],
    })
    expect((await getAllTasks()).map((item) => item.id)).toEqual([sharedTask.id])
  })
})

describe('one-step favorite', () => {
  const collectionA = { id: 'collection-a', name: '收藏夹 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '收藏夹 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    useStore.setState({
      tasks: [task({ id: 'fav-task' })],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionB.id,
      favoritePickerTaskIds: null,
      selectedTaskIds: ['other-task'],
      showToast: vi.fn(),
    })
  })

  it('favorites into the default collection without opening the picker, then unfavorites on the next click', async () => {
    await toggleTaskFavorite('fav-task')
    let state = useStore.getState()
    expect(state.tasks[0]).toMatchObject({ isFavorite: true, favoriteCollectionIds: [collectionB.id] })
    expect(state.favoritePickerTaskIds).toBeNull()
    expect(state.selectedTaskIds).toEqual(['other-task'])
    expect((await getAllTasks())[0]).toMatchObject({ isFavorite: true, favoriteCollectionIds: [collectionB.id] })
    const [message, type, action] = vi.mocked(state.showToast).mock.calls[0]
    expect(message).toBe('已收藏到「收藏夹 B」')
    expect(type).toBe('success')
    expect(action?.label).toBe('移动到…')
    action?.onClick()
    expect(useStore.getState().favoritePickerTaskIds).toEqual(['fav-task'])

    await toggleTaskFavorite('fav-task')
    state = useStore.getState()
    expect(state.tasks[0]).toMatchObject({ isFavorite: false, favoriteCollectionIds: [] })
    expect(vi.mocked(state.showToast).mock.calls[1]).toEqual(['已取消收藏', 'success'])
  })

  it('falls back to the first collection when no default collection is set', async () => {
    useStore.setState({ defaultFavoriteCollectionId: null })
    await toggleTaskFavorite('fav-task')
    expect(useStore.getState().tasks[0].favoriteCollectionIds).toEqual([collectionA.id])
  })
})

describe('mask draft lifecycle in store actions', () => {
  beforeEach(async () => {
    await mockBackend()
    useStore.setState({
      settings: normalizeSettings({ model: 'image-a', gouoPriceVersion: 'quote-a', gouoModelSelected: true }),
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交，生成结果会显示在输入框下方', 'success')
  })

  it('stores decoded image size as actual size when the API omits size', async () => {
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,actual-1254x1254'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

    const [task] = useStore.getState().tasks
    expect(task.actualParams).toMatchObject({ size: '1254x1254', output_format: 'png', n: 1 })
    expect(task.actualParamsByImage?.[task.outputImages[0]]).toMatchObject({ size: '1254x1254', output_format: 'png' })
    await clearTasks()
    await clearImages()
  })

  it('keeps API-returned actual size over decoded image size', async () => {
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,actual-1254x1254'],
      actualParams: { output_format: 'png', size: '1024x1024' },
      actualParamsList: [{ output_format: 'png', size: '1024x1024' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

    const [task] = useStore.getState().tasks
    expect(task.actualParams?.size).toBe('1024x1024')
    expect(task.actualParamsByImage?.[task.outputImages[0]].size).toBe('1024x1024')
    await clearTasks()
    await clearImages()
  })

  it('stores transparent background output after local post-processing', async () => {
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'transparent:单主体贴纸素材',
      params: expect.objectContaining({
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      }),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,generated')
    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      prompt: '单主体贴纸素材',
      transparentOutput: true,
      transparentPrompt: 'transparent:单主体贴纸素材',
      status: 'done',
    })
    expect(task.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(task.outputImages[0])
    const originalImage = await getImage(task.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,generated')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,generated')
    await clearTasks()
    await clearImages()
  })

  it('falls back to the original output when transparent post-processing fails', async () => {
    const { callImageApi } = await import('./lib/api')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockRejectedValueOnce(new Error('post-process failed'))
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      transparentOutput: true,
      status: 'done',
    })
    expect(task.transparentOriginalImages).toEqual([''])
    const outputImage = await getImage(task.outputImages[0])
    expect(outputImage?.dataUrl).toBe('data:image/png;base64,generated')
    warnSpy.mockRestore()
    await clearTasks()
    await clearImages()
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('multi-tab favorite collections', () => {
  it('takes favorite collections written by another tab so this tab does not overwrite them', async () => {
    vi.resetModules()
    vi.stubGlobal('window', new EventTarget())
    try {
      const { useStore: fresh } = await import('./store')
      const { getLoadedStorageName } = await import('./lib/storageScope')
      const collections = [{ id: 'default', name: '默认收藏', createdAt: 1, updatedAt: 1 }, { id: 'other-tab', name: '另一页新建', createdAt: 2, updatedAt: 2 }]
      const event = Object.assign(new Event('storage'), { key: getLoadedStorageName(), newValue: JSON.stringify({ state: { favoriteCollections: collections, defaultFavoriteCollectionId: 'other-tab' }, version: 2 }) })
      window.dispatchEvent(event)
      expect(fresh.getState().favoriteCollections.map((item) => item.id)).toEqual(['default', 'other-tab'])
      expect(fresh.getState().defaultFavoriteCollectionId).toBe('other-tab')
      // 其他标签页只切换默认收藏夹，收藏夹列表不变
      window.dispatchEvent(Object.assign(new Event('storage'), { key: getLoadedStorageName(), newValue: JSON.stringify({ state: { favoriteCollections: collections, defaultFavoriteCollectionId: 'default' }, version: 2 }) }))
      expect(fresh.getState().defaultFavoriteCollectionId).toBe('default')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('leaves tasks that another tab is still executing as running', async () => {
    await clearTasks()
    await putDbTask(task({ id: 'other-tab', status: 'running', finishedAt: null, elapsed: null }))
    await putDbTask(task({ id: 'abandoned', status: 'running', finishedAt: null, elapsed: null }))
    // 另一个标签页正在执行 other-tab，持有它的任务锁
    let release = () => {}
    const released = new Promise<void>((resolve) => { release = resolve })
    let reloaded: Promise<unknown> = Promise.resolve()
    vi.stubGlobal('navigator', { locks: {
      query: async () => ({ held: [{ name: 'gouo-task:other-tab' }, { name: 'gouo-tab' }] }),
      request: async (...args: unknown[]) => {
        const callback = args[args.length - 1] as (lock: null) => unknown
        // 等待其他标签页释放任务锁
        if (args[0] === 'gouo-task:other-tab') {
          reloaded = released.then(() => callback(null))
          return reloaded
        }
        // 其他标签页持有共享的标签页锁：申请排他锁拿不到
        return callback(null)
      },
    } })
    try {
      await initStore()
      const byId = Object.fromEntries(useStore.getState().tasks.map((item) => [item.id, item.status]))
      expect(byId).toMatchObject({ 'other-tab': 'running', abandoned: 'error' })
      // 其他标签页完成后释放锁，本页取回结果
      await putDbTask(task({ id: 'other-tab', status: 'done', outputImages: ['out'] }))
      release()
      await reloaded
      expect(useStore.getState().tasks.find((item) => item.id === 'other-tab')).toMatchObject({ status: 'done', outputImages: ['out'] })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('marks a task interrupted when the other tab closes mid-run', async () => {
    await clearTasks()
    await putDbTask(task({ id: 'closed-tab', status: 'running', finishedAt: null, elapsed: null }))
    let reloaded: Promise<unknown> = Promise.resolve()
    vi.stubGlobal('navigator', { locks: {
      query: async () => ({ held: [{ name: 'gouo-task:closed-tab' }] }),
      request: async (...args: unknown[]) => {
        const result = (args[args.length - 1] as (lock: null) => unknown)(null)
        if (args[0] === 'gouo-task:closed-tab') reloaded = Promise.resolve(result)
        return result
      },
    } })
    try {
      await initStore()
      await reloaded
    } finally {
      vi.unstubAllGlobals()
    }
    expect(useStore.getState().tasks.find((item) => item.id === 'closed-tab')?.status).toBe('error')
    expect((await getAllTasks()).find((item) => item.id === 'closed-tab')?.status).toBe('error')
  })

  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      prompt: 'prompt',
      inputImages: [imageA],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })
})

describe('data import', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      showToast: vi.fn(),
    })
  })

  it('rejects an oversized backup before reading it into memory', async () => {
    const file = { size: 600 * 1024 * 1024, arrayBuffer: vi.fn() } as unknown as File
    expect(await importData(file)).toBe(false)
    expect(file.arrayBuffer).not.toHaveBeenCalled()
    expect(useStore.getState().showToast).toHaveBeenCalledWith(expect.stringContaining('不能超过'), 'error')
  })

  it('rejects missing files without changing existing tasks, images or settings', async () => {
    const existing = task({ id: 'existing', outputImages: ['image-a'] })
    await putDbTask(existing)
    await putImage(imageA)
    useStore.setState({ tasks: [existing] })
    const settings = useStore.getState().settings
    const result = await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), settings: { ...settings, model: 'changed' }, tasks: [task({ outputImages: ['missing'] })], imageFiles: { missing: { path: 'images/missing.png' } } }))
    expect(result).toBe(false)
    expect(await getAllTasks()).toEqual([existing])
    expect(await getImage('image-a')).toEqual(imageA)
    expect(useStore.getState().settings).toBe(settings)
    expect(useStore.getState().showToast).toHaveBeenCalledWith(expect.stringContaining('缺少图片文件'), 'error')
  })

  it('keeps existing task IDs and imports new tasks with their images without foreign cloud identity', async () => {
    const existing = task({ id: 'existing', prompt: 'current' })
    await putDbTask(existing)
    useStore.setState({ tasks: [existing] })
    const result = await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), tasks: [task({ id: 'existing', prompt: 'old' }), task({ id: 'new', outputImages: ['new-image'], cloudId: 'foreign' })], imageFiles: { 'new-image': { path: 'images/new.png' } } }, { 'images/new.png': new Uint8Array([1, 2, 3]) }), { importTasks: true })
    expect(result).toBe(true)
    expect((await getAllTasks()).find((item) => item.id === 'existing')).toEqual(existing)
    // 云端可能还有未拉取的同 ID 作品，导入的新任务换新 ID
    expect((await getAllTasks()).find((item) => item.id !== 'existing')).toMatchObject({ cloudId: undefined, outputImages: ['new-image'] })
    expect(await getImage('new-image')).toMatchObject({ dataUrl: 'data:image/png;base64,AQID' })
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已导入 1 个任务，保留 1 个同 ID 的现有任务', 'success')
    // 再次导入同一份备份不能重复添加任务
    const conversation = { id: 'conv', schemaVersion: 1 as const, title: '会话', modelId: 'm', messages: [{ id: 'msg', role: 'assistant' as const, content: '', taskIds: ['new'], createdAt: 1 }], draft: '', referenceImageIds: [], status: 'idle' as const, createdAt: 1, updatedAt: 1, revision: 1 }
    vi.stubGlobal('window', new EventTarget())
    const again = await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), tasks: [task({ id: 'existing', prompt: 'old' }), task({ id: 'new', outputImages: ['new-image'], cloudId: 'foreign' })], agentConversations: [conversation], imageFiles: { 'new-image': { path: 'images/new.png' } } }, { 'images/new.png': new Uint8Array([1, 2, 3]) }), { importTasks: true })
    expect(again).toBe(true)
    expect(await getAllTasks()).toHaveLength(2)
    // 重复导入的会话仍要指向之前导入的任务
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations?.[0].messages[0]).toMatchObject({ taskIds: ['imported-new'] })
    vi.unstubAllGlobals()
  })

  it('imports backup skills with new IDs and skips names already taken', async () => {
    vi.stubGlobal('window', new EventTarget())
    // 后台设置有缓存，拨快时钟让它重新读取
    let clock = 0
    const loadStatus = async (respond: () => Promise<Response>) => {
      vi.stubGlobal('fetch', vi.fn(respond))
      clock += 1
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + clock * 600_000 })
      await refreshBackendStatus()
      vi.useRealTimers()
    }
    const { BUILTIN_SKILLS } = await import('./lib/skills/builtin')
    const skill = (name: string) => ({ id: `backup-${name}`, schemaVersion: 1 as const, name, title: name, description: '用途', body: '正文', files: [], enabled: true, createdAt: 1, updatedAt: 1, revision: 7 })
    const backup = (skills: unknown[]) => importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], skills: skills as SkillDocument[] })
    // 读不到后台设置（启动时或接口故障）时不恢复技能，避免绕过关闭的导入开关
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await importData(backup([skill('early-skill')]), { importTasks: true })).toBe(true)
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
    await loadStatus(async () => Response.json({ success: true, data: {} }))
    // 会话里启用的导入技能按文档 ID 记录，恢复后要指向新 ID
    const conversation = { id: 'conv', schemaVersion: 1 as const, title: '会话', modelId: 'm', messages: [], draft: '', referenceImageIds: [], status: 'idle' as const, createdAt: 1, updatedAt: 1, revision: 1, skills: ['backup-my-skill', BUILTIN_SKILLS[0].name] }
    expect(await importData(importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], agentConversations: [conversation], skills: [skill('my-skill'), skill(BUILTIN_SKILLS[0].name), skill('my-skill'), { ...skill('broken'), body: '' }] as SkillDocument[] }), { importTasks: true })).toBe(true)
    const imported = vi.mocked(importTaskData).mock.lastCall?.[3]?.skills
    expect(imported).toEqual([
      expect.objectContaining({ name: 'my-skill', id: 'imported-backup-my-skill', revision: 1, createdAt: 1 }),
      expect.objectContaining({ name: BUILTIN_SKILLS[0].name, id: `imported-backup-${BUILTIN_SKILLS[0].name}` }),
    ])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['imported-backup-my-skill', BUILTIN_SKILLS[0].name])
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已导入 0 个任务，2 个技能', 'success')
    // 运营方关闭技能导入后，备份里的技能不恢复
    await loadStatus(async () => Response.json({ success: true, data: { gouo_skill_import: false } }))
    expect(await importData(backup([skill('other-skill')]), { importTasks: true })).toBe(true)
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
    vi.unstubAllGlobals()
  })

  it('keeps same-name skills from a backup and remaps each session to its own document', async () => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: {} })))
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 3_600_000 })
    await refreshBackendStatus()
    vi.useRealTimers()
    const { useSkillStore } = await import('./stores/skillStore')
    useSkillStore.setState({ skills: [], hydrated: true })
    const skill = (id: string, createdAt: number, body: string) => ({ id, schemaVersion: 1 as const, name: 'dup', title: '同名', description: '用途', body, files: [], enabled: true, createdAt, updatedAt: createdAt, revision: 4 })
    const conversation = { id: 'conv', schemaVersion: 1 as const, title: '会话', modelId: 'm', messages: [], draft: '', referenceImageIds: [], status: 'idle' as const, createdAt: 1, updatedAt: 1, revision: 1, skills: ['skill-late', 'skill-early', 'skill-late'] }
    const file = importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], agentConversations: [conversation], skills: [skill('skill-early', 1, '较早'), skill('skill-late', 2, '较晚')] as SkillDocument[] })
    expect(await importData(file, { importTasks: true })).toBe(true)
    const imported = vi.mocked(importTaskData).mock.lastCall?.[3]?.skills
    expect(imported).toEqual([
      expect.objectContaining({ id: 'imported-skill-early', name: 'dup', body: '较早', createdAt: 1 }),
      expect.objectContaining({ id: 'imported-skill-late', name: 'dup', body: '较晚', createdAt: 2 }),
    ])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['imported-skill-late', 'imported-skill-early'])
    // 再次导入同一份备份时认出已恢复的文档，不另建副本，会话仍指向它们
    expect(await importData(file, { importTasks: true })).toBe(true)
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['imported-skill-late', 'imported-skill-early'])
    // 备份里同时有 x 和 imported-x 两份不同的技能时各自恢复，再次导入时也各自认回
    const pair = importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], agentConversations: [{ ...conversation, skills: ['x', 'imported-x'] }], skills: [skill('x', 1, '原件'), skill('imported-x', 2, '另一份')] as SkillDocument[] })
    useSkillStore.setState({ skills: [], hydrated: true })
    expect(await importData(pair, { importTasks: true })).toBe(true)
    const pairDocs = vi.mocked(importTaskData).mock.lastCall?.[3]?.skills ?? []
    expect(pairDocs.map((doc) => [doc.id, doc.body])).toEqual([['imported-x', '原件'], ['imported-imported-x', '另一份']])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['imported-x', 'imported-imported-x'])
    useSkillStore.setState({ skills: pairDocs, hydrated: true })
    expect(await importData(pair, { importTasks: true })).toBe(true)
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['imported-x', 'imported-imported-x'])
    // 本地同时有原件 x 和恢复副本 imported-x 时，两种备份顺序都认回各自的 ID，不再多复制一份
    const both = [skill('x', 1, '原件'), skill('imported-x', 2, '另一份')]
    for (const order of [both, [...both].reverse()]) {
      useSkillStore.setState({ skills: both, hydrated: true })
      const again = importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], agentConversations: [{ ...conversation, skills: ['x', 'imported-x'] }], skills: order as SkillDocument[] })
      expect(await importData(again, { importTasks: true })).toBe(true)
      expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
      expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['x', 'imported-x'])
    }
    // 本地只有 imported-x 和 imported-imported-x 时，备份里 imported-x 排在 x 前面也要接上链条
    const chain = [skill('imported-x', 1, '第一份'), skill('imported-imported-x', 2, '第二份')]
    for (const order of [[skill('imported-x', 2, '另一份'), skill('x', 1, '原件')], [skill('x', 1, '原件'), skill('imported-x', 2, '另一份')]]) {
      useSkillStore.setState({ skills: chain, hydrated: true })
      const again = importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], agentConversations: [{ ...conversation, skills: ['x', 'imported-x'] }], skills: order as SkillDocument[] })
      expect(await importData(again, { importTasks: true })).toBe(true)
      expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
      expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual(['imported-x', 'imported-imported-x'])
    }
    // imported- 前缀叠到超过服务端 128 字节时改用原 ID 的散列，会话指向这份新技能，再次导入时认回
    const longId = 'b'.repeat(120)
    useSkillStore.setState({ skills: [], hydrated: true })
    const longFile = importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], agentConversations: [{ ...conversation, skills: [longId] }], skills: [skill(longId, 1, '很长')] as SkillDocument[] })
    expect(await importData(longFile, { importTasks: true })).toBe(true)
    const longDocs = vi.mocked(importTaskData).mock.lastCall?.[3]?.skills ?? []
    expect(longDocs.map((doc) => doc.id)).toEqual([expect.stringMatching(/^imported-h[0-9a-f]{16}$/)])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual([longDocs[0].id])
    expect(await importData(longFile, { importTasks: true })).toBe(true)
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.skills).toEqual([])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual([longDocs[0].id])
    // 恢复后又删除的技能仍留着记录：再次导入换新 ID，不能与它撞 ID 导致整个导入失败
    useSkillStore.setState({ skills: imported!.map((doc) => ({ ...doc, hiddenAt: 5 })), hydrated: true })
    expect(await importData(file, { importTasks: true })).toBe(true)
    const again = vi.mocked(importTaskData).mock.lastCall?.[3]?.skills ?? []
    expect(again.map((doc) => doc.body)).toEqual(['较早', '较晚'])
    expect(again.some((doc) => doc.id.startsWith('imported-'))).toBe(false)
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations[0].skills).toEqual([again[1].id, again[0].id])
    vi.unstubAllGlobals()
  })

  it('does not reuse a skill ID that exists in IndexedDB but failed to load', async () => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: {} })))
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 3_600_000 })
    await refreshBackendStatus()
    vi.useRealTimers()
    const { useSkillStore } = await import('./stores/skillStore')
    useSkillStore.setState({ skills: [], hydrated: true })
    const db = await import('./lib/db')
    vi.mocked(db.getAllSkillIds).mockResolvedValueOnce(['imported-broken'])
    const skill = { id: 'broken', schemaVersion: 1 as const, name: 'broken', title: '坏', description: '', body: '正文', files: [], enabled: true, createdAt: 1, updatedAt: 1, revision: 1 }
    expect(await importData(importFile({ version: 4, exportedAt: new Date().toISOString(), tasks: [], skills: [skill] as SkillDocument[] }), { importTasks: true })).toBe(true)
    const imported = vi.mocked(importTaskData).mock.lastCall?.[3]?.skills ?? []
    expect(imported).toHaveLength(1)
    expect(imported[0].id).not.toBe('imported-broken')
    vi.unstubAllGlobals()
  })

  it('keeps document references on the right task when a backup already contains imported IDs', async () => {
    vi.stubGlobal('window', new EventTarget())
    const conversation = { id: 'conv', schemaVersion: 1 as const, title: '会话', modelId: 'm', messages: [{ id: 'msg', role: 'assistant' as const, content: '', taskIds: ['x', 'imported-x', 'imported-imported-x'], createdAt: 1 }], draft: '', referenceImageIds: [], status: 'idle' as const, createdAt: 1, updatedAt: 1, revision: 1 }
    const backup = () => importFile({ version: 3, exportedAt: new Date().toISOString(), tasks: [task({ id: 'x' }), task({ id: 'imported-x' }), task({ id: 'imported-imported-x' })], agentConversations: [conversation] })
    expect(await importData(backup(), { importTasks: true })).toBe(true)
    expect(await importData(backup(), { importTasks: true })).toBe(true)
    expect((await getAllTasks()).map((item) => item.id).sort()).toEqual(['imported-imported-imported-x', 'imported-imported-x', 'imported-x'])
    expect(vi.mocked(importTaskData).mock.lastCall?.[3]?.conversations?.[0].messages[0]).toMatchObject({ taskIds: ['imported-x', 'imported-imported-x', 'imported-imported-imported-x'] })
    vi.unstubAllGlobals()
  })

  it('keeps imported task IDs within the server limit after many export/import hops', async () => {
    const long = `${'imported-'.repeat(11)}${'a'.repeat(36)}`
    expect(await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), tasks: [task({ id: long })] }), { importTasks: true })).toBe(true)
    const ids = (await getAllTasks()).map((item) => item.id)
    expect(ids).toEqual([expect.stringMatching(/^imported-h[0-9a-f]{16}$/)])
    expect(await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), tasks: [task({ id: long })] }), { importTasks: true })).toBe(true)
    expect((await getAllTasks()).map((item) => item.id)).toEqual(ids)
  })

  it('does not change UI data or configuration when the import transaction fails', async () => {
    const db = await import('./lib/db')
    vi.mocked(db.importTaskData).mockRejectedValueOnce(new DOMException('storage full', 'QuotaExceededError'))
    const settings = useStore.getState().settings
    const result = await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), settings: { ...settings, model: 'changed' }, tasks: [task()], imageFiles: {} }))
    expect(result).toBe(false)
    expect(await getAllTasks()).toEqual([])
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().settings).toBe(settings)
  })

  it('restores favorite collections and default collection when importing task data', async () => {
    await clearTasks()
    const importedCollections = [
      { id: 'imported-collection-a', name: '导入收藏夹 A', createdAt: 1, updatedAt: 1 },
      { id: 'imported-collection-b', name: '导入收藏夹 B', createdAt: 2, updatedAt: 2 },
    ]
    const importedTask = task({
      id: 'imported-favorite-task',
      isFavorite: true,
      favoriteCollectionIds: [importedCollections[1].id],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [importedTask],
      favoriteCollections: importedCollections,
      defaultFavoriteCollectionId: importedCollections[1].id,
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.favoriteCollections).toEqual(expect.arrayContaining(importedCollections))
    expect(state.defaultFavoriteCollectionId).toBe(importedCollections[1].id)
    // 导入的任务换了新 ID
    expect(state.tasks[0]).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks())[0]).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
  })

})
describe('failed task cleanup', () => {
  it('clears only failed gallery tasks', async () => {
    const failedA = task({ id: 'failed-a', status: 'error', error: '生成失败', outputImages: ['failed-image-a'] })
    const failedB = task({ id: 'failed-b', status: 'error', error: '生成失败', outputImages: ['failed-image-b'] })
    const done = task({ id: 'done-task', status: 'done', outputImages: ['done-image'] })
    const running = task({ id: 'running-task', status: 'running', finishedAt: null, elapsed: null })
    useStore.setState({
      tasks: [failedA, done, failedB, running],
      selectedTaskIds: ['failed-a', 'done-task', 'failed-b'],
      showToast: vi.fn(),
    })

    await clearFailedTasks()

    const state = useStore.getState()
    expect(state.tasks.map((item) => item.id)).toEqual(['done-task', 'running-task'])
    expect(state.selectedTaskIds).toEqual(['done-task'])
    expect(state.showToast).toHaveBeenCalledWith('已删除 2 个任务', 'success')
  })

  it('matches partial failures in failed filters and searches error text', () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a', 'done-image-b'],
      outputErrors: [{ requestIndex: 2, error: 'Failed to fetch' }],
    })

    expect(taskMatchesFilterStatus(partial, 'error')).toBe(true)
    expect(taskMatchesFilterStatus(partial, 'done')).toBe(true)
    expect(taskMatchesSearchQuery(partial, 'failed to fetch')).toBe(true)
  })

  it('clears partial failure markers without deleting successful outputs', async () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a'],
      outputErrors: [{ requestIndex: 1, error: 'Failed to fetch' }],
    })
    useStore.setState({ tasks: [partial], selectedTaskIds: ['partial-task'], showToast: vi.fn() })

    await clearFailedTasks(['partial-task'])

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ id: 'partial-task', outputImages: ['done-image-a'], outputErrors: undefined })
    expect(state.selectedTaskIds).toEqual([])
    expect(state.showToast).toHaveBeenCalledWith('已清除 1 条部分失败记录', 'success')
  })

  it('keeps failed tasks created after the cleanup snapshot', async () => {
    const failedAtConfirmOpen = task({ id: 'failed-at-confirm-open', status: 'error', error: '生成失败' })
    const failedAfterConfirmOpen = task({ id: 'failed-after-confirm-open', status: 'error', error: '生成失败' })
    useStore.setState({ tasks: [failedAtConfirmOpen] })
    const failedTaskIds = useStore.getState().tasks
      .filter((item) => item.status === 'error')
      .map((item) => item.id)
    useStore.setState({ tasks: [failedAtConfirmOpen, failedAfterConfirmOpen] })

    await clearFailedTasks(failedTaskIds)

    expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['failed-after-confirm-open'])
  })
})

describe('return to creation after reusing library work', () => {
  beforeEach(async () => {
    vi.stubGlobal('window', new EventTarget())
    await clearImages()
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      prompt: '', inputImages: [], maskDraft: null, params: { ...DEFAULT_PARAMS }, tasks: [],
      showToast: vi.fn(), setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('signals only after restoring prompt, images, and mask', async () => {
    await putImage(imageA)
    await putImage({ id: 'creation-mask', dataUrl: 'data:image/png;base64,mask', source: 'upload', createdAt: 1 })
    const onOpen = vi.fn(() => {
      const state = useStore.getState()
      return { prompt: state.prompt, images: state.inputImages, mask: state.maskDraft }
    })
    window.addEventListener('gouo:open-creation', onOpen)

    await reuseConfig(task({
      prompt: '收藏中的提示词', inputImageIds: [imageA.id], maskTargetImageId: imageA.id, maskImageId: 'creation-mask',
    }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.results[0].value).toMatchObject({
      prompt: '收藏中的提示词', images: [imageA], mask: { targetImageId: imageA.id, maskDataUrl: 'data:image/png;base64,mask' },
    })
    expect(useStore.getState().tasks).toEqual([])
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`
    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await putImage(imageA)
    await reuseConfig(task({ prompt: taskPrompt, inputImageIds: [imageA.id, imageB.id] }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('signals after output references are ready without submitting a task', async () => {
    await putImage(imageA)
    const onOpen = vi.fn(() => useStore.getState().inputImages)
    window.addEventListener('gouo:open-creation', onOpen)

    await editOutputs(task())
    expect(onOpen).not.toHaveBeenCalled()
    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.results[0].value).toEqual([imageA])
    expect(useStore.getState().tasks).toEqual([])
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
  })
})
