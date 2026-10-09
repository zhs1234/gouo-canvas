import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi, type CallApiOptions } from './api'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { createBackendSettings } from './gouoBackend'

const options: CallApiOptions = {
  settings: { ...DEFAULT_SETTINGS, model: 'gpt-image-2', timeout: 10 },
  prompt: '原始图片', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [], requestId: 'original-task',
}
const recovered = { success: true, data: { status: 'settled', recoverable: true, result: { data: [{ b64_json: 'aW1hZ2U=', revised_prompt: '原始改写提示词' }], size: '1024x1024' } } }

describe('product image result recovery', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_ENABLED', 'true')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'product-token' })))
    await createBackendSettings(true)
    vi.mocked(fetch).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it.each(['network', 'truncated', 'gateway'])('reads the original result after a %s failure without posting again', async (failure) => {
    const fetchMock = vi.mocked(fetch)
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    else fetchMock.mockResolvedValueOnce(new Response(failure === 'truncated' ? '{"data":[' : 'Bad Gateway', { status: failure === 'gateway' ? 502 : 200 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(recovered)))
    const result = await callImageApi(options)
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.revisedPrompts).toEqual(['原始改写提示词'])
    expect(result.actualParams).toMatchObject({ size: '1024x1024' })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/gouo/image-results?client_request_id=original-task')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'include', cache: 'no-store' })
  })

  it('keeps polling through a short missing record, a disconnected read, and a pending result', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { status: 'dispatched', recoverable: false, reason: 'not_ready' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify(recovered)))
    const pending = callImageApi(options)
    await vi.advanceTimersByTimeAsync(6_000)
    expect((await pending).images).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(4)
  })

  it('recovers each original batch child with GET only', async () => {
    const fetchMock = vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(recovered)))
    const result = await callImageApi({ ...options, recoverOnly: true, params: { ...DEFAULT_PARAMS, n: 2 } })
    expect(result.images).toHaveLength(2)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/gouo/image-results?client_request_id=original-task%3A0',
      '/api/gouo/image-results?client_request_id=original-task%3A1',
    ])
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('only reads the interrupted child of a partially successful batch', async () => {
    const broken = new Response()
    vi.spyOn(broken, 'json').mockRejectedValueOnce(new TypeError('terminated'))
    const fetchMock = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'Zmlyc3Q=' }] })))
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(new Response(JSON.stringify(recovered)))
    const result = await callImageApi({ ...options, params: { ...DEFAULT_PARAMS, n: 2 } })
    expect(result.images).toEqual(['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,aW1hZ2U='])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST', 'GET'])
    expect(fetchMock.mock.calls[2][0]).toBe('/api/gouo/image-results?client_request_id=original-task%3A1')
  })

  it('does not refresh a token or resubmit when recovery requires login', async () => {
    const fetchMock = vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'invalid token' }), { status: 401 }))
    await expect(callImageApi(options)).rejects.toMatchObject({ imageResultRecovery: true, message: expect.stringContaining('重新登录') })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
  })

  it('does not resubmit a batch when one child needs authentication and another entered recovery', async () => {
    const fetchMock = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { status: 'settled', recoverable: false, reason: 'result_unavailable' } })))
    await expect(callImageApi({ ...options, params: { ...DEFAULT_PARAMS, n: 2 } })).rejects.toMatchObject({ imageResultRecovery: true, failedRequests: [{ requestIndex: 0, error: 'invalid token' }, { requestIndex: 1, error: expect.stringContaining('未重新生成') }] })
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST', 'GET'])
  })

  it.each(['result_unavailable', 'result_expired'])('reports %s without another generation request', async (reason) => {
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { status: 'settled', recoverable: false, reason } })))
    await expect(callImageApi({ ...options, recoverOnly: true })).rejects.toMatchObject({ imageResultRecovery: true, message: expect.stringContaining('未重新生成') })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
  })

  it('stops recovery at the original request timeout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { status: 'dispatched', recoverable: false, reason: 'not_ready' } })))
    const pending = expect(callImageApi({ ...options, settings: { ...options.settings, timeout: 3 } })).rejects.toMatchObject({ imageResultRecovery: true, message: expect.stringContaining('等待原图片请求结果超时') })
    await vi.advanceTimersByTimeAsync(3_000)
    await pending
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'GET'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers a charged result after the request timeout aborts', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.mocked(fetch)
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
      .mockResolvedValueOnce(new Response(JSON.stringify(recovered)))
    const pending = callImageApi({ ...options, settings: { ...options.settings, timeout: 3 } })
    await vi.advanceTimersByTimeAsync(3_000)
    expect((await pending).images).toHaveLength(1)
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending recovery without posting', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchMock = vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { status: 'dispatched', recoverable: false, reason: 'not_ready' } })))
    const pending = expect(callImageApi({ ...options, recoverOnly: true, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', imageResultRecovery: true })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    expect(vi.getTimerCount()).toBe(0)
  })
})
