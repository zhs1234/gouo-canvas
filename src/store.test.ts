import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './lib/apiProfiles'
import type { ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
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
vi.mock('./lib/falAiImageApi', () => ({
  getFalErrorMessage: vi.fn((err: unknown) => err instanceof Error ? err.message : String(err)),
  getFalQueuedImageResult: vi.fn(async () => ({
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
import { clearImages, clearTasks, getAllTasks, getImage, putImage, putTask as putDbTask } from './lib/db'
import { getFalQueuedImageResult } from './lib/falAiImageApi'
import { removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { clearFailedTasks, deleteFavoriteCollection, editOutputs, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, markInterruptedOpenAIRunningTasks, retryTask, reuseConfig, submitTask, taskMatchesFilterStatus, taskMatchesSearchQuery, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

describe('product model task snapshots', () => {
  const models = [
    { id: 'image-a', name: '图片 A', price_cny: 0.1, price_version: 'quote-a', reference: true, mask: true, max_outputs: 2, quota: 100 },
    { id: 'image-b', name: '图片 B', price_cny: 0.3, price_version: 'quote-b', reference: false, mask: false, max_outputs: 1, quota: 300 },
  ]

  beforeEach(async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_ENABLED', 'true')
    await clearTasks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify({ success: true, data: String(url).includes('/token/') ? 'user-token' : models }), { status: 200 }))
    const { createBackendSettings } = await import('./lib/gouoBackend')
    await createBackendSettings(true)
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [], apiKey: 'test-key', model: 'image-a', gouoPriceVersion: 'quote-a', gouoModelSelected: true }),
      tasks: [], prompt: '图片', params: { ...DEFAULT_PARAMS }, inputImages: [], maskDraft: null,
      reusedTaskApiProfileId: null, reusedTaskApiProfileMissing: false, showToast: vi.fn(), setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('stores and sends the selected model and quote even after the picker changes', async () => {
    await submitTask()
    useStore.getState().setSettings({ model: 'image-b', gouoPriceVersion: 'quote-b' })
    const { callImageApi } = await import('./lib/api')
    expect(useStore.getState().tasks[0]).toMatchObject({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1 })
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ settings: { model: 'image-a' }, gouoPriceVersion: 'quote-a' })
    expect(getPersistedState(useStore.getState()).settings).toMatchObject({ model: 'image-b', gouoPriceVersion: 'quote-b', gouoModelSelected: true })
  })

  it('does not persist the platform account token', () => {
    const persisted = JSON.stringify(getPersistedState(useStore.getState()))
    expect(useStore.getState().settings.apiKey).toBe('test-key')
    expect(persisted).not.toContain('test-key')
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
    useStore.getState().setSettings({ clearInputAfterSubmit: true })
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
    useStore.getState().setSettings({ clearInputAfterSubmit: true })
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
    useStore.getState().setSettings({ clearInputAfterSubmit: true })
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
    expect(confirmation).toMatchObject({ title: '确认付费重试', message: expect.stringContaining('全部成功预计扣费 ¥0.10') })
    await confirmation?.action?.()
    expect(useStore.getState().tasks[0]).toMatchObject({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1 })
    expect(vi.mocked(callImageApi).mock.calls[0][0]).toMatchObject({ settings: { model: 'image-a' }, gouoPriceVersion: 'quote-a' })
  })

  it('requires confirmation before retrying a legacy task at the current price', async () => {
    await retryTask(task({ apiModel: 'image-a', status: 'error' }))
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '确认重试价格', message: expect.stringContaining('当前价格为 ¥0.1/次成功请求。重试会新建 1 次单图请求') }))
  })

  it('rechecks the quote after the user confirms a retry', async () => {
    await retryTask(task({ apiModel: 'image-a', gouoPriceVersion: 'quote-a', gouoPriceCNY: 0.1, status: 'error' }))
    const confirmation = vi.mocked(useStore.getState().setConfirmDialog).mock.calls.slice(-1)[0]?.[0]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true, data: [{ ...models[0], price_cny: 0.5, price_version: 'changed' }] })))
    await confirmation?.action?.()
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().setConfirmDialog).toHaveBeenLastCalledWith(expect.objectContaining({ title: '确认重试价格', message: expect.stringContaining('¥0.5') }))
  })

  it('preserves billing guidance when a running backend task is interrupted', () => {
    const result = markInterruptedOpenAIRunningTasks([task({ status: 'running' })])
    expect(result.tasks[0].error).toContain('图片请求状态')
    expect(result.tasks[0].error).toContain('不代表已退款')
  })

  it('distinguishes local save failure after a paid result from an upstream failure', async () => {
    const { callImageApi } = await import('./lib/api')
    const db = await import('./lib/db')
    vi.mocked(callImageApi).mockResolvedValueOnce({ images: ['data:image/png;base64,test'], actualParams: {}, actualParamsList: [], revisedPrompts: [] })
    vi.spyOn(db, 'storeImageWithSize').mockRejectedValueOnce(new DOMException('storage full', 'QuotaExceededError'))
    await submitTask()
    await vi.waitFor(() => expect(useStore.getState().tasks[0].status).toBe('error'))
    expect(useStore.getState().tasks[0].error).toContain('生成结果已返回，但本地处理或保存失败')
    expect(useStore.getState().tasks[0].error).toContain('不代表已退款')
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
    expect(confirmation?.message).toContain('全部成功预计扣费 ¥0.60')
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
      useStore.getState().setSettings({ timeout: 1 })
      const running = task({ status: 'running', createdAt: Date.now(), params: { ...DEFAULT_PARAMS, n: 2 } })
      useStore.setState({ tasks: [running] })
      const { executeTask } = await import('./store')
      const execution = executeTask(running.id)
      await vi.advanceTimersByTimeAsync(1500)
      expect(useStore.getState().tasks[0].status).toBe('running')
      finish({ images: ['data:image/png;base64,success'], actualParamsList: [{ size: '1024x1024' }], failedRequests: [{ requestIndex: 1, error: '请求超时' }] })
      await execution
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'done', outputErrors: [{ requestIndex: 1, error: '请求超时' }] })
      expect(useStore.getState().tasks[0].outputImages).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers an old failed task with its original request ID without requiring deleted inputs or creating a new task', async () => {
    const { callImageApi } = await import('./lib/api')
    const { executeTask } = await import('./store')
    vi.mocked(callImageApi).mockResolvedValueOnce({ images: ['data:image/png;base64,recovered'] })
    const failed = task({ status: 'error', requestId: 'agent:conversation:call-original', gouoPriceVersion: 'quote-a', createdAt: 1, inputImageIds: ['missing-input'], maskImageId: 'missing-mask', apiProfileId: 'removed-profile' })
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

  it.each(['failure', 'success', 'saved output'])('ignores an old execution %s after watchdog timeout and result recovery starts', async (outcome) => {
    vi.useFakeTimers()
    try {
      const { callImageApi } = await import('./lib/api')
      const { executeTask } = await import('./store')
      const db = await import('./lib/db')
      let finishOld!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
      let failOld!: (error: Error) => void
      let finishRecovery!: (value: Awaited<ReturnType<typeof callImageApi>>) => void
      let releaseSave!: () => void
      vi.mocked(callImageApi)
        .mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; failOld = reject }))
        .mockImplementationOnce(() => new Promise((resolve) => { finishRecovery = resolve }))
      if (outcome === 'saved output') {
        const save = db.storeImageWithSize
        const gate = new Promise<void>((resolve) => { releaseSave = resolve })
        vi.spyOn(db, 'storeImageWithSize').mockImplementationOnce(async (...args) => { await gate; return save(...args) })
      }
      useStore.getState().setSettings({ timeout: 1 })
      const running = task({ status: 'running', gouoPriceVersion: 'quote-a', requestId: 'original-request', createdAt: Date.now() })
      useStore.setState({ tasks: [running] })
      const original = executeTask(running.id)
      if (outcome === 'saved output') finishOld({ images: ['data:image/png;base64,stale-original'] })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(useStore.getState().tasks[0].status).toBe('error')
      const recovery = executeTask(running.id, true)
      if (outcome === 'failure') failOld(new Error('old request aborted'))
      else if (outcome === 'success') finishOld({ images: ['data:image/png;base64,stale-original'] })
      else releaseSave()
      await original
      expect(useStore.getState().tasks[0]).toMatchObject({ status: 'running', error: null, outputImages: [] })
      expect((await db.getAllImages()).some((image) => image.dataUrl === 'data:image/png;base64,stale-original')).toBe(false)
      await vi.advanceTimersByTimeAsync(2_000)
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

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
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
    expect(state.showToast).toHaveBeenCalledWith('任务已提交，可在「我的作品」查看进度', 'success')
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

  it('supports transparent background post-processing for fal gallery tasks', async () => {
    const { callImageApi } = await import('./lib/api')
    const falProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,fal-generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [falProfile],
        activeProfileId: falProfile.id,
      }),
      prompt: '单主体图标素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        output_format: 'png',
        transparent_output: true,
      }),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,fal-generated')
    const [task] = useStore.getState().tasks
    expect(task.apiProvider).toBe('fal')
    expect(task.transparentOutput).toBe(true)
    expect(task.transparentOriginalImages).toHaveLength(1)
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
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('leaves tasks that another tab is still executing as running', async () => {
    await clearTasks()
    await putDbTask(task({ id: 'other-tab', apiProvider: 'openai', status: 'running', finishedAt: null, elapsed: null }))
    await putDbTask(task({ id: 'abandoned', apiProvider: 'openai', status: 'running', finishedAt: null, elapsed: null }))
    // 另一个标签页正在执行 other-tab，持有它的任务锁
    vi.stubGlobal('navigator', { locks: {
      query: async () => ({ held: [{ name: 'gouo-task:other-tab' }, { name: 'gouo-tab' }] }),
      // 其他标签页持有共享的标签页锁：申请排他锁拿不到
      request: async (...args: unknown[]) => (args[args.length - 1] as (lock: null) => unknown)(null),
    } })
    try {
      await initStore()
    } finally {
      vi.unstubAllGlobals()
    }
    const byId = Object.fromEntries(useStore.getState().tasks.map((item) => [item.id, item.status]))
    expect(byId).toMatchObject({ 'other-tab': 'running', abandoned: 'error' })
  })

  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const customAsyncRunning = task({ id: 'custom-running', apiProvider: 'custom-provider', customTaskId: 'task-1', status: 'running', createdAt: 4_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, customAsyncRunning, doneTask], now)

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
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      prompt: 'prompt',
      inputImages: [imageA],
      dismissedCodexCliPrompts: [],
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

