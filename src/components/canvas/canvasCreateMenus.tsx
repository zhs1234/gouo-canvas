// 基于 basketikun/infinite-canvas (MIT)，来源及适配说明见 UPSTREAM.md。
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../../lib/canvas/i18n'

import { canvasThemes } from '../../lib/canvas/theme'
import { useThemeStore } from '../../lib/canvas/uiStore'
import { NODE_DEFINITIONS } from '../../lib/canvas/nodeRegistry'
import type { Position } from '../../lib/canvas/types'

function ConnectionCreateOption({
  theme,
  icon,
  title,
  description,
  onClick,
}: {
  theme: (typeof canvasThemes)[keyof typeof canvasThemes]
  icon: React.ReactNode
  title: string
  description?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
      style={{ color: theme.node.text }}
      onClick={onClick}
      onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
      onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
        {description ? (
          <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  )
}

export function NodeCreateMenu({ position, onCreate, onClose }: { position: Position; onCreate: (type: string) => void; onClose: () => void }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)]
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  // Close automatically when clicking outside the menu.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [onClose])
  return (
    <div
      ref={menuRef}
      className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
      data-canvas-no-zoom
      style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
          {t('canvas.createMenu.select')}
        </span>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100"
          onClick={onClose}
          aria-label={t('canvas.createMenu.close')}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-1">
        {NODE_DEFINITIONS.map((def) => (
          <ConnectionCreateOption
            key={def.type}
            theme={theme}
            icon={def.icon}
            title={def.title}
            description={def.description}
            onClick={() => onCreate(def.type)}
          />
        ))}
      </div>
    </div>
  )
}
