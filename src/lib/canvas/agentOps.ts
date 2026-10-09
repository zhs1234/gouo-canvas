// 基于上游 canvas-agent-ops.ts，增加外部参数校验与原子应用。
import { getNodeSpec, isRegisteredNodeType } from './nodeRegistry'
import { isRecord, validateCanvasProject, validateMetadata } from './document'
import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId, CanvasProject, ViewportTransform } from './types'

export type CanvasAgentOp =
  | {
      type: 'add_node'
      id?: string
      nodeType?: CanvasNodeTypeId
      title?: string
      position?: { x: number; y: number }
      x?: number
      y?: number
      width?: number
      height?: number
      metadata?: CanvasNodeMetadata
    }
  | { type: 'update_node'; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
  | { type: 'delete_node'; id?: string; ids?: string[] }
  | { type: 'delete_connections'; id?: string; ids?: string[]; all?: boolean }
  | { type: 'connect_nodes'; id?: string; fromNodeId: string; toNodeId: string }
  | { type: 'set_viewport'; viewport: ViewportTransform }
  | { type: 'select_nodes'; ids: string[] }

export type CanvasAgentSnapshot = CanvasProject & { projectId: string; selectedNodeIds: string[] }

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, value: unknown): CanvasAgentSnapshot {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('每次必须包含 1–100 个画布操作')
  const next = structuredClone(snapshot)
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.type !== 'string') throw new Error('画布操作格式无效')
    const allowed: Record<string, string[]> = {
      add_node: ['id', 'nodeType', 'title', 'position', 'x', 'y', 'width', 'height', 'metadata'],
      update_node: ['id', 'patch', 'metadata'],
      delete_node: ['id', 'ids'],
      delete_connections: ['id', 'ids', 'all'],
      connect_nodes: ['id', 'fromNodeId', 'toNodeId'],
      set_viewport: ['viewport'],
      select_nodes: ['ids'],
    }
    if (!Object.prototype.hasOwnProperty.call(allowed, raw.type) || Object.keys(raw).some((key) => key !== 'type' && !allowed[raw.type as string].includes(key))) throw new Error('画布操作包含不支持的字段')
    const op = raw as unknown as CanvasAgentOp
    if (op.type === 'add_node') {
      const type = op.nodeType || 'text'
      if (!isRegisteredNodeType(type)) throw new Error('不支持的节点类型')
      if (op.metadata !== undefined) validateMetadata(op.metadata)
      const spec = getNodeSpec(type)
      const id = op.id || crypto.randomUUID()
      const node = {
        id,
        type,
        title: op.title ?? spec.title,
        position: op.position || { x: op.x ?? 0, y: op.y ?? 0 },
        width: op.width ?? spec.width,
        height: op.height ?? spec.height,
        metadata: { ...spec.metadata, ...op.metadata },
      }
      next.nodes.push(node)
      next.selectedNodeIds = [id]
    } else if (op.type === 'update_node') {
      if (typeof op.id !== 'string' || !next.nodes.some((node) => node.id === op.id)) throw new Error('待修改节点不存在')
      if (
        op.patch !== undefined &&
        (!isRecord(op.patch) || Object.keys(op.patch).some((key) => !['title', 'position', 'width', 'height', 'metadata'].includes(key)))
      )
        throw new Error('节点只能修改名称、位置、尺寸和内容')
      if (op.metadata !== undefined) validateMetadata(op.metadata)
      next.nodes = next.nodes.map((node) =>
        node.id === op.id ? { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } } : node,
      )
    } else if (op.type === 'delete_node') {
      const ids = op.ids || (op.id ? [op.id] : [])
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !next.nodes.some((node) => node.id === id)))
        throw new Error('待删除节点不存在')
      const removed = new Set(ids)
      next.nodes = next.nodes
        .filter((node) => !removed.has(node.id))
        .map((node) => (removed.has(node.metadata?.groupId || '') ? { ...node, metadata: { ...node.metadata, groupId: undefined } } : node))
      next.connections = next.connections.filter((conn) => !removed.has(conn.fromNodeId) && !removed.has(conn.toNodeId))
      next.selectedNodeIds = next.selectedNodeIds.filter((id) => !removed.has(id))
    } else if (op.type === 'connect_nodes') {
      if (next.connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId)) continue
      next.connections.push({ id: op.id || crypto.randomUUID(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId })
    } else if (op.type === 'delete_connections') {
      const ids = op.ids || (op.id ? [op.id] : [])
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string') || (op.all !== undefined && typeof op.all !== 'boolean'))
        throw new Error('待删除连线无效')
      next.connections = op.all ? [] : next.connections.filter((conn) => !ids.includes(conn.id))
    } else if (op.type === 'set_viewport') {
      next.viewport = op.viewport
    } else if (op.type === 'select_nodes') {
      if (!Array.isArray(op.ids) || op.ids.some((id) => typeof id !== 'string' || !next.nodes.some((node) => node.id === id)))
        throw new Error('待选择节点不存在')
      next.selectedNodeIds = [...new Set(op.ids)]
    } else throw new Error(`不支持的画布操作：${raw.type}`)
  }
  if (next.nodes.some((node) => node.type === 'image' && (node.metadata?.content || node.metadata?.images?.some((image) => image.content)))) throw new Error('图片节点只能引用已存储的素材 ID')
  validateCanvasProject(next)
  return next
}
