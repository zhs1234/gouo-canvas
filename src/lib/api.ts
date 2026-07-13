import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { createBackendSettings, isBackendAuthEnabled, isBackendSessionReady, isInvalidBackendTokenError } from './gouoBackend'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const backendSettings = isBackendAuthEnabled() && isBackendSessionReady() ? await createBackendSettings() : null
  const settings = backendSettings ? { ...opts.settings, ...backendSettings } : opts.settings
  const profile = getActiveApiProfile(settings)
  if (profile.provider === 'fal') {
    const { callFalAiImageApi } = await import('./falAiImageApi')
    return callFalAiImageApi(opts, profile)
  }

  try {
    return await callOpenAICompatibleImageApi({ ...opts, settings }, profile, getCustomProviderDefinition(settings, profile.provider))
  } catch (error) {
    if (!backendSettings || !isInvalidBackendTokenError(error)) throw error
    const refreshedSettings = { ...opts.settings, ...await createBackendSettings(true) }
    const refreshedProfile = getActiveApiProfile(refreshedSettings)
    return callOpenAICompatibleImageApi({ ...opts, settings: refreshedSettings }, refreshedProfile, getCustomProviderDefinition(refreshedSettings, refreshedProfile.provider))
  }
}