describe('fal task recovery', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    vi.mocked(getFalQueuedImageResult).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    const falProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [falProfile],
        activeProfileId: falProfile.id,
      }),
      tasks: [],
      inputImages: [],
      showToast: vi.fn(),
    })
  })

  it('applies transparent post-processing when a fal task recovers', async () => {
    const falTask = task({
      id: 'fal-transparent-task',
      apiProvider: 'fal',
      apiProfileId: 'fal-profile',
      apiProfileName: 'fal',
      apiModel: 'fal-model',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        transparent_output: true,
      },
      transparentOutput: true,
      transparentPrompt: 'transparent:prompt',
      status: 'error',
      error: '连接已断开，等待自动恢复',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      finishedAt: null,
      elapsed: null,
    })
    await putDbTask(falTask)
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,fal-recovered'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })

    await initStore()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,fal-recovered')
    const recovered = useStore.getState().tasks.find((item) => item.id === falTask.id)
    expect(recovered).toMatchObject({
      status: 'done',
      falRecoverable: false,
      transparentOutput: true,
    })
    expect(recovered?.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(recovered!.outputImages[0])
    const originalImage = await getImage(recovered!.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,fal-recovered')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,fal-recovered')
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
    expect((await getAllTasks()).find((item) => item.id === 'new')).toMatchObject({ cloudId: undefined, outputImages: ['new-image'] })
    expect(await getImage('new-image')).toMatchObject({ dataUrl: 'data:image/png;base64,AQID' })
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已导入 1 个任务，保留 1 个同 ID 的现有任务', 'success')
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

  it('assigns a fresh task identity in account mode to preserve cloud records not yet downloaded', async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_ENABLED', 'true')
    try {
      const result = await importData(importFile({ version: 3, exportedAt: new Date().toISOString(), tasks: [task({ id: 'old-cloud-client-id', cloudId: 'old-cloud-id' })], imageFiles: {} }), { importTasks: true })
      expect(result).toBe(true)
      const [restored] = await getAllTasks()
      expect(restored.id).not.toBe('old-cloud-client-id')
      expect(restored.cloudId).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
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
    expect(state.tasks.find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks()).find((item) => item.id === importedTask.id)).toMatchObject({
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

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const falProfile = createDefaultFalProfile({ id: 'fal-profile', name: 'fal 配置', apiKey: 'fal-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, falProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    expect(resolved?.id).toBe(falProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({
      apiProvider: 'fal',
      apiProfileName: falProfile.name,
      apiModel: falProfile.model,
    }))

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(falProfile.id)
    expect(state.params).toMatchObject({ n: 4, size: '1360x1024', quality: 'high' })
    expect(state.showToast).toHaveBeenCalledWith('已临时复用该任务的 API 配置「fal 配置」', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: taskPrompt,
      inputImageIds: [imageA.id, imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    useStore.getState().setSettings({ activeProfileId: falProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(falProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '找不到 API 配置',
      message: '找不到复用任务所使用的 API 配置「未知配置」，要使用当前的 API 配置「默认」提交任务吗？',
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
    }))
    expect(state.showSettings).toBe(false)
  })
})


describe('return to creation after reusing library work', () => {
  const profile = createDefaultOpenAIProfile({ id: 'creation-profile', apiKey: 'test-key' })

  beforeEach(async () => {
    vi.stubGlobal('window', new EventTarget())
    await clearImages()
    const { callImageApi } = await import('./lib/api')
    vi.mocked(callImageApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id, reuseTaskApiProfileTemporarily: true }),
      prompt: '', inputImages: [], maskDraft: null, params: { ...DEFAULT_PARAMS }, tasks: [],
      reusedTaskApiProfileId: null, reusedTaskApiProfileMissing: false,
      showToast: vi.fn(), setConfirmDialog: vi.fn(),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('signals only after restoring prompt, images, and mask (missing profile: %s)', async (missingProfile) => {
    await putImage(imageA)
    await putImage({ id: 'creation-mask', dataUrl: 'data:image/png;base64,mask', source: 'upload', createdAt: 1 })
    const onOpen = vi.fn(() => {
      const state = useStore.getState()
      return { prompt: state.prompt, images: state.inputImages, mask: state.maskDraft }
    })
    window.addEventListener('gouo:open-creation', onOpen)

    await reuseConfig(task({
      apiProvider: 'openai', apiProfileId: missingProfile ? 'missing-profile' : profile.id,
      prompt: '收藏中的提示词', inputImageIds: [imageA.id], maskTargetImageId: imageA.id, maskImageId: 'creation-mask',
    }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.results[0].value).toMatchObject({
      prompt: '收藏中的提示词', images: [imageA], mask: { targetImageId: imageA.id, maskDataUrl: 'data:image/png;base64,mask' },
    })
    expect(useStore.getState().setConfirmDialog).toHaveBeenCalledTimes(missingProfile ? 1 : 0)
    expect(useStore.getState().tasks).toEqual([])
    const { callImageApi } = await import('./lib/api')
    expect(callImageApi).not.toHaveBeenCalled()
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
