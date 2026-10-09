import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import Workspace from './components/Workspace'
import { initStore } from './store'
import { useStore } from './store'
import { activateFirstImportedProfile, buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { isDefaultConfigOnlyEnabled, mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import type { AppSettings } from './types'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import OverlayLayer from './components/OverlayLayer'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { startServerLibrary } from './lib/serverLibrary'
import FirstGenerationGuide from './components/FirstGenerationGuide'
import { GUIDE_FLAGS, hasGuideFlag } from './lib/userGuidance'

const OnboardingModal = lazy(() => import('./components/OnboardingModal'))

let customProviderConfigUrlImportStarted = false

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(() => !hasGuideFlag(GUIDE_FLAGS.onboarding))
  const setSettings = useStore((s) => s.setSettings)
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const defaultConfigOnly = isDefaultConfigOnlyEnabled()

    const applyUrlSettings = (baseSettings: Partial<AppSettings>) => {
      const nextSettings = buildSettingsFromUrlParams(baseSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : baseSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    if (customProviderConfigUrl && defaultConfigOnly && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          const state = useStore.getState()
          const baseSettings = importedSettings
            ? activateFirstImportedProfile(mergeImportedSettings(state.settings, importedSettings), importedSettings)
            : state.settings
          state.setSettings(applyUrlSettings(baseSettings))
          clearAppliedUrlSettings()
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
          const state = useStore.getState()
          state.setSettings(applyUrlSettings(state.settings))
          clearAppliedUrlSettings()
        })

      void initStore().then(() => startServerLibrary())
      return
    }

    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    clearAppliedUrlSettings()

    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    void initStore().then(() => startServerLibrary())
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img') && !(e.target as HTMLElement).closest('.canvas-workspace')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <HashRouter><Workspace /></HashRouter>
      <OverlayLayer />
      <Toast />
      <ImageContextMenu />
      <FirstGenerationGuide />
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingModal onClose={() => setShowOnboarding(false)} />
        </Suspense>
      )}
    </>
  )
}
