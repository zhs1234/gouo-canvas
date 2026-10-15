import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.doUnmock('./storageScope')
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('gouoBackend', () => {
  it('uses the backend default model unless the user picked a model that is still available', async () => {
    const { resolveBackendModel } = await import('./gouoBackend')
    const model = (id: string, isDefault = false) => ({ id, name: id, price_cny: 0.1, price_version: id, reference: true, mask: true, max_outputs: 1, quota: 1, ...(isDefault ? { default: true } : {}) })
    const catalog = [model('image-a'), model('image-b', true)]
    // 构建时的默认模型不在目录里：改用后台默认
    expect(resolveBackendModel(catalog, 'gpt-image-2', false)?.id).toBe('image-b')
    // 没手动选过：后台改默认模型后跟着变
    expect(resolveBackendModel(catalog, 'image-a', false)?.id).toBe('image-b')
    // 手动选过且仍可用：保留
    expect(resolveBackendModel(catalog, 'image-a', true)?.id).toBe('image-a')
    // 手动选的已下架：回到后台默认
    expect(resolveBackendModel(catalog, 'removed', true)?.id).toBe('image-b')
    // 旧后端没有 default 标记：取第一个
    expect(resolveBackendModel([model('image-a'), model('image-b')], 'gpt-image-2', false)?.id).toBe('image-a')
    expect(resolveBackendModel([], 'gpt-image-2', false)).toBeUndefined()
  })

  it('refreshes the session once, sends the bearer token on cloud requests and reloads when another page switched accounts', async () => {
    let loadedUser = '7'
    vi.doMock('./storageScope', () => ({ getLoadedStorageUserId: () => loadedUser }))
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    const session = (id: number, expires: number) => jsonResponse({ success: true, data: { access_token: `access-${id}`, access_expires_at: expires, user: { id } } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(session(7, Date.now() / 1000 + 30))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { used_bytes: 0 } }))
      .mockResolvedValueOnce(session(7, Date.now() / 1000 + 3600))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'asset' } }))
      .mockResolvedValueOnce(new Response('png', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { getCloudStorage, uploadCloudAsset, fetchCloudAssetContent } = await import('./gouoBackend')
    await getCloudStorage()
    // 第一次拿到的 access token 不到一分钟就过期，下次请求前先换新
    await uploadCloudAsset(new Blob(['abc'], { type: 'image/png' }), 'image-1', 'abc')
    await fetchCloudAssetContent({ id: 'asset', sha256: '', mime_type: 'image/png', file_size: 0, content_url: '/api/gouo/assets/asset/content' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/user/auth/refresh', '/api/gouo/storage', '/api/user/auth/refresh', '/api/gouo/assets', '/api/gouo/assets/asset/content'])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer access-7' })
    expect(fetchMock.mock.calls[4][1].headers).toMatchObject({ Authorization: 'Bearer access-7' })

    // 服务端判定 access token 失效时换新一次；换来的是另一个账号说明其他页面切换了账号
    loadedUser = '8'
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, message: 'expired' }, 401)).mockResolvedValueOnce(session(7, Date.now() / 1000 + 3600))
    const error = await getCloudStorage().catch((err) => err)
    expect(error.message).toContain('其他页面切换')
    expect(reload).toHaveBeenCalledOnce()
  })

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
    const { listCloudTasks, fetchCloudAssetContent, GouoRateLimitError } = await import('./gouoBackend')
    const start = Date.now()
    for (const request of [() => listCloudTasks(false), () => fetchCloudAssetContent({ id: 'asset', sha256: '', mime_type: 'image/png', file_size: 0, content_url: '/api/gouo/assets/asset/content' })]) {
      const error = await request().catch((err) => err)
      expect(error).toBeInstanceOf(GouoRateLimitError)
      expect(error.retryAt).toBeGreaterThanOrEqual(start + 180000)
    }
  })

  it('logs in through New API, keeps the access token for later requests and translates server messages', async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_URL', 'https://api.gouo.example/')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { access_token: 'access-7', access_expires_at: Date.now() / 1000 + 900, user: { id: 7, username: 'creator' } } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 'relay-key' }))
      .mockResolvedValueOnce(jsonResponse({ success: false, message: 'Username or password is incorrect, or user has been banned', message_key: 'Username or password is incorrect, or user has been banned' }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { require_verification: true, flow_token: 'flow' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { login, getPlaygroundToken } = await import('./gouoBackend')

    await expect(login('creator', 'password123', 'turnstile+token')).resolves.toMatchObject({ id: 7 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.gouo.example/api/user/login?turnstile=turnstile%2Btoken',
      expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'include' }),
    )
    await expect(getPlaygroundToken()).resolves.toBe('relay-key')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.gouo.example/api/gouo/token')
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer access-7' })
    await expect(login('creator', 'wrong')).rejects.toThrow('用户名或密码错误，或用户已被封禁')
    await expect(login('creator', 'password123')).rejects.toThrow('二次验证')
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
    const { logout, updateCurrentUser, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()

    await expect(updateCurrentUser('光构创作者')).resolves.toBeUndefined()
    await expect(logout()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/user/self',
      expect.objectContaining({ method: 'PUT', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/user/auth/logout',
      expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'include' }),
    )
  })

  it('keeps recharge and usage history inside the Gouo user center', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: 5000 }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { items: [{ created_at: 100, type: 2, quota: 120, use_time: 3, request_id: 'req', other: '{"billing_unit":"successful_request","price_cny":0.1}' }], page: 1, page_size: 20, total: 1 },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const { getUsageLogs, redeemCode, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()

    await expect(redeemCode('GOUO-CODE')).resolves.toBe(5000)
    await expect(getUsageLogs()).resolves.toEqual({
      total_count: 1,
      data: [{ created_at: 100, type: 2, quota: 120, request_time: 3000, content: undefined, model_name: undefined, metadata: { billing_unit: 'successful_request', price_cny: 0.1, request_id: 'req' } }],
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/user/topup',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/log/self?p=1&page_size=20',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('refreshes backend authentication without replacing the selected model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 'user-token' }))
    vi.stubGlobal('fetch', fetchMock)
    const { createBackendSettings, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()

    await expect(createBackendSettings()).resolves.toEqual({ baseUrl: '/v1', apiKey: 'user-token' })
    expect(await createBackendSettings()).not.toHaveProperty('model')
  })

  it('validates model capabilities, availability and the displayed quote while allowing batches of single-image requests', async () => {
    const model = { id: 'image-b', name: '图片 B', price_cny: 0.2, price_version: 'version-b', reference: false, mask: false, max_outputs: 1, quota: 100 }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ success: true, data: [model] }))))
    const { getImageModelQuote, GouoPriceChangedError, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()
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
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ success: true, data: [model] }))))
    const { getImageModelQuote, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()
    await expect(getImageModelQuote('image-b', 0, false, 2, 'version-b')).rejects.toThrow('图片模型目录格式无效')
  })

  it('treats a missing refresh session as signed out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: false, message: 'refresh token invalid' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const { getImageModels } = await import('./gouoBackend')
    await expect(getImageModels()).rejects.toThrow('未登录')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/user/auth/refresh'])
  })

  it('proves the current password before changing it or binding an email, and keeps the rotated session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { proof_token: 'proof-1' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { access_token: 'rotated', access_expires_at: Date.now() / 1000 + 900 } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { proof_token: 'proof-2' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { flow_token: 'flow', old_email_required: false } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { notification_warning: false } }))
    vi.stubGlobal('fetch', fetchMock)
    const { updatePassword, startEmailBind, bindEmail, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()

    await updatePassword('old-password', 'new-password')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/verify')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ method: 'password', scope: 'account.password.change', password: 'old-password' })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'X-Security-Proof': 'proof-1' } })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ password: 'new-password', original_password: 'old-password' })

    await expect(startEmailBind('a@example.invalid', 'new-password')).resolves.toEqual({ flow_token: 'flow', old_email_required: false })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ method: 'password', scope: 'account.binding.bind', password: 'new-password', context: { provider: 'email', email: 'a@example.invalid' } })
    // 改密码后用轮换得到的新 access token
    expect(fetchMock.mock.calls[2][1].headers).toMatchObject({ Authorization: 'Bearer rotated' })
    expect(fetchMock.mock.calls[3][1].headers).toMatchObject({ 'X-Security-Proof': 'proof-2' })
    await bindEmail('flow', '123456')
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ flow_token: 'flow', new_code: '123456', old_code: '' })
  })

  it('surfaces backend business errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      message: '额度不足',
    })))
    const { getPlaygroundToken, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()

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
    const { uploadCloudAsset, setBackendSessionForTests } = await import('./gouoBackend')
    setBackendSessionForTests()

    await expect(uploadCloudAsset(new Blob(['abc'], { type: 'image/png' }), 'image-1', 'abc')).resolves.toMatchObject({ id: 'asset-1' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock.mock.calls[0][0]).toBe('/api/gouo/assets')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect((init.body as FormData).get('client_image_id')).toBe('image-1')
  })

  it('checks image params against the limits the backend sets for the model', async () => {
    const { getImageParamIssue } = await import('./gouoBackend')
    const base = { id: 'image-a', name: 'A', price_cny: 0.1, price_version: 'v', reference: true, mask: false, max_outputs: 1, quota: 1 }
    const params = { size: '1024x1024', quality: 'medium' as const, moderation: 'auto' as const }
    // 开放全部档位、画质和张数不限时都放行；没有开放档位时只能用自动尺寸
    const open = { ...base, sizes: ['1K', '2K', '4K'] as const }
    expect(getImageParamIssue({ ...open, sizes: [...open.sizes] }, { ...params, size: '3840x2160', quality: 'high' }, 16)).toBe('')
    expect(getImageParamIssue(base, params, 0)).toContain('不支持该分辨率')
    expect(getImageParamIssue(base, { ...params, size: 'auto' }, 0)).toBe('')
    const limited = { ...base, sizes: ['1K' as const], qualities: ['low', 'medium'], max_inputs: 2 }
    expect(getImageParamIssue(limited, params, 2)).toBe('')
    expect(getImageParamIssue(limited, { ...params, size: 'auto' }, 0)).toBe('')
    expect(getImageParamIssue(limited, { ...params, size: '2048x2048' }, 0)).toContain('不支持该分辨率')
    // 只开放 2K 时，1K 档位的尺寸也不放行
    expect(getImageParamIssue({ ...base, sizes: ['2K' as const] }, params, 0)).toContain('不支持该分辨率')
    expect(getImageParamIssue({ ...base, sizes: ['2K' as const] }, { ...params, size: '2048x2048' }, 0)).toBe('')
    expect(getImageParamIssue(limited, { ...params, quality: 'high' }, 0)).toContain('不开放所选画质')
    // 自动画质可能被上游选成高画质，只开放部分画质时不放行
    expect(getImageParamIssue(limited, { ...params, quality: 'auto' }, 0)).toContain('不开放自动画质')
    expect(getImageParamIssue(limited, params, 3)).toContain('最多使用 2 张参考图')
    // 后台未开放宽松审核
    expect(getImageParamIssue(base, { ...params, size: 'auto', moderation: 'low' }, 0)).toBe('运营方未开放宽松审核')
  })
})
