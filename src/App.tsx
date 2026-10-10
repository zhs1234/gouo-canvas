import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import Workspace from './components/Workspace'
import { initStore } from './store'
import { useStore } from './store'
import { activateFirstImportedProfile, buildSettingsFromUrlParams, clearUrlSettingParams, getUrlSettingsEndpointChange, hasUrlSettingParams, keepActiveUrlProfile } from './lib/urlSettings'
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

    const applyUrlSettings = (baseSettings: AppSettings) => {
      const state = useStore.getState()
      const nextSettings = buildSettingsFromUrlParams(baseSettings, searchParams)
      if (!Object.keys(nextSettings).length) {
        if (baseSettings !== state.settings) state.setSettings(baseSettings)
        return
      }
      const target = getUrlSettingsEndpointChange(baseSettings, nextSettings)
      if (!target) {
        state.setSettings(nextSettings)
        return
      }
      // 链接参数会把之后的提示词和参考图发往另一个地址，先让用户确认；不确认时只导入配置、不切换
      state.setSettings(keepActiveUrlProfile(baseSettings, nextSettings))
      state.setConfirmDialog({
        title: '切换到链接中的服务地址？',
        message: `打开的链接要求把图片服务切换到 ${target}，之后的提示词和参考图都会发送到这个地址。只在信任链接来源时切换；不切换时链接中的配置仍会导入，可稍后在设置中手动选择。`,
        confirmText: '切换',
        cancelText: '不切换',
        tone: 'warning',
        action: () => useStore.getState().setSettings(nextSettings),
      })
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
          applyUrlSettings(baseSettings)
          clearAppliedUrlSettings()
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
          applyUrlSettings(useStore.getState().settings)
          clearAppliedUrlSettings()
        })

      void initStore().then(() => startServerLibrary())
      return
    }

    applyUrlSettings(useStore.getState().settings)

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
