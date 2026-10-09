// 基于上游 canvas-side-panel.tsx；资源和提示词接入光构现有仓库。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { App, Input, Select } from 'antd'
import { Check, ChevronRight, Download, Eye, FileText, Image as ImageIcon, ListChecks, Search, Settings2, Square, Type } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { INSPIRATION_PROMPTS } from '../../lib/inspirationPrompts'
import { canvasThemes, type CanvasTheme } from '../../lib/canvas/theme'
import { getNodeDefinition } from '../../lib/canvas/nodeRegistry'
import {
  ensureCanvasImagePreview,
  previewUrlFor,
  subscribeImagePreviews,
  getImagePreviewRevision,
  setCanvasImagePreviewOwner,
  releaseCanvasImagePreviewOwner,
} from '../../lib/canvas/imageStorage'
import { useCanvasSidePanelStore, useThemeStore } from '../../lib/canvas/uiStore'
import { CanvasNodeType, type CanvasNodeData } from '../../lib/canvas/types'
import { exportCanvasNodes } from '../../lib/canvas/export'

export type InsertAssetPayload = { kind: 'image'; imageId: string; title: string } | { kind: 'text'; content: string; title: string }
const NODE_TYPE_ICON: Record<string, typeof Square> = { image: ImageIcon, text: Type, config: Settings2, group: Square }
const STATUS_COLOR: Record<string, string> = { success: '#22c55e', loading: '#f59e0b', error: '#ef4444', idle: 'transparent' }
const cn = (...values: Array<string | number | boolean | undefined>) => values.filter(Boolean).join(' ')

