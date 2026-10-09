import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('gouoBackend', () => {
  it('sends Turnstile tokens on all protected account actions without changing unprotected payloads', async () => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ success: true })))
    vi.stubGlobal('fetch', request)
    const { register, sendEmailVerification, sendPasswordReset } = await import('./gouoBackend')
    await register({ username: 'creator', password: 'password123', turnstileToken: 'test+token&value' })
    await sendEmailVerification('a@example.invalid', 'test+token&value')
    await sendPasswordReset('a@example.invalid', 'test+token&value')
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      '/api/user/register?turnstile=test%2Btoken%26value',
      '/api/verification?email=a%40example.invalid&turnstile=test%2Btoken%26value',
      '/api/reset_password?email=a%40example.invalid&turnstile=test%2Btoken%26value',
    ])
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('turnstileToken')
  })

  it('surfaces a rate-limited account action without promising automatic submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '10' } })))
    const { redeemCode, GouoRateLimitError } = await import('./gouoBackend')
    const error = await redeemCode('local-test').catch((err) => err)
    expect(error).toBeInstanceOf(GouoRateLimitError)
    expect(error.message).toBe('请求过于频繁，请稍后重试')
  })

  it('honors Retry-After even when the rate limiter returns an empty body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '180' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { getCloudSync, fetchCloudAssetContent, GouoRateLimitError } = await import('./gouoBackend')
    const start = Date.now()
    for (const request of [() => getCloudSync(), () => fetchCloudAssetContent({ id: 'asset', sha256: '', mime_type: 'image/png', file_size: 0, content_url: '/api/gouo/assets/asset/content' })]) {
      const error = await request().catch((err) => err)
      expect(error).toBeInstanceOf(GouoRateLimitError)
      expect(error.retryAt).toBeGreaterThanOrEqual(start + 180000)
    }
  })

  it('uses the One Hub session login endpoint with credentials', async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_URL', 'https://api.gouo.example/')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: { id: 7, username: 'creator' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { login } = await import('./gouoBackend')

    await expect(login('creator', 'password123')).resolves.toMatchObject({ id: 7 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.gouo.example/api/user/login',
      expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'include' }),
    )
  })

  it('accepts successful register responses that contain no data field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, message: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { register } = await import('./gouoBackend')

    await expect(register({ username: 'creator', password: 'password123' })).resolves.toBeUndefined()
  })

  it('requests a registration verification code for the encoded email address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, message: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { sendEmailVerification } = await import('./gouoBackend')

    await expect(sendEmailVerification('creator+test@example.com')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/verification?email=creator%2Btest%40example.com',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('updates the display name and logs out through the session API', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ success: true, message: '' })))
    vi.stubGlobal('fetch', fetchMock)
    const { logout, updateCurrentUser } = await import('./gouoBackend')

    await expect(updateCurrentUser('光构创作者')).resolves.toBeUndefined()
    await expect(logout()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/user/self',
      expect.objectContaining({ method: 'PUT', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/user/logout',
      expect.objectContaining({ method: 'GET', cache: 'no-store', credentials: 'include' }),
    )
  })

  it('keeps recharge and usage history inside the Gouo user center', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 5000 }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { data: [{ created_at: 100, type: 2, quota: 120 }], page: 1, size: 10, total_count: 1 },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const { getUsageLogs, redeemCode } = await import('./gouoBackend')

    await expect(redeemCode('GOUO-CODE')).resolves.toBe(5000)
    await expect(getUsageLogs()).resolves.toMatchObject({ total_count: 1 })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/user/topup',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/log/self?page=1&size=20&order=-created_at',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('refreshes backend authentication without replacing the selected model', async () => {
    vi.stubEnv('VITE_GOUO_IMAGE_MODEL', 'gpt-image-2')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 'user-token' }))
    vi.stubGlobal('fetch', fetchMock)
    const { createBackendSettings } = await import('./gouoBackend')

    await expect(createBackendSettings()).resolves.toMatchObject({
      baseUrl: '/v1',
      apiKey: 'user-token',
      apiMode: 'images',
      streamImages: false,
    })
    expect(await createBackendSettings()).not.toHaveProperty('model')
  })

  it('validates model capabilities, availability and the displayed quote while allowing batches of single-image requests', async () => {
    const model = { id: 'image-b', name: '图片 B', price_cny: 0.2, price_version: 'version-b', reference: false, mask: false, max_outputs: 1, quota: 100 }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(jsonResponse({ success: true, data: url.includes('/token/') ? 'user-token' : [model] }))))
    const { getImageModelQuote, GouoPriceChangedError } = await import('./gouoBackend')
    await expect(getImageModelQuote('image-b', 0, false, 2, 'version-b')).resolves.toEqual(model)
    await expect(getImageModelQuote('image-b', 0, false, 10, 'version-b')).resolves.toEqual(model)
    await expect(getImageModelQuote('image-b', 1, false, 1, 'version-b')).rejects.toThrow('不支持当前编辑')
    await expect(getImageModelQuote('image-b', 0, true, 1, 'version-b')).rejects.toThrow('不支持当前编辑')
    for (const n of [0, -1, 11, 1.5, NaN, Infinity]) {
      await expect(getImageModelQuote('image-b', 0, false, n, 'version-b')).rejects.toThrow('图片总数量必须为 1 到 10 的整数')
    }
    await expect(getImageModelQuote('image-gone', 0, false, 1, 'version-b')).rejects.toThrow('已不可用')
    await expect(getImageModelQuote('image-b', 0, false, 1, 'old-price')).rejects.toBeInstanceOf(GouoPriceChangedError)
  })

  it.each([0, -1, 1.5])('rejects a catalog that cannot support one image per request with max_outputs %s', async (maxOutputs) => {
    const model = { id: 'image-b', name: '图片 B', price_cny: 0.2, price_version: 'version-b', reference: true, mask: true, max_outputs: maxOutputs, quota: 100 }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(jsonResponse({ success: true, data: url.includes('/token/') ? 'user-token' : [model] }))))
    const { getImageModelQuote } = await import('./gouoBackend')
    await expect(getImageModelQuote('image-b', 0, false, 2, 'version-b')).rejects.toThrow('图片模型目录格式无效')
  })

  it('refreshes an expired catalog token once without selecting a different model', async () => {
    const model = { id: 'image-b', name: '图片 B', price_cny: 0.2, price_version: 'version-b', reference: false, mask: false, max_outputs: 2, quota: 100 }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'old-token' }))
      .mockResolvedValueOnce(jsonResponse({ success: false, message: '图片令牌无效，请重新登录' }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'new-token' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [model] }))
    vi.stubGlobal('fetch', fetchMock)
    const { getImageModels } = await import('./gouoBackend')
    await expect(getImageModels()).resolves.toEqual([model])
    expect(fetchMock.mock.calls[3][1].headers).toMatchObject({ 'X-Gouo-Token': 'new-token' })
  })

  it('surfaces backend business errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      message: '额度不足',
    })))
    const { getPlaygroundToken } = await import('./gouoBackend')

    await expect(getPlaygroundToken()).rejects.toThrow('额度不足')
  })

  it('recognizes backend token failures without treating unrelated errors as authentication failures', async () => {
    const { isInvalidBackendTokenError } = await import('./gouoBackend')

    expect(isInvalidBackendTokenError(new Error('无效的令牌'))).toBe(true)
    expect(isInvalidBackendTokenError(new Error('HTTP 401'))).toBe(true)
    expect(isInvalidBackendTokenError(new Error('Provider API error: token expired'))).toBe(true)
    expect(isInvalidBackendTokenError(new Error('额度不足'))).toBe(false)
  })

  it('uploads cloud assets with the authenticated session and client image id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: { id: 'asset-1', sha256: 'abc', mime_type: 'image/png', file_size: 3, content_url: '/api/gouo/assets/asset-1/content' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { uploadCloudAsset } = await import('./gouoBackend')

    await expect(uploadCloudAsset(new Blob(['abc'], { type: 'image/png' }), 'image-1', 'abc')).resolves.toMatchObject({ id: 'asset-1' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gouo/assets')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect((init.body as FormData).get('client_image_id')).toBe('image-1')
  })
})
