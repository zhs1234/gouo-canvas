import { lazy, Suspense, useEffect, useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { BRAND } from '../config/brand'
import { isBackendAuthEnabled } from '../lib/gouoBackend'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import type { UserCenterSection } from '../lib/userGuidance'
import ViewportTooltip from './ViewportTooltip'
import { useFavoriteCollectionTitle } from './favorites/useFavoriteCollectionTitle'
import { HelpCircleIcon, InstallIcon, SettingsIcon, SparklesIcon, UserIcon } from './icons'

const HelpModal = lazy(() => import('./HelpModal'))
const InspirationLibraryModal = lazy(() => import('./InspirationLibraryModal'))
const UserCenterModal = lazy(() => import('./UserCenterModal'))

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = Boolean(activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [showInspiration, setShowInspiration] = useState(false)
  const [showUserCenter, setShowUserCenter] = useState(false)
  const [userCenterSection, setUserCenterSection] = useState<UserCenterSection>('overview')

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const inspirationTooltip = useTooltip()
  const userCenterTooltip = useTooltip()

  useEffect(() => {
    const openUserCenter = (event: Event) => {
      setUserCenterSection((event as CustomEvent<UserCenterSection>).detail || 'overview')
      setShowUserCenter(true)
    }
    window.addEventListener('gouo:open-user-center', openUserCenter)
    return () => window.removeEventListener('gouo:open-user-center', openUserCenter)
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: '安装为应用',
          message: '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: '安装为应用',
          message: '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  return (
    <>
      <header data-no-drag-select className="safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]">
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <h1 className="inline-flex min-w-0 items-start relative mr-2">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <span className="hidden items-center gap-2 text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:inline-flex">
                    <img src={BRAND.logoUrl} alt="" className="h-7 w-7 object-contain" />
                    {BRAND.name}
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-2 text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:text-lg">
                  <img src={BRAND.logoUrl} alt="" className="h-7 w-7 object-contain" />
                  {BRAND.name}
                  <span className="hidden text-xs font-medium tracking-normal text-gray-400 md:inline">{BRAND.nameEn}</span>
                </span>
              )}
            </h1>
          </div>
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <div className="flex items-center gap-1 shrink-0">
            <div className="relative" {...inspirationTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowInspiration(true)
                }}
                className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-gray-600 transition hover:bg-blue-50 hover:text-blue-600 dark:text-gray-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 sm:px-2.5"
                aria-label="打开灵感库"
              >
                <SparklesIcon className="h-5 w-5" />
                <span className="hidden text-sm font-medium lg:inline">灵感</span>
              </button>
              <ViewportTooltip visible={inspirationTooltip.visible} className="whitespace-nowrap">灵感库</ViewportTooltip>
            </div>
            {isBackendAuthEnabled() && (
              <div className="relative" {...userCenterTooltip.handlers}>
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    setUserCenterSection('overview')
                    setShowUserCenter(true)
                  }}
                  className="ml-1 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm shadow-blue-500/20 transition hover:brightness-110"
                  aria-label="用户中心"
                >
                  <UserIcon className="h-5 w-5" />
                </button>
                <ViewportTooltip visible={userCenterTooltip.visible} className="whitespace-nowrap">
                  用户中心
                </ViewportTooltip>
              </div>
            )}
            {!isPwaInstalled && (
              <div
                className="relative"
                {...installTooltip.handlers}
              >
                <button
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                  aria-label="安装为应用"
                >
                  <InstallIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
      </header>
      
      <div className="safe-area-top invisible pointer-events-none" aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
      <Suspense fallback={null}>
        {showHelp && <HelpModal isFavoriteCollectionOverview={filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
        {showInspiration && <InspirationLibraryModal onClose={() => setShowInspiration(false)} />}
        {showUserCenter && <UserCenterModal initialSection={userCenterSection} onClose={() => setShowUserCenter(false)} />}
      </Suspense>
    </>
  )
}
