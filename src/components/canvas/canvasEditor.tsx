// 复用上游画布组件与交互顺序，业务状态接入独立 canvasStore。
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { App, Button, Modal } from 'antd'
import { Brush, Crop, Download, ImagePlus, Play, Settings2 } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { useStore, ensureImageCached } from '../../store'
import { getImageModels, isBackendAuthEnabled, type GouoImageModel } from '../../lib/gouoBackend'
import { storeImage, storeImageWithSize } from '../../lib/db'
import { loadImage } from '../../lib/canvasImage'
import {
  applyGroupSelection,
  applyUngroupSelection,
  canGroupSelectedNodes,
  canUngroupSelectedNodes,
  findGroupDropTarget,
  getGroupWrapRect,
  nodeBounds,
  normalizeConnection,
  snapNodesIntoGroup,
} from '../../lib/canvas/nodeGeometry'
import { createCanvasNode, isRecord, validateCanvasProject } from '../../lib/canvas/document'
import { buildNodeMentionReferences, getNodeInputs } from '../../lib/canvas/resources'
import {
  canvasImageMetadata,
  displayCanvasNodes,
  ensureCanvasImagePreview,
  getImagePreviewRevision,
  subscribeImagePreviews,
  setCanvasImagePreviewOwner,
  releaseCanvasImagePreviewOwner,
  uploadCanvasImage,
} from '../../lib/canvas/imageStorage'
import { downloadCanvasBlob, exportCanvasProjects } from '../../lib/canvas/export'
import { generateCanvasNode } from '../../lib/canvas/generation'
import { fitNodeSize } from '../../lib/canvas/nodeSize'
import { createCanvasViewportPersistence, visibleCanvasNodes } from '../../lib/canvas/viewport'
import { canvasThemes } from '../../lib/canvas/theme'
import { useThemeStore } from '../../lib/canvas/uiStore'
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type CanvasProject,
  type ConnectionHandle,
  type ContextMenuState,
  type Position,
  type SelectionBox,
  type ViewportTransform,
} from '../../lib/canvas/types'
import { InfiniteCanvas } from './infiniteCanvas'
import { CanvasNode } from './canvasNode'
import { ActiveConnectionPath, ConnectionPath } from './canvasConnections'
import { Minimap } from './canvasMiniMap'
import { CanvasToolbar } from './canvasToolbar'
import { CanvasTopBar } from './canvasTopBar'
import { CanvasZoomControls } from './canvasZoomControls'
import { CanvasSelectionToolbar } from './canvasSelectionToolbar'
import { CanvasNodeContextMenu } from './canvasContextMenu'
import { NodeCreateMenu } from './canvasCreateMenus'
import { CanvasSidePanel, type InsertAssetPayload } from './canvasSidePanel'
import { CanvasNodeCropDialog, type CanvasImageCropRect } from './canvasNodeCropDialog'
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from './canvasNodeMaskEditDialog'

const EMPTY_IDS: string[] = []
type Clipboard = { nodes: CanvasNodeData[]; connections: CanvasConnection[] }
type Props = { project: CanvasProject; onOpenProject: (id: string) => void; onOpenAgent: (id: string) => void }

