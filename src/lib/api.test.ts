import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callImageApi } from './api'

describe('callImageApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the task model and quoted price when refreshing a backend token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'old-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'new-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 }))
    const { createBackendSettings, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()
    await createBackendSettings(true)
    await callImageApi({ model: 'image-selected', prompt: '图片', params: { ...DEFAULT_PARAMS }, inputImageDataUrls: [], gouoPriceVersion: 'price-snapshot' })
    for (const idx of [1, 3]) {
      const init = fetchMock.mock.calls[idx][1] as RequestInit
      expect(JSON.parse(String(init.body)).model).toBe('image-selected')
      expect(init.headers).toMatchObject({ 'X-Gouo-Price-Version': 'price-snapshot' })
    }
    expect(fetchMock.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer new-token' })
  })

  it('starts product image requests concurrently with separate IDs and unchanged quality', async () => {
    const requests: Array<{ init: RequestInit; resolve: (response: Response) => void }> = []
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'product-token' }), { status: 200 }))
      .mockImplementation((_url, init) => new Promise<Response>((resolve) => requests.push({ init: init!, resolve })))
    const { createBackendSettings, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()
    await createBackendSettings(true)
    const pending = callImageApi({
      model: 'gpt-image-2',
      prompt: '原始提示词', params: { ...DEFAULT_PARAMS, n: 2, quality: 'high' }, inputImageDataUrls: [],
      requestId: 'batch-task', gouoPriceVersion: 'price-snapshot',
    })
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    for (const [idx, request] of requests.entries()) {
      const body = JSON.parse(String(request.init.body))
      expect(body).toMatchObject({ model: 'gpt-image-2', prompt: '原始提示词', quality: 'high' })
      expect(body.n ?? 1).toBe(1)
      expect(body.stream).toBeUndefined()
      expect(request.init.headers).toMatchObject({ 'X-Gouo-Request-Id': `batch-task:${idx}`, 'X-Gouo-Price-Version': 'price-snapshot' })
    }
    requests[1].resolve(new Response(JSON.stringify({ data: [{ b64_json: 'c2Vjb25k' }] }), { status: 200 }))
    requests[0].resolve(new Response(JSON.stringify({ data: [{ b64_json: 'Zmlyc3Q=' }] }), { status: 200 }))
    await expect(pending).resolves.toMatchObject({ images: ['data:image/png;base64,Zmlyc3Q=', 'data:image/png;base64,c2Vjb25k'], actualParams: { n: 2 } })
  })

  it('keeps product edit references, masks and successful outputs when one request fails', async () => {
    const canvasImage = await import('./canvasImage')
    const target = vi.spyOn(canvasImage, 'imageDataUrlToPngBlob').mockResolvedValue(new Blob(['target'], { type: 'image/png' }))
    const reference = vi.spyOn(canvasImage, 'dataUrlToBlob').mockResolvedValue(new Blob(['reference'], { type: 'image/png' }))
    const mask = vi.spyOn(canvasImage, 'maskDataUrlToPngBlob').mockResolvedValue(new Blob(['mask'], { type: 'image/png' }))
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'product-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '生成失败' } }), { status: 400 }))
    const { createBackendSettings, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()
    await createBackendSettings(true)
    const result = await callImageApi({
      model: 'gpt-image-2',
      prompt: '局部编辑', params: { ...DEFAULT_PARAMS, n: 2, quality: 'medium' },
      inputImageDataUrls: ['target-url', 'reference-url'], maskDataUrl: 'mask-url',
      requestId: 'masked-batch', gouoPriceVersion: 'price-snapshot',
    })
    expect(target).toHaveBeenCalledTimes(2)
    expect(target).toHaveBeenCalledWith('target-url')
    expect(reference).toHaveBeenCalledTimes(2)
    expect(reference).toHaveBeenCalledWith('reference-url')
    expect(mask).toHaveBeenCalledTimes(2)
    expect(mask).toHaveBeenCalledWith('mask-url')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [idx, [url, init]] of fetchMock.mock.calls.slice(1).entries()) {
      expect(String(url)).toContain('/images/edits')
      const form = init!.body as FormData
      expect(form.get('quality')).toBe('medium')
      expect(Number(form.get('n') || 1)).toBe(1)
      expect(form.get('prompt')).toBe('局部编辑')
      expect(await Promise.all((form.getAll('image[]') as Blob[]).map((blob) => blob.text()))).toEqual(['target', 'reference'])
      expect(await (form.get('mask') as Blob).text()).toBe('mask')
      expect(init!.headers).toMatchObject({ 'X-Gouo-Request-Id': `masked-batch:${idx}`, 'X-Gouo-Price-Version': 'price-snapshot' })
    }
    expect(result.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(result.actualParams).toMatchObject({ n: 1 })
    expect(result.failedRequests).toEqual([{ requestIndex: 1, error: '生成失败' }])
  })

  it('preserves product child request IDs when refreshing an expired token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'old-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: 'new-token' }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), { status: 200 }))
    const { createBackendSettings, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()
    await createBackendSettings(true)
    const result = await callImageApi({
      model: 'gpt-image-2',
      prompt: '图片', params: { ...DEFAULT_PARAMS, n: 2, quality: 'high' }, inputImageDataUrls: [],
      requestId: 'refresh-batch', gouoPriceVersion: 'price-snapshot',
    })
    expect(fetchMock).toHaveBeenCalledTimes(6)
    for (const [idx, callIdx] of [1, 2, 4, 5].entries()) {
      const init = fetchMock.mock.calls[callIdx][1]!
      expect(init.headers).toMatchObject({ 'X-Gouo-Request-Id': `refresh-batch:${idx % 2}`, 'X-Gouo-Price-Version': 'price-snapshot', Authorization: `Bearer ${idx < 2 ? 'old-token' : 'new-token'}` })
      const body = JSON.parse(String(init.body))
      expect(body.n ?? 1).toBe(1)
      expect(body.quality).toBe('high')
    }
    expect(result.images).toHaveLength(2)
  })
})
