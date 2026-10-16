import { flushSync } from 'react-dom'
import { create } from 'zustand'
import type { CanvasColorTheme } from './theme'

const CANVAS_SIDE_PANEL_MIN_WIDTH = 220
const CANVAS_SIDE_PANEL_MAX_WIDTH = 480
// 与 canvas.css 的断点一致：窄屏下资源面板是覆盖画布的抽屉
export const CANVAS_DRAWER_QUERY = '(max-width: 900px)'

// 画布和整个创作空间共用一套明暗主题，默认浅色，记在本机；index.html 首屏前按同一个键切换 html.dark，避免闪烁
const THEME_STORAGE_KEY = 'gouo-theme'

function readStoredTheme(): CanvasColorTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(theme: CanvasColorTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#faf8f3')
}

// origin 是触发切换的位置（如按钮中心），新主题从这里以圆形扩散；不支持视图过渡或用户要求减少动态效果时直接切换
export const useThemeStore = create<{ theme: CanvasColorTheme; setTheme: (theme: CanvasColorTheme, origin?: { x: number; y: number }) => void }>((set) => ({
  theme: typeof window === 'undefined' ? 'light' : readStoredTheme(),
  setTheme: (theme, origin) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch (err) {
      console.warn('保存主题失败', err)
    }
    const update = () => flushSync(() => {
      applyTheme(theme)
      set({ theme })
    })
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update()
      return
    }
    const x = origin?.x ?? window.innerWidth / 2
    const y = origin?.y ?? window.innerHeight / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    document.startViewTransition(update).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    }).catch((err) => console.warn('主题切换动画失败', err))
  },
}))

export const useCanvasSidePanelStore = create<{
  width: number
  panelOpen: boolean
  setWidth: (width: number) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
}>((set) => ({
  width: 280,
  panelOpen: typeof window === 'undefined' || !window.matchMedia(CANVAS_DRAWER_QUERY).matches,
  setWidth: (width) => set({ width: Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, width)) }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
}))
