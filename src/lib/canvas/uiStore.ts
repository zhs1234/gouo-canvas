import { create } from 'zustand'
import type { CanvasColorTheme } from './theme'

export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480

export const useThemeStore = create<{ theme: CanvasColorTheme; setTheme: (theme: CanvasColorTheme) => void }>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
}))

export const useCanvasSidePanelStore = create<{
  width: number
  panelOpen: boolean
  setWidth: (width: number) => void
  togglePanel: () => void
}>((set) => ({
  width: 280,
  panelOpen: typeof window === 'undefined' || window.innerWidth >= 768,
  setWidth: (width) => set({ width: Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, width)) }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
}))