export function CanvasEditor({ project, onOpenProject, onOpenAgent }: Props) {
  const { message, modal } = App.useApp()
  const theme = canvasThemes[useThemeStore((state) => state.theme)]
  const selectedIds = useCanvasStore((state) => state.selectedNodeIds[project.id] || EMPTY_IDS)
  const history = useCanvasStore((state) => state.histories[project.id])
  const saveError = useCanvasStore((state) => state.error)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const clipboard = useRef<Clipboard | null>(null)
  const targetUpload = useRef<string | null>(null)
  const [canvasTool, setCanvasTool] = useState<'select' | 'pan'>('pan')
  const [size, setSize] = useState({ width: 1200, height: 720 })
  const [draftNodes, setDraftNodes] = useState<CanvasNodeData[] | null>(null)
  const draftRef = useRef<CanvasNodeData[] | null>(null)
  const revisionRef = useRef(project.revision)
  const [viewport, setViewport] = useState(project.viewport)
  const previewOwner = useRef(Symbol('canvas-viewport'))
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [connecting, setConnecting] = useState<ConnectionHandle | null>(null)
  const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 })
  const [connectionTarget, setConnectionTarget] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [createAt, setCreateAt] = useState<Position | null>(null)
  const [miniMap, setMiniMap] = useState(false)
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(project.title)
  const [expanded, setExpanded] = useState(new Set<string>())
  const [preview, setPreview] = useState<string | null>(null)
  const [crop, setCrop] = useState<{ node: CanvasNodeData; url: string } | null>(null)
  const [mask, setMask] = useState<{ node: CanvasNodeData; url: string } | null>(null)
  const [models, setModels] = useState<GouoImageModel[]>([])
  const settings = useStore((state) => state.settings)
  const previewRevision = useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision)
  const nodes = useMemo(() => displayCanvasNodes(draftNodes || project.nodes), [draftNodes, project.nodes, previewRevision])
  const visibleNodes = useMemo(() => visibleCanvasNodes(nodes, viewport, size, expanded.size ? 1200 : 360), [nodes, viewport, size, expanded.size])
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const latest = useRef({ project, nodes, selected, viewport, selectedConnection })
  latest.current = { project, nodes, selected, viewport, selectedConnection }
  const drag = useRef<{ x: number; y: number; nodes: CanvasNodeData[]; ids: Set<string>; moved: boolean } | null>(null)
  const selectionRef = useRef<SelectionBox | null>(null)
  const connectingRef = useRef<ConnectionHandle | null>(null)

  const report = useCallback(
    (error: unknown) => {
      console.error('画布操作失败', error)
      void message.error(error instanceof Error ? error.message : String(error))
    },
    [message],
  )
  const run = useCallback(
    (promise: Promise<unknown>) => {
      void promise.catch(report)
    },
    [report],
  )
  const update = useCallback(
    (patch: Partial<CanvasProject>, history = true) => useCanvasStore.getState().updateProject(project.id, patch, { history }),
    [project.id],
  )
  const choose = useCallback((ids: string[]) => useCanvasStore.getState().setSelection(project.id, ids), [project.id])
  const viewportPersistence = useMemo(() => createCanvasViewportPersistence((next) => run(update({ viewport: next }, false))), [run, update])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setViewport(project.viewport)
  }, [project.viewport])
  useEffect(() => {
    const ids = new Set(
      visibleNodes.flatMap((node) =>
        [node.metadata?.imageId || node.metadata?.storageKey, ...(node.metadata?.images || []).map((image) => image.storageKey)].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    )
    setCanvasImagePreviewOwner(previewOwner.current, ids)
    for (const id of ids) void ensureCanvasImagePreview(id).catch(report)
  }, [visibleNodes, report])
  useEffect(() => {
    if (isBackendAuthEnabled()) void getImageModels().then(setModels).catch(report)
  }, [report])
  useEffect(() => () => viewportPersistence.dispose(), [viewportPersistence])
  useEffect(() => {
    const owner = previewOwner.current
    return () => releaseCanvasImagePreviewOwner(owner)
  }, [])

  const onViewportChange = useCallback(
    (next: ViewportTransform) => {
      setViewport(next)
      viewportPersistence.schedule(next)
    },
    [viewportPersistence],
  )
  const center = () => ({ x: (size.width / 2 - viewport.x) / viewport.k, y: (size.height / 2 - viewport.y) / viewport.k })
  const world = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const view = latest.current.viewport
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }
  }
  const resetView = () => {
    if (!nodes.length) {
      onViewportChange({ x: size.width / 2 - 170, y: size.height / 2 - 120, k: 1 })
      return
    }
    const bounds = nodeBounds(nodes)
    const k = Math.min(
      1,
      Math.max(0.05, Math.min((size.width - 160) / Math.max(1, bounds.right - bounds.left), (size.height - 220) / Math.max(1, bounds.bottom - bounds.top))),
    )
    onViewportChange({ x: size.width / 2 - ((bounds.left + bounds.right) / 2) * k, y: size.height / 2 - ((bounds.top + bounds.bottom) / 2) * k, k })
  }
  const addNode = async (type: string, position = center(), content?: string) => {
    const current = useCanvasStore.getState().getSnapshot(project.id)
    const node = createCanvasNode(type, position, content !== undefined ? { content } : undefined)
    await update({ nodes: [...current.nodes, node] })
    choose([node.id])
    setCreateAt(null)
    return node
  }
  const patchNode = (id: string, patch: Partial<CanvasNodeData>, history = true) => {
    const current = useCanvasStore.getState().getSnapshot(project.id)
    return update(
      { nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch, metadata: { ...node.metadata, ...patch.metadata } } : node)) },
      history,
    )
  }
  const removeSelection = () => {
    const current = latest.current
    const ids = new Set(current.selected)
    current.project.nodes.forEach((node) => {
      if (node.metadata?.groupId && ids.has(node.metadata.groupId)) ids.add(node.id)
    })
    run(
      update({
        nodes: current.project.nodes.filter((node) => !ids.has(node.id)),
        connections: current.project.connections.filter(
          (conn) => conn.id !== current.selectedConnection && !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId),
        ),
      }),
    )
    choose([])
    setSelectedConnection(null)
    setMenu(null)
  }
  const copySelection = () => {
    const current = latest.current
    const ids = new Set(current.selected)
    current.project.nodes.forEach((node) => {
      if (node.metadata?.groupId && ids.has(node.metadata.groupId)) ids.add(node.id)
    })
    clipboard.current = structuredClone({
      nodes: current.project.nodes.filter((node) => ids.has(node.id)),
      connections: current.project.connections.filter((conn) => ids.has(conn.fromNodeId) && ids.has(conn.toNodeId)),
    })
  }
  const pasteSelection = async () => {
    if (!clipboard.current?.nodes.length) return
    const current = useCanvasStore.getState().getSnapshot(project.id)
    const ids = new Map(clipboard.current.nodes.map((node) => [node.id, crypto.randomUUID()]))
    const copied = clipboard.current.nodes.map((node) => ({
      ...structuredClone(node),
      id: ids.get(node.id)!,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      metadata: {
        ...node.metadata,
        taskId: undefined,
        requestId: undefined,
        status: node.metadata?.status === 'loading' ? ('idle' as const) : node.metadata?.status,
        groupId: node.metadata?.groupId ? ids.get(node.metadata.groupId) : undefined,
      },
    }))
    await update({
      nodes: [...current.nodes, ...copied],
      connections: [
        ...current.connections,
        ...clipboard.current.connections.map((conn) => ({ id: crypto.randomUUID(), fromNodeId: ids.get(conn.fromNodeId)!, toNodeId: ids.get(conn.toNodeId)! })),
      ],
    })
    choose(copied.map((node) => node.id))
    clipboard.current = {
      nodes: copied,
      connections: clipboard.current.connections.map((conn) => ({ ...conn, fromNodeId: ids.get(conn.fromNodeId)!, toNodeId: ids.get(conn.toNodeId)! })),
    }
  }
  const groupSelection = async (ungroup = false) => {
    const current = latest.current
    const group = createCanvasNode(CanvasNodeType.Group, center())
    if (!ungroup) {
      const bounds = getGroupWrapRect(current.project.nodes.filter((node) => current.selected.has(node.id)))
      group.position = { x: bounds.x, y: bounds.y }
      group.width = bounds.width
      group.height = bounds.height
    }
    const result = ungroup
      ? applyUngroupSelection(current.selected, current.project.nodes, current.project.connections)
      : applyGroupSelection(current.selected, current.project.nodes, current.project.connections, group)
    if (!result) return
    await update({ nodes: result.nodes, connections: result.connections })
    choose(result.selectedIds)
    setMenu(null)
  }
  const upload = async (files: FileList | File[], position = center()) => {
    const inserted = await Promise.all(
      Array.from(files)
        .filter((file) => file.type.startsWith('image/'))
        .map(async (file, index) => {
          const metadata = await uploadCanvasImage(file)
          const node = createCanvasNode(CanvasNodeType.Image, { x: position.x + index * 370, y: position.y }, metadata)
          node.title = file.name
          Object.assign(node, fitNodeSize(metadata.naturalWidth, metadata.naturalHeight, 420, 420))
          return node
        }),
    )
    const targetId = targetUpload.current
    targetUpload.current = null
    const current = useCanvasStore.getState().getSnapshot(project.id)
    const replaced =
      targetId && inserted[0]
        ? current.nodes.map((node) => (node.id === targetId ? { ...node, ...inserted[0], id: node.id, position: node.position } : node))
        : current.nodes
    const added = targetId ? inserted.slice(1) : inserted
    await update({ nodes: [...replaced, ...added] })
    choose(targetId ? [targetId, ...added.map((node) => node.id)] : added.map((node) => node.id))
  }
  const insertAsset = async (asset: InsertAssetPayload) => {
    if (asset.kind === 'text') {
      const node = await addNode(CanvasNodeType.Text, center(), asset.content)
      await patchNode(node.id, { title: asset.title }, false)
      return
    }
    const metadata = await canvasImageMetadata(asset.imageId)
    const node = createCanvasNode(CanvasNodeType.Image, center(), metadata)
    node.title = asset.title
    Object.assign(node, fitNodeSize(metadata.naturalWidth, metadata.naturalHeight, 420, 420))
    const current = useCanvasStore.getState().getSnapshot(project.id)
    await update({ nodes: [...current.nodes, node] })
    choose([node.id])
  }
  const previewImage = async (node: CanvasNodeData, imageId?: string) => {
    const id = imageId ? node.metadata?.images?.find((image) => image.id === imageId)?.storageKey : node.metadata?.imageId || node.metadata?.storageKey
    const url = id ? await ensureImageCached(id) : undefined
    if (!url) throw new Error('原图不可用，请等待云同步完成')
    setPreview(url)
  }

  const dragStart = (event: ReactPointerEvent, id: string) => {
    if (event.button !== 0 || event.ctrlKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    event.stopPropagation()
    viewportPersistence.beginInteraction()
    const current = { ...latest.current, project: useCanvasStore.getState().getSnapshot(project.id) }
    const ids = event.shiftKey || event.metaKey ? new Set(current.selected) : current.selected.has(id) ? new Set(current.selected) : new Set([id])
    if (event.shiftKey || event.metaKey) ids.has(id) ? ids.delete(id) : ids.add(id)
    choose([...ids])
    current.project.nodes.forEach((node) => {
      if (node.metadata?.groupId && ids.has(node.metadata.groupId)) ids.add(node.id)
    })
    drag.current = { x: event.clientX, y: event.clientY, nodes: current.project.nodes, ids, moved: false }
    revisionRef.current = current.project.revision
    setSelectedConnection(null)
  }
  const beginSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = world(event.clientX, event.clientY)
    const box = {
      startWorldX: point.x,
      startWorldY: point.y,
      currentWorldX: point.x,
      currentWorldY: point.y,
      additive: event.shiftKey || event.metaKey,
      initialSelectedNodeIds: selectedIds,
    }
    selectionRef.current = box
    setSelectionBox(box)
    if (!box.additive) choose([])
    setSelectedConnection(null)
    setCreateAt(null)
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = latest.current
      if (drag.current) {
        const dx = (event.clientX - drag.current.x) / current.viewport.k
        const dy = (event.clientY - drag.current.y) / current.viewport.k
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true
        draftRef.current = drag.current.nodes.map((node) =>
          drag.current!.ids.has(node.id) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node,
        )
        setDraftNodes(draftRef.current)
      }
      if (selectionRef.current) {
        const point = world(event.clientX, event.clientY)
        const box = { ...selectionRef.current, currentWorldX: point.x, currentWorldY: point.y }
        selectionRef.current = box
        setSelectionBox(box)
        const ids = current.project.nodes
          .filter(
            (node) =>
              node.position.x < Math.max(box.startWorldX, point.x) &&
              node.position.x + node.width > Math.min(box.startWorldX, point.x) &&
              node.position.y < Math.max(box.startWorldY, point.y) &&
              node.position.y + node.height > Math.min(box.startWorldY, point.y),
          )
          .map((node) => node.id)
        choose([...new Set([...(box.additive ? box.initialSelectedNodeIds : []), ...ids])])
      }
      if (connectingRef.current) {
        setMouseWorld(world(event.clientX, event.clientY))
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]')?.getAttribute('data-node-id') || null
        setConnectionTarget(target !== connectingRef.current.nodeId ? target : null)
      }
    }
    const up = (event: PointerEvent) => {
      if (event.type !== 'pointercancel' && drag.current?.moved && draftRef.current) {
        const group = findGroupDropTarget(drag.current.ids, draftRef.current)
        const next = group
          ? snapNodesIntoGroup(drag.current.ids, draftRef.current, group)
          : draftRef.current.map((node) =>
              drag.current!.ids.has(node.id) && node.metadata?.groupId && !drag.current!.ids.has(node.metadata.groupId)
                ? { ...node, metadata: { ...node.metadata, groupId: undefined } }
                : node,
            )
        run(useCanvasStore.getState().updateProject(project.id, { nodes: next }, { expectedRevision: revisionRef.current }))
      }
      if (event.type !== 'pointercancel' && connectingRef.current) {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-id]')?.getAttribute('data-node-id')
        const handle = connectingRef.current
        const current = latest.current.project
        const connection = target ? normalizeConnection(handle.nodeId, target, current.nodes, handle.handleType) : null
        if (connection && !current.connections.some((conn) => conn.fromNodeId === connection.fromNodeId && conn.toNodeId === connection.toNodeId))
          run(update({ connections: [...current.connections, { id: crypto.randomUUID(), ...connection }] }))
      }
      if (drag.current) {
        draftRef.current = null
        setDraftNodes(null)
        viewportPersistence.endInteraction()
      }
      drag.current = null
      selectionRef.current = null
      connectingRef.current = null
      setSelectionBox(null)
      setConnecting(null)
      setConnectionTarget(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [choose, project.id, run, update, viewportPersistence])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest('input,textarea,select,[contenteditable=true],.ant-modal,.ant-select-dropdown')) return
      const cmd = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        choose([])
        setMenu(null)
        setCreateAt(null)
        connectingRef.current = null
        setConnecting(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelection()
        return
      }
      if (!cmd) return
      const key = event.key.toLowerCase()
      if (!['a', 'c', 'v', 'g', 'z', 'y', 'd'].includes(key)) return
      // 让浏览器产生 copy/paste 事件，才能同时支持节点和系统剪贴板图片。
      if (key === 'c' || key === 'v') return
      event.preventDefault()
      if (key === 'a') choose(latest.current.project.nodes.map((node) => node.id))
      if (key === 'd') {
        copySelection()
        run(pasteSelection())
      }
      if (key === 'g') run(groupSelection(event.shiftKey))
      if (key === 'z') run(event.shiftKey ? useCanvasStore.getState().redo(project.id) : useCanvasStore.getState().undo(project.id))
      if (key === 'y') run(useCanvasStore.getState().redo(project.id))
    }
    const paste = (event: ClipboardEvent) => {
      if ((event.target as Element | null)?.closest('input,textarea,[contenteditable=true]')) return
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (files.length) {
        event.preventDefault()
        run(upload(files))
        return
      }
      const content = event.clipboardData?.getData('application/x-gouo-canvas') || event.clipboardData?.getData('text/plain')
      if (!content?.startsWith('{"format":"gouo-canvas-clipboard"')) return
      event.preventDefault()
      try {
        const value: unknown = JSON.parse(content)
        if (!isRecord(value)) throw new Error('剪贴板画布数据无效')
        const next = { ...latest.current.project, nodes: value.nodes, connections: value.connections }
        validateCanvasProject(next)
        clipboard.current = { nodes: next.nodes, connections: next.connections }
        run(pasteSelection())
      } catch (err) {
        report(err)
      }
    }
    const copy = (event: ClipboardEvent) => {
      if ((event.target as Element | null)?.closest('input,textarea,[contenteditable=true]') || !latest.current.selected.size) return
      copySelection()
      event.preventDefault()
      const value = JSON.stringify({ format: 'gouo-canvas-clipboard', ...clipboard.current })
      event.clipboardData?.setData('application/x-gouo-canvas', value)
      event.clipboardData?.setData('text/plain', value)
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('paste', paste)
    window.addEventListener('copy', copy)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('paste', paste)
      window.removeEventListener('copy', copy)
    }
  })

  const imageActions = (node: CanvasNodeData) => (
    <div className="flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
      <Button
        size="small"
        type="text"
        aria-label="上传到此节点"
        icon={<ImagePlus className="size-4" />}
        onClick={() => {
          targetUpload.current = node.id
          inputRef.current?.click()
        }}
      />
      {node.metadata?.imageId && (
        <>
          <Button
            size="small"
            type="text"
            aria-label="遮罩编辑"
            icon={<Brush className="size-4" />}
            onClick={() =>
              run(
                (async () => {
                  const url = await ensureImageCached(node.metadata!.imageId!)
                  if (!url) throw new Error('原图不可用')
                  setMask({ node, url })
                })(),
              )
            }
          />
          <Button
            size="small"
            type="text"
            aria-label="裁剪图片"
            icon={<Crop className="size-4" />}
            onClick={() =>
              run(
                (async () => {
                  const url = await ensureImageCached(node.metadata!.imageId!)
                  if (!url) throw new Error('原图不可用')
                  setCrop({ node, url })
                })(),
              )
            }
          />
          <Button
            size="small"
            type="text"
            aria-label="下载图片"
            icon={<Download className="size-4" />}
            onClick={() =>
              run(
                (async () => {
                  const url = await ensureImageCached(node.metadata!.imageId!)
                  if (!url) throw new Error('原图不可用')
                  downloadCanvasBlob(await (await fetch(url)).blob(), `${node.title}.png`)
                })(),
              )
            }
          />
        </>
      )}
    </div>
  )
  const generate = async (id: string, prompt?: string) => {
    try {
      await generateCanvasNode(project.id, id, prompt)
    } catch (err) {
      if (err instanceof Error && err.message.includes('确认全图重绘')) {
        modal.confirm({
          title: '确认编辑整张图片？',
          content: '当前遮罩覆盖整张图片，继续后可能重绘全部内容。',
          okText: '继续生成',
          cancelText: '取消',
          onOk: () => generateCanvasNode(project.id, id, prompt, true),
        })
        return
      }
      throw err
    }
  }
  const confirmMask = async (payload: CanvasImageMaskEditPayload) => {
    if (!mask) return
    const maskImageId = await storeImage(payload.maskDataUrl, 'mask')
    await patchNode(mask.node.id, { metadata: { maskImageId, maskTargetImageId: mask.node.metadata!.imageId, prompt: payload.prompt } })
    setMask(null)
    if (payload.generate) await generate(mask.node.id, payload.prompt)
  }
  const renderPanel = (node: CanvasNodeData) => {
    if (node.type === 'group' || node.type === 'text') return null
    const config = node.metadata || {}
    const inputs = getNodeInputs(node.id, nodes, project.connections)
    return (
      <div
        data-canvas-no-zoom
        className="rounded-2xl border p-3 shadow-xl"
        style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex cursor-move items-center justify-between text-xs" onPointerDown={(event) => dragStart(event, node.id)}>
          <span className="flex items-center gap-2">
            <Settings2 className="size-3.5" />
            {node.type === 'config' ? '生成配置' : '图片创作'}
          </span>
          {imageActions(node)}
        </div>
        <textarea
          className="min-h-24 w-full resize-y rounded-lg border bg-transparent p-2 text-sm outline-none focus:border-blue-500"
          style={{ borderColor: theme.node.stroke }}
          aria-label="节点提示词"
          placeholder="描述画面，或连接文本节点作为提示词…"
          value={config.prompt || ''}
          onChange={(event) => run(patchNode(node.id, { metadata: { prompt: event.target.value } }))}
        />
        <div className="my-2 text-[11px] opacity-50">
          已连接 {inputs.filter((item) => item.type === 'text').length} 段文本 · {inputs.filter((item) => item.type === 'image').length} 张参考图
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <select
            className="min-w-0 flex-1 rounded-lg border bg-transparent p-2"
            aria-label="生成模型"
            value={config.model || settings.model}
            onChange={(event) => run(patchNode(node.id, { metadata: { model: event.target.value } }))}
          >
            {models.length ? (
              models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))
            ) : (
              <option value={settings.model}>{settings.model || '当前模型'}</option>
            )}
          </select>
          <select
            className="rounded-lg border bg-transparent p-2"
            aria-label="画面尺寸"
            value={config.size || 'auto'}
            onChange={(event) => run(patchNode(node.id, { metadata: { size: event.target.value } }))}
          >
            {['auto', '1024x1024', '1536x1024', '1024x1536'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            className="rounded-lg border bg-transparent p-2"
            aria-label="生成数量"
            value={config.count || 1}
            onChange={(event) => run(patchNode(node.id, { metadata: { count: Number(event.target.value) } }))}
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value} 张
              </option>
            ))}
          </select>
        </div>
        {config.maskImageId && (
          <div className="mt-2 flex items-center justify-between text-xs text-blue-400">
            <span>已设置局部重绘遮罩</span>
            <button
              type="button"
              className="underline"
              onClick={() => run(patchNode(node.id, { metadata: { maskImageId: undefined, maskTargetImageId: undefined } }))}
            >
              移除
            </button>
          </div>
        )}
        {config.outputErrors?.length ? (
          <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
            <p>
              成功 {config.images?.length || (config.imageId ? 1 : 0)} 张 · 失败 {config.outputErrors.length} 张
            </p>
            {config.outputErrors.map((item) => (
              <p key={item.requestIndex} className="mt-1 break-words">
                第 {item.requestIndex + 1} 张：{item.error}
              </p>
            ))}
            {config.taskId && (
              <button type="button" className="mt-2 underline" onClick={() => useStore.getState().setDetailTaskId(config.taskId!)}>
                查看任务详情
              </button>
            )}
          </div>
        ) : null}
        {models.find((model) => model.id === (config.model || settings.model)) && (
          <div className="mt-2 text-[11px] opacity-50">
            本次预计 ¥{((models.find((model) => model.id === (config.model || settings.model))?.price_cny || 0) * (config.count || 1)).toFixed(2)}
          </div>
        )}
        <Button className="mt-3 w-full" type="primary" icon={<Play className="size-3.5" />} onClick={() => run(generate(node.id))}>
          生成图片
        </Button>
      </div>
    )
  }
  const finishResize = useCallback(
    (_id: string, cancelled = false) => {
      if (!cancelled && draftRef.current)
        run(useCanvasStore.getState().updateProject(project.id, { nodes: draftRef.current }, { expectedRevision: revisionRef.current }))
      draftRef.current = null
      setDraftNodes(null)
      viewportPersistence.endInteraction()
    },
    [project.id, run, viewportPersistence],
  )
  const onResize = useCallback((id: string, width: number, height: number, position?: Position) => {
    const current = draftRef.current || latest.current.project.nodes
    draftRef.current = current.map((node) => (node.id === id ? { ...node, width, height, position: position || node.position } : node))
    setDraftNodes(draftRef.current)
  }, [])
  const confirmCrop = async (rect: CanvasImageCropRect) => {
    if (!crop) return
    const image = await loadImage(crop.url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * rect.width))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * rect.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持图像裁剪')
    ctx.drawImage(image, image.naturalWidth * rect.x, image.naturalHeight * rect.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const result = await storeImageWithSize(canvas.toDataURL('image/png'))
    await patchNode(crop.node.id, {
      ...fitNodeSize(canvas.width, canvas.height, 420, 420),
      metadata: {
        imageId: result.id,
        storageKey: result.id,
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
        images: undefined,
        primaryImageId: undefined,
        maskImageId: undefined,
        maskTargetImageId: undefined,
      },
    })
    setCrop(null)
  }

  return (
    <div className="flex h-full min-h-0 w-full" style={{ background: theme.canvas.background, color: theme.node.text }}>
      <CanvasSidePanel
        nodes={nodes}
        selectedNodeIds={selected}
        onInsertAsset={(asset) => run(insertAsset(asset))}
        onPreviewNode={(id) => {
          const node = nodes.find((item) => item.id === id)
          if (node) run(previewImage(node))
        }}
        onFocusNode={(id) => {
          const node = nodes.find((item) => item.id === id)
          if (!node) return
          choose([id])
          onViewportChange({
            k: Math.min(1, viewport.k),
            x: size.width / 2 - (node.position.x + node.width / 2) * Math.min(1, viewport.k),
            y: size.height / 2 - (node.position.y + node.height / 2) * Math.min(1, viewport.k),
          })
        }}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <CanvasTopBar
          title={project.title}
          titleDraft={titleDraft}
          isTitleEditing={titleEditing}
          onTitleDraftChange={setTitleDraft}
          onStartTitleEditing={() => {
            setTitleDraft(project.title)
            setTitleEditing(true)
          }}
          onFinishTitleEditing={() => {
            if (titleDraft === project.title) setTitleEditing(false)
            else
              run(
                useCanvasStore
                  .getState()
                  .renameProject(project.id, titleDraft)
                  .then(() => setTitleEditing(false)),
              )
          }}
          onCancelTitleEditing={() => setTitleEditing(false)}
          canUndo={Boolean(history?.past.length)}
          canRedo={Boolean(history?.future.length)}
          onHome={() => onOpenProject('')}
          onProjects={() => onOpenProject('')}
          onCreateProject={() =>
            run(
              useCanvasStore
                .getState()
                .createProject()
                .then((item) => onOpenProject(item.id)),
            )
          }
          onDeleteProject={() =>
            modal.confirm({
              title: '将画布移入回收站？',
              content: '作品素材会保留，画布可在回收站恢复。',
              okText: '移入回收站',
              cancelText: '取消',
              onOk: async () => {
                await useCanvasStore.getState().hideProject(project.id)
                onOpenProject('')
              },
            })
          }
          onExportProject={() => run(exportCanvasProjects([project], project.title))}
          onImportImage={() => inputRef.current?.click()}
          onUndo={() => run(useCanvasStore.getState().undo(project.id))}
          onRedo={() => run(useCanvasStore.getState().redo(project.id))}
          agentOpen={false}
          onToggleAgent={() => onOpenAgent(project.id)}
        />
        <InfiniteCanvas
          containerRef={containerRef}
          viewport={viewport}
          tool={canvasTool}
          backgroundMode={project.backgroundMode}
          onViewportChange={onViewportChange}
          onCanvasMouseDown={beginSelection}
          onCanvasDeselect={() => choose([])}
          onCanvasDoubleClick={(event) => {
            const rect = containerRef.current!.getBoundingClientRect()
            setCreateAt({ x: event.clientX - rect.left, y: event.clientY - rect.top })
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            const rect = containerRef.current!.getBoundingClientRect()
            setCreateAt({ x: event.clientX - rect.left, y: event.clientY - rect.top })
          }}
          onDrop={(event) => {
            event.preventDefault()
            run(upload(event.dataTransfer.files, world(event.clientX, event.clientY)))
          }}
        >
          <svg className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible">
            {project.connections
              .filter((conn) => visibleIds.has(conn.fromNodeId) || visibleIds.has(conn.toNodeId))
              .map((conn) => {
                const from = nodes.find((node) => node.id === conn.fromNodeId)
                const to = nodes.find((node) => node.id === conn.toNodeId)
                return from && to ? (
                  <ConnectionPath
                    key={conn.id}
                    connection={conn}
                    from={from}
                    to={to}
                    active={selectedConnection === conn.id}
                    onSelect={() => {
                      setSelectedConnection(conn.id)
                      choose([])
                    }}
                    onContextMenu={(event) => {
                      setSelectedConnection(conn.id)
                      setMenu({ type: 'connection', connectionId: conn.id, x: event.clientX, y: event.clientY })
                    }}
                  />
                ) : null
              })}
            {connecting && (
              <ActiveConnectionPath
                node={nodes.find((node) => node.id === connecting.nodeId)}
                handle={connecting}
                mouseWorld={mouseWorld}
                target={nodes.find((node) => node.id === connectionTarget)}
              />
            )}
          </svg>
          {visibleNodes.map((node) => (
            <CanvasNode
              key={node.id}
              data={node}
              scale={viewport.k}
              isSelected={selected.has(node.id)}
              isRelated={project.connections.some((conn) => conn.fromNodeId === hovered && conn.toNodeId === node.id)}
              isFocusRelated={false}
              isConnectionTarget={connectionTarget === node.id}
              isConnecting={Boolean(connecting)}
              showPanel={selected.size === 1 && selected.has(node.id) && node.type === 'image'}
              showImageInfo={project.showImageInfo}
              mentionReferences={buildNodeMentionReferences(node, nodes, project.connections)}
              renderPanel={renderPanel}
              renderNodeContent={renderPanel}
              groupChildCount={nodes.filter((item) => item.metadata?.groupId === node.id).length}
              batchExpanded={expanded.has(node.id)}
              onPointerDown={dragStart}
              onHoverStart={setHovered}
              onHoverEnd={() => setHovered(null)}
              onConnectStart={(event, nodeId, handleType) => {
                event.preventDefault()
                event.stopPropagation()
                const handle = { nodeId, handleType }
                connectingRef.current = handle
                setConnecting(handle)
                setMouseWorld(world(event.clientX, event.clientY))
              }}
              onResizeStart={() => {
                viewportPersistence.beginInteraction()
                const snapshot = useCanvasStore.getState().getSnapshot(project.id)
                revisionRef.current = snapshot.revision
                draftRef.current = snapshot.nodes
              }}
              onResize={onResize}
              onResizeEnd={finishResize}
              onContentChange={(id, content) => run(patchNode(id, { metadata: { content } }))}
              onTitleChange={(id, title) => run(patchNode(id, { title }))}
              onToggleBatch={(id) =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  next.has(id) ? next.delete(id) : next.add(id)
                  return next
                })
              }
              onSetBatchPrimary={(id, imageId) => {
                const image = node.metadata?.images?.find((item) => item.id === imageId)
                if (image)
                  run(
                    patchNode(id, {
                      metadata: {
                        primaryImageId: imageId,
                        imageId: image.storageKey,
                        storageKey: image.storageKey,
                        maskImageId: undefined,
                        maskTargetImageId: undefined,
                      },
                    }),
                  )
              }}
              onDownloadBatchImage={(_node, imageId) =>
                run(
                  (async () => {
                    const image = node.metadata?.images?.find((item) => item.id === imageId)
                    const url = image?.storageKey ? await ensureImageCached(image.storageKey) : undefined
                    if (!url) throw new Error('原图不可用')
                    downloadCanvasBlob(await (await fetch(url)).blob(), `${node.title}.png`)
                  })(),
                )
              }
              onDuplicateBatchImage={(_node, imageId) => {
                const image = node.metadata?.images?.find((item) => item.id === imageId)
                if (image?.storageKey) run(insertAsset({ kind: 'image', imageId: image.storageKey, title: node.title }))
              }}
              onDeleteBatchImage={(id, imageId) => {
                const images = node.metadata?.images?.filter((item) => item.id !== imageId) || []
                run(
                  patchNode(id, {
                    metadata: {
                      images,
                      primaryImageId: images[0]?.id,
                      imageId: images[0]?.storageKey,
                      storageKey: images[0]?.storageKey,
                      maskImageId: undefined,
                      maskTargetImageId: undefined,
                    },
                  }),
                )
              }}
              onRetry={(item) => run(generate(item.id))}
              onRetryBatchImage={() => run(generate(node.id))}
              onViewImage={(item, imageId) => run(previewImage(item, imageId))}
              onContextMenu={(event, nodeId) => {
                event.stopPropagation()
                choose([nodeId])
                setMenu({ type: 'node', nodeId, x: event.clientX, y: event.clientY })
              }}
            />
          ))}
          {selectionBox && (
            <div
              className="pointer-events-none absolute border border-blue-400 bg-blue-400/10"
              style={{
                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
              }}
            />
          )}
        </InfiniteCanvas>
        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="mb-20 text-center">
              <div className="text-xl font-medium opacity-65">从一个想法开始</div>
              <p className="mt-3 text-sm opacity-35">双击添加节点，或将图片拖入画布</p>
            </div>
          </div>
        )}
        <CanvasSelectionToolbar
          nodes={nodes.filter((node) => selected.has(node.id))}
          viewport={viewport}
          showToolbar={!draftNodes}
          canGroup={canGroupSelectedNodes(selected, nodes)}
          canUngroup={canUngroupSelectedNodes(selected, nodes)}
          onGroup={() => run(groupSelection())}
          onUngroup={() => run(groupSelection(true))}
        />
        <CanvasZoomControls
          scale={viewport.k}
          onScaleChange={(k) =>
            onViewportChange({
              x: size.width / 2 - ((size.width / 2 - viewport.x) / viewport.k) * k,
              y: size.height / 2 - ((size.height / 2 - viewport.y) / viewport.k) * k,
              k,
            })
          }
          onReset={resetView}
          isMiniMapOpen={miniMap}
          onToggleMiniMap={() => setMiniMap(!miniMap)}
        />
        <CanvasToolbar
          selectedCount={selected.size + (selectedConnection ? 1 : 0)}
          canvasTool={canvasTool}
          canUndo={Boolean(history?.past.length)}
          canRedo={Boolean(history?.future.length)}
          backgroundMode={project.backgroundMode}
          showImageInfo={project.showImageInfo}
          onAddImage={() => run(addNode(CanvasNodeType.Image))}
          onAddText={() => run(addNode(CanvasNodeType.Text))}
          onAddConfig={() => run(addNode(CanvasNodeType.Config))}
          onAddGroup={() => run(addNode(CanvasNodeType.Group))}
          onAddExtensionNode={(type) => run(addNode(type))}
          onUndo={() => run(useCanvasStore.getState().undo(project.id))}
          onRedo={() => run(useCanvasStore.getState().redo(project.id))}
          onUpload={() => inputRef.current?.click()}
          onDelete={removeSelection}
          onClear={() =>
            modal.confirm({
              title: '清空画布中的节点？',
              content: '可以使用撤销恢复，图片素材会继续保留。',
              okText: '清空',
              cancelText: '取消',
              onOk: () => update({ nodes: [], connections: [] }),
            })
          }
          onCanvasToolChange={setCanvasTool}
          onBackgroundModeChange={(backgroundMode) => run(update({ backgroundMode }))}
          onShowImageInfoChange={(showImageInfo) => run(update({ showImageInfo }))}
        />
        {miniMap && <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={onViewportChange} />}
        {createAt && (
          <NodeCreateMenu
            position={createAt}
            onCreate={(type) => run(addNode(type, { x: (createAt.x - viewport.x) / viewport.k, y: (createAt.y - viewport.y) / viewport.k }))}
            onClose={() => setCreateAt(null)}
          />
        )}
        {menu && (
          <CanvasNodeContextMenu
            menu={menu}
            canCaptureVideoFrame={false}
            canGroup={canGroupSelectedNodes(selected, nodes)}
            canUngroup={canUngroupSelectedNodes(selected, nodes)}
            onClose={() => setMenu(null)}
            onCaptureVideoFrame={() => setMenu(null)}
            onDuplicate={() => {
              copySelection()
              run(pasteSelection())
              setMenu(null)
            }}
            onGroup={() => run(groupSelection())}
            onUngroup={() => run(groupSelection(true))}
            onDelete={removeSelection}
          />
        )}
        {(saveError || project.cloudSyncError || [...project.title].length > 200) && (
          <div
            role="alert"
            className="absolute left-1/2 top-20 z-[100] -translate-x-1/2 rounded-xl border border-amber-600 bg-amber-950 p-3 text-xs text-amber-200"
          >
            {saveError || project.cloudSyncError || '标题超过 200 个字符，请重命名后继续云同步；原内容已保留'}
            {saveError ? (
              <button className="ml-3 underline" onClick={() => run(useCanvasStore.getState().saveProject(project.id))}>
                重试保存
              </button>
            ) : [...project.title].length > 200 ? (
              <button
                className="ml-3 underline"
                onClick={() => {
                  setTitleDraft(project.title)
                  setTitleEditing(true)
                }}
              >
                重命名
              </button>
            ) : (
              <button className="ml-3 underline" onClick={() => run(import('../../lib/cloudSync').then((module) => module.triggerCloudSync()))}>
                重新同步
              </button>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) run(upload(event.target.files))
            event.target.value = ''
          }}
        />
        <Modal open={Boolean(preview)} onCancel={() => setPreview(null)} footer={null} width="90vw" centered>
          <img src={preview || undefined} alt="画布图片预览" className="mx-auto max-h-[80vh] object-contain" />
        </Modal>
        {crop && <CanvasNodeCropDialog dataUrl={crop.url} open onClose={() => setCrop(null)} onConfirm={(rect) => run(confirmCrop(rect))} />}
        {mask && <CanvasNodeMaskEditDialog dataUrl={mask.url} open onClose={() => setMask(null)} onConfirm={(payload) => run(confirmMask(payload))} />}
      </div>
    </div>
  )
}
