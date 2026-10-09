import { createFalClient } from '@fal-ai/client'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_FAL_BASE_URL, DEFAULT_SETTINGS } from './apiProfiles'
import { callFalAiImageApi, getFalQueuedImageResult } from './falAiImageApi'

const falMock = vi.hoisted(() => ({
  subscribe: vi.fn(),
  subscribeToStatus: vi.fn(),
  result: vi.fn(),
}))
vi.mock('@fal-ai/client', () => ({
  createFalClient: vi.fn((config: { credentials: string }) => ({
    subscribe: falMock.subscribe,
    queue: {
      subscribeToStatus: (...args: unknown[]) => falMock.subscribeToStatus(config.credentials, ...args),
      result: (...args: unknown[]) => falMock.result(config.credentials, ...args),
    },
  })),
}))
const createFalClientMock = createFalClient as unknown as Mock

describe('callFalAiImageApi', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('uses the default fal endpoint without proxyUrl', async () => {
    falMock.subscribe.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({ apiKey: 'fal-key', baseUrl: DEFAULT_FAL_BASE_URL }))

    expect(createFalClientMock).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
    })
  })

  it('passes custom fal API URL to the SDK proxyUrl option', async () => {
    falMock.subscribe.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({
      apiKey: 'fal-key',
      baseUrl: 'https://fal-proxy.example.com/api/fal/',
    }))

    expect(createFalClientMock).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      proxyUrl: 'https://fal-proxy.example.com/api/fal',
    })
  })

  it('fetches each recovered result with the profile that submitted it', async () => {
    let releaseA!: () => void
    falMock.subscribeToStatus.mockImplementation((key: string) => key === 'key-a' ? new Promise<void>((resolve) => { releaseA = resolve }) : Promise.resolve())
    falMock.result.mockImplementation(async (key: string) => ({ data: { images: [{ b64_json: key === 'key-a' ? 'YQ==' : 'Yg==' }] } }))
    const profileA = createDefaultFalProfile({ apiKey: 'key-a', baseUrl: DEFAULT_FAL_BASE_URL })
    const profileB = createDefaultFalProfile({ apiKey: 'key-b', baseUrl: 'https://fal-proxy.example.com/api/fal' })
    const recoveringA = getFalQueuedImageResult(profileA, 'openai/gpt-image-2', 'req-a', { ...DEFAULT_PARAMS })
    // A 还在等待状态时，B 开始恢复
    await getFalQueuedImageResult(profileB, 'openai/gpt-image-2', 'req-b', { ...DEFAULT_PARAMS })
    releaseA()
    await recoveringA
    expect(falMock.result).toHaveBeenCalledWith('key-a', 'openai/gpt-image-2', { requestId: 'req-a' })
    expect(falMock.result).toHaveBeenCalledWith('key-b', 'openai/gpt-image-2', { requestId: 'req-b' })
  })
})
