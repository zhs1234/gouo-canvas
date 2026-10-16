// 基于 basketikun/infinite-canvas (MIT)，来源及适配说明见 UPSTREAM.md。
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Segmented, Switch } from 'antd'
import {
  CircleDot,
  Eraser,
  Grid2x2,
  Group,
  Hand,
  Image as ImageIcon,
  Info,
  Moon,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Redo2,
  Settings2,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Upload,
} from 'lucide-react'

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from '../../lib/canvas/theme'
import { useThemeStore } from '../../lib/canvas/uiStore'
import { useTranslation } from '../../lib/canvas/i18n'
import { useTooltip } from '../../hooks/useTooltip'
import ViewportTooltip from '../ViewportTooltip'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

export function CanvasToolbar({
  selectedCount,
  nodeCount,
  canvasTool,
  canUndo,
  canRedo,
  backgroundMode,
  showImageInfo,
  onAddImage,
  onAddText,
  onAddConfig,
  onAddGroup,
  onUndo,
  onRedo,
  onUpload,
  onDelete,
  onClear,
  onCanvasToolChange,
  onBackgroundModeChange,
  onShowImageInfoChange,
}: {
  selectedCount: number
  nodeCount: number
  canvasTool: 'select' | 'pan'
  canUndo: boolean
  canRedo: boolean
  backgroundMode: CanvasBackgroundMode
  showImageInfo: boolean
  onAddImage: () => void
  onAddText: () => void
  onAddConfig: () => void
  onAddGroup: () => void
  onUndo: () => void
  onRedo: () => void
  onUpload: () => void
  onDelete: () => void
  onClear: () => void
  onCanvasToolChange: (tool: 'select' | 'pan') => void
  onBackgroundModeChange: (mode: CanvasBackgroundMode) => void
  onShowImageInfoChange: (show: boolean) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const colorTheme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const theme = canvasThemes[colorTheme]
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [panelX, setPanelX] = useState(0)
  const dockStyle = {
    background: theme.toolbar.panel,
    borderColor: theme.toolbar.border,
    color: theme.toolbar.item,
    boxShadow: colorTheme === 'dark' ? '0 18px 45px rgba(0,0,0,.32)' : '0 16px 40px rgba(28,25,23,.12)',
  }

  // Close the canvas-appearance popover when clicking outside the toolbar and its panels.
  useEffect(() => {
    if (!appearanceOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setAppearanceOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [appearanceOpen])

  return (
    <div ref={rootRef} className="canvas-dock pointer-events-none absolute bottom-5 z-50 flex justify-center">
      <div
        ref={wrapRef}
        className="thin-scrollbar pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur max-sm:gap-0.5 max-sm:px-1.5 [&>*]:shrink-0"
        style={dockStyle}
      >
        <ToolbarButton
          label={t(`canvas.toolbar.${canvasTool}`)}
          shortcut="按住空格临时切换"
          active
          onClick={() => onCanvasToolChange(canvasTool === 'select' ? 'pan' : 'select')}
        >
          {canvasTool === 'select' ? <MousePointer2 className="size-[18px]" /> : <Hand className="size-[18px]" />}
        </ToolbarButton>
        <ToolbarButton label={t('canvas.undo')} shortcut={`${MOD} Z`} disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton label={t('canvas.redo')} shortcut={`${MOD} ⇧ Z`} disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="size-[18px]" />
        </ToolbarButton>
        <Divider theme={theme} />
        <ToolbarButton label={t('canvas.toolbar.text')} onClick={onAddText}>
          <Type className="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton label={t('canvas.toolbar.image')} onClick={onAddImage}>
          <ImageIcon className="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton label={t('canvas.toolbar.config')} onClick={onAddConfig}>
          <Settings2 className="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton label={t('canvas.toolbar.group')} onClick={onAddGroup}>
          <Group className="size-[18px]" />
        </ToolbarButton>
        <ToolbarButton label={t('canvas.toolbar.upload')} shortcut="也可拖入或粘贴图片" onClick={onUpload}>
          <Upload className="size-[18px]" />
        </ToolbarButton>
        <Divider theme={theme} />
        <ToolbarButton
          label={t('canvas.toolbar.appearance')}
          active={appearanceOpen}
          onClick={(event) => {
            setPanelX(getTipX(wrapRef.current, event.currentTarget))
            setAppearanceOpen((value) => !value)
          }}
        >
          <Palette className="size-[18px]" />
        </ToolbarButton>
        {selectedCount ? (
          <>
            <Divider theme={theme} />
            <ToolbarButton label={t('canvas.deleteSelected')} shortcut="Delete" onClick={onDelete} danger>
              <Trash2 className="size-[18px]" />
            </ToolbarButton>
          </>
        ) : null}
        <Divider theme={theme} />
        {/* 清空是破坏性操作，收进「更多」菜单，避免和常用工具挨在一起误点 */}
        <Dropdown
          trigger={['click']}
          placement="topRight"
          menu={{
            items: [{ key: 'clear', danger: true, disabled: !nodeCount, icon: <Eraser className="size-4" />, label: `${t('canvas.toolbar.clear')}…`, onClick: onClear }],
          }}
        >
          <span className="inline-flex">
            <ToolbarButton label="更多">
              <MoreHorizontal className="size-[18px]" />
            </ToolbarButton>
          </span>
        </Dropdown>
      </div>

      {appearanceOpen ? (
        <div
          className="pointer-events-auto absolute bottom-[72px] z-30 w-[248px] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
          style={{ left: panelX || '50%', background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
        >
          <div className="px-1 pb-2 text-sm font-medium opacity-65">{t('canvas.toolbar.appearance')}</div>
          <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">{t('canvas.toolbar.themeMode')}</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
            <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
              <Sun className="size-4" />
              {t('canvas.toolbar.light')}
            </CanvasThemeButton>
            <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
              <Moon className="size-4" />
              {t('canvas.toolbar.dark')}
            </CanvasThemeButton>
          </div>
          <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">{t('canvas.toolbar.gridStyle')}</div>
          <Segmented
            className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
            value={backgroundMode}
            onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
            options={[
              {
                value: 'dots',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <CircleDot className="size-4" />
                    {t('canvas.toolbar.dots')}
                  </span>
                ),
              },
              {
                value: 'lines',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Grid2x2 className="size-4" />
                    {t('canvas.toolbar.lines')}
                  </span>
                ),
              },
              {
                value: 'blank',
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Square className="size-4" />
                    {t('canvas.toolbar.blank')}
                  </span>
                ),
              },
            ]}
          />
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
              <Info className="size-3.5" />
              {t('canvas.toolbar.imageInfo')}
            </span>
            <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToolbarButton({
  label,
  shortcut,
  active,
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)]
  const tooltip = useTooltip()
  const style = active
    ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText }
    : tooltip.visible && !disabled
      ? { background: theme.toolbar.itemHover, color: theme.toolbar.activeText }
      : { color: danger ? '#f87171' : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }

  return (
    <span className="inline-flex" {...tooltip.handlers}>
      <Button
        type="text"
        aria-label={label}
        aria-keyshortcuts={shortcut}
        className="!h-8 !w-8 !min-w-8 !p-0 max-sm:!w-[30px] max-sm:!min-w-[30px]"
        disabled={disabled}
        style={style}
        icon={children}
        onClick={(event) => {
          tooltip.dismiss()
          onClick?.(event)
        }}
      />
      <ViewportTooltip visible={tooltip.visible} className="whitespace-nowrap">
        {label}
        {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
      </ViewportTooltip>
    </span>
  )
}

function Divider({ theme }: { theme: CanvasTheme }) {
  return <div className="mx-1 h-6 w-px max-sm:mx-0.5" style={{ background: theme.toolbar.border }} />
}

function CanvasThemeButton({
  colorTheme,
  targetTheme,
  onThemeChange,
  children,
}: {
  colorTheme: CanvasColorTheme
  targetTheme: CanvasColorTheme
  onThemeChange: (theme: CanvasColorTheme) => void
  children: ReactNode
}) {
  const theme = canvasThemes[colorTheme]
  const active = colorTheme === targetTheme
  const activeStyle =
    colorTheme === 'light' ? { background: '#111111', color: '#ffffff' } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText }
  const { t } = useTranslation()
  const label = targetTheme === 'dark' ? t('topNav.darkTheme') : t('topNav.lightTheme')

  return (
    <button
      type="button"
      onClick={() => onThemeChange(targetTheme)}
      className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
      style={active ? activeStyle : { color: theme.toolbar.item }}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
  if (!wrap) return 0
  const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect()
  const box = target.getBoundingClientRect()
  return box.left - wrapBox.left + box.width / 2
}
