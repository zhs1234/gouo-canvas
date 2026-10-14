import type { ImageApiResponse } from '../types'
import { dataUrlToBlob, imageDataUrlToPngBlob, maskDataUrlToPngBlob } from './canvasImage'
import {
  assertImageInputPayloadSize,
  assertMaskEditFileSize,
  type CallApiOptions,
  type CallApiResult,
  fetchImageUrlAsDataUrl,
  getApiErrorMessage,
  isDataUrl,
  isHttpUrl,
  mergeActualParams,
  MIME_MAP,
  normalizeBase64Image,
  pickActualParams,
} from './imageApiShared'
import { createBackendSettings, isInvalidBackendTokenError } from './gouoBackend'

export type { CallApiOptions, CallApiResult } from './imageApiShared'

// 平台出图在后端最长 15 分钟；前端先中止会断开连接，后端随之取消上游请求，已预扣的额度只能等人工核对。
// 因此固定比后端多等 1 分钟（与部署 Nginx 的 960 秒一致）
const REQUEST_TIMEOUT_MS = 960_000

interface Relay {
  baseUrl: string
  apiKey: string
}

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  try {
    return await callImages(opts, await createBackendSettings())
  } catch (error) {
    if (error instanceof Error && error.message.includes('模型价格或能力已更新') && typeof window !== 'undefined') window.dispatchEvent(new Event('gouo-models-refresh'))
    if ((error instanceof Error && 'imageResultRecovery' in error) || !isInvalidBackendTokenError(error)) throw error
    return callImages(opts, await createBackendSettings(true))
  }
}

// 多张图拆成并发单图请求，各自带序号，服务端按序号分别结算和保存
async function callImages(opts: CallApiOptions, relay: Relay): Promise<CallApiResult> {
  const n = opts.params.n > 0 ? opts.params.n : 1
  if (n === 1) return callImagesSingle(opts, relay)

  const results = await Promise.allSettled(Array.from({ length: n }, (_, requestIndex) => callImagesSingle({
    ...opts,
    params: { ...opts.params, n: 1 },
    requestId: opts.requestId ? `${opts.requestId}:${requestIndex}` : undefined,
    requestIndex,
  }, relay)))

  const successfulResults = results
    .filter((r): r is PromiseFulfilledResult<CallApiResult> => r.status === 'fulfilled')
    .map((r) => r.value)
  const failedRequests = results.flatMap((r, requestIndex) =>
    r.status === 'rejected' ? [{ requestIndex, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }] : [],
  )

  if (successfulResults.length === 0) {
    const reason = (results[0] as PromiseRejectedResult).reason
    const error = reason instanceof Error ? reason : new Error(String(reason))
    const recovering = results.some((r) => r.status === 'rejected' && r.reason instanceof Error && 'imageResultRecovery' in r.reason)
    throw Object.assign(error, { failedRequests, ...(recovering ? { imageResultRecovery: true } : {}) })
  }

  const images = successfulResults.flatMap((r) => r.images)
  const rawImageUrls = successfulResults.flatMap((r) => r.rawImageUrls ?? [])
  return {
    images,
    actualParams: mergeActualParams(successfulResults[0].actualParams ?? {}, { n: images.length }),
    actualParamsList: successfulResults.flatMap((r) => r.actualParamsList?.length ? r.actualParamsList : r.images.map(() => r.actualParams)),
    revisedPrompts: successfulResults.flatMap((r) => r.revisedPrompts?.length ? r.revisedPrompts : r.images.map(() => undefined)),
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
    ...(failedRequests.length ? { failedRequests } : {}),
  }
}

