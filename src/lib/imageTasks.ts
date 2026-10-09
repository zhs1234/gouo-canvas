import type { TaskParams, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { useStore, ensureImageCached, cacheImage, executeTask, createSettingsForApiProfile } from '../store'
import { normalizeSettings, getActiveApiProfile, validateApiProfile } from './apiProfiles'
import { putTask, storeImage } from './db'
import { orderInputImagesForMask } from './mask'
import { validateMaskMatchesImage } from './canvasImage'
import { getImageModelQuote, isBackendAuthEnabled } from './gouoBackend'
import { getChangedParams, normalizeParamsForSettings } from './paramCompatibility'
import { getTransparentRequestParams, createTransparentOutputMeta } from './transparentImage'
import { getActionableErrorMessage } from './userGuidance'
import { isStorageScopeCurrent } from './storageScope'

export interface ImageTaskInput {
  prompt: string
  model?: string
  params?: Partial<TaskParams>
  inputImageIds?: string[]
  maskImageId?: string
  maskTargetImageId?: string
  allowFullMask?: boolean
  source: NonNullable<TaskRecord['source']>
  requestId?: string
  // model 与全局模型不同时，调用方展示给用户的价格版本（如画布节点单独选择的模型）
  priceVersion?: string
  // 调用方已取消（如 Agent 点了停止）时，在任务落库并派发前放弃
  signal?: AbortSignal
}

type SubmitOptions = { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean }
const pendingRequests = new Map<string, Promise<string>>()

export function submitImageTask(input: ImageTaskInput): Promise<string> {
  if (!input.prompt.trim() || input.prompt.length > 100000) return Promise.reject(new Error('提示词为空或过长'))
  if (input.inputImageIds && (input.inputImageIds.length > 16 || input.inputImageIds.some((id) => typeof id !== 'string' || !id))) return Promise.reject(new Error('参考图片无效'))
  if (input.params?.n !== undefined && (!Number.isInteger(input.params.n) || input.params.n < 1 || input.params.n > 10)) return Promise.reject(new Error('图片数量必须为 1 到 10'))
  if (input.requestId && !/^[a-zA-Z0-9_:-]{1,512}$/.test(input.requestId)) return Promise.reject(new Error('任务请求标识无效，请重新发起任务'))
  if (input.requestId && pendingRequests.has(input.requestId)) return pendingRequests.get(input.requestId)!
  const request = submitFromInput({}, input).then((id) => {
    if (!id) throw new Error('任务未能提交')
    return id
  })
  if (input.requestId) {
    pendingRequests.set(input.requestId, request)
    void request.finally(() => pendingRequests.delete(input.requestId!)).catch(() => {})
  }
  return request
}

export function submitTask(options: SubmitOptions = {}) {
  return submitFromInput(options)
}

async function submitFromInput(options: SubmitOptions = {}, input?: ImageTaskInput): Promise<string | undefined> {
  if (!input && useStore.getState().isSubmitting) return
  if (!input) useStore.setState({ isSubmitting: true })
  try {
    const state = useStore.getState()
    const { settings, showToast, setConfirmDialog } = state
    const prompt = input?.prompt ?? state.prompt
    const params = input ? { ...DEFAULT_PARAMS, ...input.params } : state.params
    const inputImages = input ? await Promise.all((input.inputImageIds ?? []).map(async (id) => {
      const dataUrl = await ensureImageCached(id)
      if (!dataUrl) throw new Error(`参考图片不存在：${id}`)
      return { id, dataUrl }
    })) : state.inputImages
    const maskDataUrl = input?.maskImageId ? await ensureImageCached(input.maskImageId) : undefined
    if (input?.maskImageId && !maskDataUrl) throw new Error('遮罩图片不存在，请重新绘制遮罩')
    const maskDraft = input ? (maskDataUrl ? {
      targetImageId: input.maskTargetImageId ?? input.inputImageIds?.[0] ?? '',
      maskDataUrl,
    } : null) : state.maskDraft
    const reusedTaskApiProfileId = input ? null : state.reusedTaskApiProfileId
    const reusedTaskApiProfileName = state.reusedTaskApiProfileName
    const reusedTaskApiProfileMissing = !input && state.reusedTaskApiProfileMissing
    if (input?.requestId) {
      const existing = useStore.getState().tasks.find((task) => task.requestId === input.requestId)
      if (existing) return existing.id
    }

    const normalizedSettings = normalizeSettings(settings)
    let activeProfile = getActiveApiProfile(settings)
    if (input?.model) activeProfile = { ...activeProfile, model: input.model }
    let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
    if (normalizedSettings.reuseTaskApiProfileTemporarily && (reusedTaskApiProfileId || reusedTaskApiProfileMissing)) {
      const reusedProfile = normalizedSettings.profiles.find((profile) => profile.id === reusedTaskApiProfileId)
      if (!reusedProfile) {
        if (options.useCurrentApiProfileWhenReusedMissing) {
          useStore.getState().setReusedTaskApiProfile(null)
        } else {
          setConfirmDialog({
            title: '找不到 API 配置',
        message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
        confirmText: '使用当前配置提交',
        cancelText: '放弃提交',
        action: () => {
          void submitTask({ ...options, useCurrentApiProfileWhenReusedMissing: true })
        },
          })
          return
        }
      } else {
        activeProfile = reusedProfile
        requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
      }
    }

    if (validateApiProfile(activeProfile)) {
      if (input) throw new Error(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`)
      showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
      useStore.getState().setShowSettings(true)
      return
    }

    if (!prompt.trim()) {
      if (input) throw new Error('请输入提示词')
      showToast('请输入提示词', 'error')
      return
    }

    let quote: Awaited<ReturnType<typeof getImageModelQuote>> | undefined
    if (isBackendAuthEnabled()) {
      try {
        quote = await getImageModelQuote(activeProfile.model, inputImages.length, Boolean(maskDraft), params.n, input?.model && input.model !== settings.model ? input.priceVersion : settings.gouoPriceVersion)
      } catch (err) {
        if (input) throw err
        showToast(err instanceof Error ? err.message : String(err), 'error')
        return
      }
    }

    let orderedInputImages = inputImages
    let maskImageId: string | null = null
    let maskTargetImageId: string | null = null

    if (maskDraft) {
      try {
        orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
        const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
        if (coverage === 'full' && !(input?.allowFullMask ?? options.allowFullMask)) {
          if (input) throw new Error('遮罩覆盖整张图片，请确认全图重绘后再次提交')
          setConfirmDialog({
            title: '确认编辑整张图片？',
            message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
            confirmText: '继续提交',
            tone: 'warning',
            action: () => {
              void submitTask({ allowFullMask: true })
            },
          })
          return
        }
        maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
        cacheImage(maskImageId, maskDraft.maskDataUrl)
        maskTargetImageId = maskDraft.targetImageId
      } catch (err) {
        if (input) throw err
        if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
          useStore.getState().clearMaskDraft()
        }
        showToast(getActionableErrorMessage(err instanceof Error ? err.message : String(err)), 'error')
        return
      }
    }

    // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
    for (const img of orderedInputImages) {
      await storeImage(img.dataUrl)
    }

    const normalizedParams = normalizeParamsForSettings(params, requestSettings, { hasInputImages: orderedInputImages.length > 0 })
    const shouldUseTransparentOutput = normalizedParams.output_format === 'png' && normalizedParams.transparent_output
    const taskParams = shouldUseTransparentOutput
      ? getTransparentRequestParams(normalizedParams)
      : { ...normalizedParams, transparent_output: false }
    const transparentMeta = taskParams.transparent_output
      ? createTransparentOutputMeta(prompt.trim())
      : null
    const normalizedParamPatch = getChangedParams(params, taskParams)
    if (!input && useStore.getState().params === params && Object.keys(normalizedParamPatch).length) {
      useStore.getState().setParams(normalizedParamPatch)
    }

    const taskId = crypto.randomUUID()
    const task: TaskRecord = {
      id: taskId,
      source: input?.source ?? { kind: 'generate' },
      requestId: input?.requestId ?? taskId,
      prompt: prompt.trim(),
      params: taskParams,
      apiProvider: activeProfile.provider,
      apiProfileId: activeProfile.id,
      apiProfileName: activeProfile.name,
      apiMode: activeProfile.apiMode,
      apiModel: activeProfile.model,
      gouoPriceVersion: quote?.price_version,
      gouoPriceCNY: quote?.price_cny,
      inputImageIds: orderedInputImages.map((i) => i.id),
      maskTargetImageId,
      maskImageId,
      transparentOutput: transparentMeta?.transparentOutput,
      transparentPrompt: transparentMeta?.effectivePrompt,
      outputImages: [],
      status: 'running',
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
      elapsed: null,
    }

    if (!isStorageScopeCurrent()) throw new Error('账号已切换，请刷新页面')
    // 等待报价、读取和保存图片期间可能已被取消；落库后任务会派发并计费，不能再中断
    input?.signal?.throwIfAborted()
    await putTask(task)
    useStore.getState().setTasks([task, ...useStore.getState().tasks])
    useStore.getState().showToast('任务已提交，可在「我的作品」查看进度', 'success')

    const latest = useStore.getState()
    // 等待报价或保存期间编辑的新草稿不能随旧任务一起清空。
    if (!input && latest.prompt === prompt && latest.inputImages === inputImages && latest.maskDraft === maskDraft) {
      if (settings.clearInputAfterSubmit) {
        latest.setPrompt('')
        latest.clearInputImages()
      }
      if (latest.reusedTaskApiProfileId === reusedTaskApiProfileId) latest.setReusedTaskApiProfile(null)
    }

    // 异步调用 API
    void executeTask(taskId)
    return taskId
  } catch (err) {
    console.warn('提交任务失败', err)
    if (input) throw err
    useStore.getState().showToast(`提交失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    if (!input) useStore.setState({ isSubmitting: false })
  }
}

