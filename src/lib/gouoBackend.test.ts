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

  it('turns a playground token into the active image API settings', async () => {
    vi.stubEnv('VITE_GOUO_IMAGE_MODEL', 'gpt-image-2')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 'user-token' }))
    vi.stubGlobal('fetch', fetchMock)
    const { createBackendSettings } = await import('./gouoBackend')

    await expect(createBackendSettings()).resolves.toMatchObject({
      baseUrl: '/v1',
      apiKey: 'user-token',
      model: 'gpt-image-2',
      apiMode: 'images',
      streamImages: false,
    })
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