async function parseImagesResponse(payload: ImageApiResponse, mime: string, signal?: AbortSignal): Promise<CallApiResult> {
  const data = payload.data
  const images: string[] = []
  const rawImageUrls = Array.isArray(data) ? data.map((item) => item.url).filter(isHttpUrl) : []
  const revisedPrompts: Array<string | undefined> = []
  try {
    for (const item of Array.isArray(data) ? data : []) {
      const revisedPrompt = typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined
      if (item.b64_json) {
        images.push(normalizeBase64Image(item.b64_json, mime))
        revisedPrompts.push(revisedPrompt)
      } else if (isHttpUrl(item.url) || isDataUrl(item.url)) {
        images.push(await fetchImageUrlAsDataUrl(item.url, mime, signal))
        revisedPrompts.push(revisedPrompt)
      }
    }
  } catch (err) {
    if (rawImageUrls.length && err instanceof Error) Object.assign(err, { rawImageUrls })
    throw err
  }

  if (!images.length) throw Object.assign(new Error('接口没有返回可识别的图片数据，请查看原始响应内容。'), { rawResponsePayload: JSON.stringify(payload, null, 2) })

  const actualParams = mergeActualParams(pickActualParams(payload))
  return {
    images,
    actualParams,
    actualParamsList: images.map(() => actualParams),
    revisedPrompts,
    ...(rawImageUrls.length ? { rawImageUrls } : {}),
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError || err instanceof SyntaxError) return true
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

// 按原请求编号读取服务端保存的结果，只读不重新生成
async function recoverImageResult(opts: CallApiOptions, relay: Relay, signal: AbortSignal): Promise<CallApiResult> {
  const startedAt = Date.now()
  const url = `${relay.baseUrl.replace(/\/v1\/?$/, '')}/api/gouo/image-results?client_request_id=${encodeURIComponent(opts.requestId!)}`
  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  try {
    while (!signal.aborted) {
      let payload: { success?: boolean; data?: { status?: string; recoverable?: boolean; result?: ImageApiResponse; reason?: string } }
      try {
        const response = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', signal })
        if ((response.status === 404 && Date.now() - startedAt < 10_000) || response.status === 408 || response.status === 429 || response.status >= 500) {
          await sleep(2_000, signal)
          continue
        }
        if (response.status === 401 || response.status === 403) throw new Error('无法读取原图片请求结果，请重新登录后恢复作品；未重新生成')
        if (response.status === 404) throw new Error('暂未找到原图片请求记录；未重新生成，请稍后在作品中恢复结果')
        if (!response.ok) throw new Error(`读取原图片请求结果失败（状态码 ${response.status}）；未重新生成`)
        payload = await response.json()
      } catch (err) {
        if (signal.aborted) break
        if (!isNetworkError(err)) throw err
        await sleep(2_000, signal)
        continue
      }
      const result = payload.data
      if (!payload.success || !result) throw new Error('原图片请求结果格式无效；未重新生成')
      if (result.recoverable && result.result) return await parseImagesResponse(result.result, mime, signal)
      if (result.reason === 'not_ready' || result.status === 'reserved' || result.status === 'dispatched') {
        await sleep(2_000, signal)
        continue
      }
      const reason = result.reason === 'result_expired' ? '保存期限已过' : result.status === 'refunded' ? '请求已退款' : '服务端未保存可恢复结果'
      throw new Error(`原图片请求暂不可恢复：${reason}；未重新生成，请查看图片请求状态`)
    }
    throw new Error('等待原图片请求结果超时；未重新生成，请稍后在作品中恢复结果')
  } catch (err) {
    const error = opts.signal?.aborted
      ? new DOMException('图片结果恢复已取消；未重新生成', 'AbortError')
      : signal.aborted ? new Error('等待原图片请求结果超时；未重新生成，请稍后在作品中恢复结果') : err instanceof Error ? err : new Error(String(err))
    // 恢复只允许读取，不能让外层令牌刷新逻辑重新提交收费请求。
    throw Object.assign(error, { imageResultRecovery: true })
  }
}

async function callImagesSingle(opts: CallApiOptions, relay: Relay): Promise<CallApiResult> {
  const { prompt, params, inputImageDataUrls } = opts
  const mime = MIME_MAP[params.output_format] || 'image/png'
  const headers: Record<string, string> = { Authorization: `Bearer ${relay.apiKey}` }
  if (opts.gouoPriceVersion) headers['X-Gouo-Price-Version'] = opts.gouoPriceVersion
  if (opts.requestId) headers['X-Gouo-Request-Id'] = opts.requestId
  if (opts.taskId) {
    headers['X-Gouo-Task-Id'] = opts.taskId
    headers['X-Gouo-Request-Index'] = String(opts.requestIndex ?? 0)
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  opts.signal?.addEventListener('abort', abort, { once: true })
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response | undefined
  let requestSent = false

  try {
    if (opts.recoverOnly) {
      if (!opts.requestId) throw new Error('缺少平台原请求编号，不能恢复结果')
      return await recoverImageResult(opts, relay, controller.signal)
    }

    if (inputImageDataUrls.length) {
      const formData = new FormData()
      formData.append('model', opts.model)
      formData.append('prompt', prompt)
      formData.append('size', params.size)
      formData.append('output_format', params.output_format)
      formData.append('moderation', params.moderation)
      formData.append('quality', params.quality)
      if (params.output_format !== 'png' && params.output_compression != null) formData.append('output_compression', String(params.output_compression))
      if (params.n > 1) formData.append('n', String(params.n))

      const imageBlobs: Blob[] = []
      for (const [i, dataUrl] of inputImageDataUrls.entries()) {
        imageBlobs.push(opts.maskDataUrl && i === 0 ? await imageDataUrlToPngBlob(dataUrl) : await dataUrlToBlob(dataUrl))
      }
      const maskBlob = opts.maskDataUrl ? await maskDataUrlToPngBlob(opts.maskDataUrl) : null
      if (maskBlob) {
        assertMaskEditFileSize('遮罩主图文件', imageBlobs[0]?.size ?? 0)
        assertMaskEditFileSize('遮罩文件', maskBlob.size)
      }
      assertImageInputPayloadSize(imageBlobs.reduce((sum, blob) => sum + blob.size, 0) + (maskBlob?.size ?? 0))
      for (const [i, blob] of imageBlobs.entries()) formData.append('image[]', blob, `input-${i + 1}.${blob.type.split('/')[1] || 'png'}`)
      if (maskBlob) formData.append('mask', maskBlob, 'mask.png')

      requestSent = true
      response = await fetch(`${relay.baseUrl}/images/edits`, { method: 'POST', headers, cache: 'no-store', body: formData, signal: controller.signal })
    } else {
      const body: Record<string, unknown> = {
        model: opts.model,
        prompt,
        size: params.size,
        output_format: params.output_format,
        moderation: params.moderation,
        quality: params.quality,
      }
      if (params.output_format !== 'png' && params.output_compression != null) body.output_compression = params.output_compression
      if (params.n > 1) body.n = params.n

      requestSent = true
      response = await fetch(`${relay.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    }

    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    return await parseImagesResponse(await response.json() as ImageApiResponse, mime, controller.signal)
  } catch (err) {
    // 超时中止也要恢复：请求可能已在服务端扣费，恢复使用独立计时，只有用户取消才放弃。
    if (opts.requestId && requestSent && !opts.signal?.aborted && (!response || response.ok || response.status >= 500) && (isNetworkError(err) || (response && response.status >= 500))) {
      clearTimeout(timeoutId)
      const recovery = new AbortController()
      const stop = () => recovery.abort()
      opts.signal?.addEventListener('abort', stop, { once: true })
      const recoveryTimer = setTimeout(stop, REQUEST_TIMEOUT_MS)
      try {
        return await recoverImageResult(opts, relay, recovery.signal)
      } finally {
        clearTimeout(recoveryTimer)
        opts.signal?.removeEventListener('abort', stop)
      }
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener('abort', abort)
  }
}
