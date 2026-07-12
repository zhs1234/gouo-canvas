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
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('accepts successful register responses that contain no data field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, message: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { register } = await import('./gouoBackend')

    await expect(register({ username: 'creator', password: 'password123' })).resolves.toBeUndefined()
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
})