export function CanvasSidePanel({
  nodes,
  selectedNodeIds,
  onFocusNode,
  onPreviewNode,
  onInsertAsset,
}: {
  nodes: CanvasNodeData[]
  selectedNodeIds: Set<string>
  onFocusNode: (id: string) => void
  onPreviewNode: (id: string) => void
  onInsertAsset: (asset: InsertAssetPayload) => void
}) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)]
  const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen)
  const width = useCanvasSidePanelStore((state) => state.width)
  const [tab, setTab] = useState<'canvas' | 'assets' | 'prompts'>('canvas')
  const [keyword, setKeyword] = useState('')
  const [limit, setLimit] = useState(60)
  const tasks = useStore((state) => state.tasks)
  const previewOwner = useRef(Symbol('canvas-assets'))
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision)
  const assets = useMemo(
    () =>
      tasks
        .filter((task) => !task.cloudHiddenAt && (!keyword || task.prompt.includes(keyword)))
        .flatMap((task) => task.outputImages.map((id) => ({ id, title: task.prompt })))
        .slice(0, limit),
    [tasks, keyword, limit],
  )
  useEffect(() => {
    setCanvasImagePreviewOwner(previewOwner.current, tab === 'assets' && panelOpen ? assets.map((asset) => asset.id) : [])
    if (tab !== 'assets' || !panelOpen) return
    for (const asset of assets) void ensureCanvasImagePreview(asset.id).catch((err) => console.warn('读取素材缩略图失败', err))
  }, [tab, assets, panelOpen])
  useEffect(() => {
    const owner = previewOwner.current
    return () => releaseCanvasImagePreviewOwner(owner)
  }, [])
  if (!panelOpen) return null
  return (
    <aside
      className="canvas-side-panel relative z-[60] flex h-full shrink-0 flex-col overflow-hidden border-r"
      style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
      data-canvas-no-zoom
    >
      <div className="flex items-center gap-5 px-4 pt-3.5">
        {(['canvas', 'assets', 'prompts'] as const).map((value, index) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className="relative pb-1.5 text-sm font-semibold transition-opacity"
            style={{ opacity: tab === value ? 1 : 0.45 }}
          >
            {['画布', '素材', '提示词'][index]}
            {tab === value && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} />}
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        {tab === 'canvas' ? (
          <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="p-3">
              <Input
                size="small"
                allowClear
                prefix={<Search className="size-3.5" />}
                placeholder={tab === 'assets' ? '搜索作品素材' : '搜索提示词'}
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value)
                  setLimit(60)
                }}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {tab === 'assets' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {assets.map((asset, index) => (
                      <button
                        key={`${asset.id}-${index}`}
                        type="button"
                        className="group overflow-hidden rounded-lg border text-left"
                        style={{ borderColor: theme.node.stroke }}
                        onClick={() => onInsertAsset({ kind: 'image', imageId: asset.id, title: asset.title.slice(0, 30) })}
                        title="添加到画布"
                      >
                        <img src={previewUrlFor(asset.id)} alt={asset.title} className="aspect-square w-full object-cover" loading="lazy" />
                        <span className="block truncate p-2 text-xs">{asset.title}</span>
                      </button>
                    ))}
                  </div>
                  {!assets.length && <p className="pt-16 text-center text-sm opacity-40">还没有图片素材，先生成或上传一张</p>}
                  {assets.length === limit && (
                    <button className="mt-3 w-full rounded-lg border p-2 text-xs" onClick={() => setLimit(limit + 60)}>
                      显示更多
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  {INSPIRATION_PROMPTS.filter((item) => `${item.title} ${item.description}`.includes(keyword)).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full rounded-xl border p-3 text-left transition hover:bg-white/5"
                      style={{ borderColor: theme.node.stroke }}
                      onClick={() => onInsertAsset({ kind: 'text', content: item.prompt, title: item.title })}
                    >
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="mt-1 line-clamp-2 text-xs leading-5 opacity-50">{item.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <a
        className="border-t px-4 py-2 text-[10px] opacity-40 hover:opacity-80"
        style={{ borderColor: theme.toolbar.border }}
        href="https://github.com/basketikun/infinite-canvas"
        target="_blank"
        rel="noreferrer"
      >
        基于 Infinite Canvas · MIT
      </a>
      <button
        type="button"
        aria-label="调整资源栏宽度"
        className="absolute inset-y-0 right-0 w-1 cursor-col-resize"
        onPointerDown={(event) => {
          event.preventDefault()
          const start = event.clientX
          const controller = new AbortController()
          window.addEventListener('pointermove', (move) => useCanvasSidePanelStore.getState().setWidth(width + move.clientX - start), {
            signal: controller.signal,
          })
          window.addEventListener('pointerup', () => controller.abort(), { once: true, signal: controller.signal })
          window.addEventListener('pointercancel', () => controller.abort(), { once: true, signal: controller.signal })
        }}
      />
    </aside>
  )
}
const NODE_FILTER_VALUES = ['all', CanvasNodeType.Image, CanvasNodeType.Text, CanvasNodeType.Config, CanvasNodeType.Group]

function nodePreviewText(node: CanvasNodeData) {
  if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || ''
  return getNodeDefinition(node.type)?.title || node.type
}

function CanvasNodesTab({
  nodes,
  selectedNodeIds,
  onFocusNode,
  onPreviewNode,
  theme,
}: {
  nodes: CanvasNodeData[]
  selectedNodeIds: Set<string>
  onFocusNode: (nodeId: string) => void
  onPreviewNode: (nodeId: string) => void
  theme: CanvasTheme
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision)
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return nodes.filter(
      (node) =>
        (typeFilter === 'all' || node.type === typeFilter) &&
        (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(' ').toLowerCase().includes(query)),
    )
  }, [nodes, keyword, typeFilter])
  const treeRows = useMemo(() => {
    const filteredIds = new Set(filtered.map((node) => node.id))
    const groups = new Set(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id))
    const children = new Map<string, CanvasNodeData[]>()
    filtered.forEach((node) => {
      const groupId = node.metadata?.groupId
      if (groupId && groups.has(groupId)) children.set(groupId, [...(children.get(groupId) || []), node])
    })
    return nodes.flatMap((node) => {
      if (node.metadata?.groupId && groups.has(node.metadata.groupId)) return []
      if (node.type !== CanvasNodeType.Group) return filteredIds.has(node.id) ? [{ node, depth: 0, hasChildren: false }] : []
      const groupChildren = children.get(node.id) || []
      if (!filteredIds.has(node.id) && !groupChildren.length) return []
      return [
        { node, depth: 0, hasChildren: groupChildren.length > 0 },
        ...(collapsedGroups.has(node.id) ? [] : groupChildren.map((child) => ({ node: child, depth: 1, hasChildren: false }))),
      ]
    })
  }, [collapsedGroups, filtered, nodes])

  const exitSelect = () => {
    setSelectMode(false)
    setChecked(new Set())
  }
  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id))
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)))

  const handleExport = async () => {
    const targets = nodes.filter((node) => checked.has(node.id))
    if (!targets.length) return
    setExporting(true)
    const hide = message.loading(t('canvas.sidePanel.exporting'), 0)
    try {
      await exportCanvasNodes(targets, t('canvas.sidePanel.exportName', { count: targets.length }))
      message.success(t('canvas.sidePanel.exported', { count: targets.length }))
      exitSelect()
    } catch (error) {
      console.error(error)
      message.error(t('canvas.sidePanel.exportFailed'))
    } finally {
      hide()
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        <span className="text-xs font-medium opacity-60">{t('canvas.sidePanel.elements')}</span>
        {filtered.length ? <span className="text-xs opacity-35">{filtered.length}</span> : null}
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
        >
          <ListChecks className="size-3.5" />
          {selectMode ? t('common.cancel') : t('canvas.sidePanel.select')}
        </button>
        {selectMode ? null : (
          <Select
            size="small"
            variant="borderless"
            className="w-20"
            value={typeFilter}
            onChange={setTypeFilter}
            options={NODE_FILTER_VALUES.map((value) => ({ value, label: value === 'all' ? t('common.all') : t(`canvas.sidePanel.filter.${value}`) }))}
          />
        )}
      </div>
      <div className="px-3 pb-2.5">
        <Input
          size="small"
          allowClear
          prefix={<Search className="size-3.5 text-stone-400" />}
          placeholder={t('canvas.sidePanel.searchNodes')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {treeRows.length ? (
          <div className="space-y-1.5">
            {treeRows.map(({ node, depth, hasChildren }) => {
              const Icon = NODE_TYPE_ICON[node.type] || FileText
              const isImage = node.type === CanvasNodeType.Image && node.metadata?.content
              const isChecked = checked.has(node.id)
              const active = selectMode ? isChecked : selectedNodeIds.has(node.id)
              return (
                <div
                  key={node.id}
                  className={cn(
                    'group relative flex items-center rounded-lg transition',
                    depth && 'ml-5',
                    active ? '' : 'hover:bg-black/5 dark:hover:bg-white/5',
                  )}
                  style={active ? { background: theme.toolbar.activeBg } : undefined}
                >
                  {depth ? (
                    <span
                      className="pointer-events-none absolute -left-3 top-[calc(-50%-0.4rem)] h-[calc(100%+0.4rem)] w-3 rounded-bl-md border-b border-l opacity-45"
                      style={{ borderColor: theme.node.stroke }}
                    />
                  ) : null}
                  {node.type === CanvasNodeType.Group && hasChildren ? (
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedGroups((prev) => (prev.has(node.id) ? new Set([...prev].filter((id) => id !== node.id)) : new Set(prev).add(node.id)))
                      }
                      className="ml-1 grid size-6 shrink-0 place-items-center opacity-55 transition hover:opacity-100"
                      aria-label={node.title}
                    >
                      <ChevronRight className={cn('size-3.5 transition-transform', !collapsedGroups.has(node.id) && 'rotate-90')} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => (selectMode ? toggleChecked(node.id) : onFocusNode(node.id))}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-3 py-2 pr-2 text-left',
                      node.type === CanvasNodeType.Group && hasChildren ? 'pl-0' : 'pl-2',
                    )}
                    title={selectMode ? undefined : t('canvas.sidePanel.focusNode')}
                  >
                    {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                      {isImage ? (
                        <img src={previewUrlFor(node.metadata?.storageKey) || node.metadata?.content} alt={node.title} className="size-full object-cover" />
                      ) : (
                        <Icon className="size-5 opacity-60" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block truncate text-sm font-medium leading-snug">
                        {node.title || getNodeDefinition(node.type)?.title || t('canvas.node.untitled')}
                      </span>
                      <span className="block truncate text-xs leading-snug opacity-50">{nodePreviewText(node)}</span>
                    </span>
                    {node.metadata?.status && node.metadata.status !== 'idle' ? (
                      <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || 'transparent' }} />
                    ) : null}
                  </button>
                  {selectMode || !isImage ? null : (
                    <div className="flex shrink-0 flex-col items-center gap-0.5 pr-1.5">
                      <button
                        type="button"
                        onClick={() => onPreviewNode(node.id)}
                        className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                        aria-label={t('canvas.sidePanel.preview')}
                        title={t('canvas.sidePanel.preview')}
                      >
                        <Eye className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="pt-16 text-center text-sm opacity-40">{t('canvas.sidePanel.noNodes')}</div>
        )}
      </div>
      {selectMode ? (
        <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
          <button
            type="button"
            onClick={toggleAll}
            className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            {allChecked ? t('canvas.sidePanel.clearAll') : t('workbench.selectAll')}
          </button>
          <span className="text-xs opacity-45">{t('canvas.sidePanel.selected', { count: checked.size })}</span>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!checked.size || exporting}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
            style={{ color: theme.node.text }}
          >
            <Download className="size-3.5" />
            {t('canvas.exportSelected')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
  return (
    <span
      className="grid size-4 shrink-0 place-items-center rounded border transition"
      style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : 'transparent' }}
    >
      {checked ? <Check className="size-3 text-white" /> : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
