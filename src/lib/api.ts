import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { createBackendSettings, isBackendAuthEnabled, isInvalidBackendTokenError } from './gouoBackend'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const backendSettings = isBackendAuthEnabled() ? await createBackendSettings() : null
  const settings = backendSettings ? { ...opts.settings, ...backendSettings } : opts.settings
  const profile = { ...getActiveApiProfile(settings), ...(backendSettings ? { provider: 'openai' as const } : {}) }
  if (profile.provider === 'fal') {
    const { callFalAiImageApi } = await import('./falAiImageApi')
    return callFalAiImageApi(opts, profile)
  }

  try {
    return await callOpenAICompatibleImageApi({ ...opts, settings }, profile, backendSettings ? null : getCustomProviderDefinition(settings, profile.provider))
  } catch (error) {
    if (backendSettings && error instanceof Error && error.message.includes('模型价格或能力已更新') && typeof window !== 'undefined') window.dispatchEvent(new Event('gouo-models-refresh'))
    if (!backendSettings || !isInvalidBackendTokenError(error)) throw error
    const refreshedSettings = { ...opts.settings, ...await createBackendSettings(true) }
    const refreshedProfile = { ...getActiveApiProfile(refreshedSettings), provider: 'openai' as const }
    return callOpenAICompatibleImageApi({ ...opts, settings: refreshedSettings }, refreshedProfile)
  }
}
