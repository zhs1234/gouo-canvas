import { getNodeSpec, isRegisteredNodeType } from './nodeRegistry'
import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId, CanvasProject, Position } from './types'

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
  const spec = getNodeSpec(type)
  return {
    id: crypto.randomUUID(),
    type,
    title: spec.title,
    position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
    width: spec.width,
    height: spec.height,
    metadata: { ...spec.metadata, ...metadata },
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateCanvasTitle(title: string) {
  if ([...title.trim()].length > 200) throw new Error('画布标题最多 200 个字符，请缩短标题后保存；原内容不会删除')
}

export function validateCanvasProject(value: unknown): asserts value is CanvasProject {
  // 旧文档保留原始长标题，可打开、导出并重命名；新建与修改标题另行执行 200 字限制。
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.title !== 'string' ||
    [...value.title].length > 500
  )
    throw new Error('画布文档格式无效')
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt))
    throw new Error('画布版本信息无效')
  if (!Array.isArray(value.nodes) || value.nodes.length > 10000 || !Array.isArray(value.connections) || value.connections.length > 30000)
    throw new Error('画布节点或连线过多')
  const ids = new Set<string>()
  for (const node of value.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id) || typeof node.type !== 'string' || !isRegisteredNodeType(node.type))
      throw new Error('画布包含无效或重复节点')
    if (
      typeof node.title !== 'string' ||
      node.title.length > 500 ||
      !isRecord(node.position) ||
      !Number.isFinite(node.position.x) ||
      !Number.isFinite(node.position.y)
    )
      throw new Error('节点名称或坐标无效')
    if (![node.width, node.height].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 20 && n <= 20000)) throw new Error('节点尺寸无效')
    if (node.metadata !== undefined) validateMetadata(node.metadata)
    ids.add(node.id)
  }
  const connectionIds = new Set<string>()
  for (const conn of value.connections) {
    if (
      !isRecord(conn) ||
      typeof conn.id !== 'string' ||
      !conn.id ||
      connectionIds.has(conn.id) ||
      typeof conn.fromNodeId !== 'string' ||
      typeof conn.toNodeId !== 'string' ||
      !ids.has(conn.fromNodeId) ||
      !ids.has(conn.toNodeId) ||
      conn.fromNodeId === conn.toNodeId
    )
      throw new Error('画布连线无效')
    connectionIds.add(conn.id)
  }
  const viewport = value.viewport
  if (
    !isRecord(viewport) ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    typeof viewport.k !== 'number' ||
    !Number.isFinite(viewport.k) ||
    viewport.k < 0.05 ||
    viewport.k > 5
  )
    throw new Error('画布视口无效')
  if (!['dots', 'lines', 'blank'].includes(String(value.backgroundMode)) || typeof value.showImageInfo !== 'boolean') throw new Error('画布显示设置无效')
  for (const node of value.nodes) {
    if (node.metadata?.groupId && !value.nodes.some((group) => group.id === node.metadata.groupId && group.type === 'group' && group.id !== node.id))
      throw new Error('节点分组不存在')
  }
}

export function validateMetadata(value: unknown): asserts value is CanvasNodeMetadata {
  if (!isRecord(value)) throw new Error('节点数据格式无效')
  const strings = [
    'content',
    'composerContent',
    'prompt',
    'status',
    'errorDetails',
    'generationMode',
    'generationType',
    'model',
    'size',
    'quality',
    'background',
    'primaryImageId',
    'storageKey',
    'imageId',
    'maskImageId',
    'maskTargetImageId',
    'taskId',
    'requestId',
    'mimeType',
    'groupId',
  ]
  const numbers = ['fontSize', 'count', 'naturalWidth', 'naturalHeight', 'bytes']
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue
    if (strings.includes(key) && typeof val === 'string' && val.length <= 100000) continue
    if (numbers.includes(key) && typeof val === 'number' && Number.isFinite(val) && val >= 0) continue
    if ((key === 'freeResize' || key === 'interactive') && typeof val === 'boolean') continue
    if (key === 'references' && Array.isArray(val) && val.length <= 100 && val.every((id) => typeof id === 'string' && id.length <= 500)) continue
    if (
      key === 'outputErrors' &&
      Array.isArray(val) &&
      val.length <= 100 &&
      val.every(
        (item) =>
          isRecord(item) &&
          Number.isSafeInteger(item.requestIndex) &&
          Number(item.requestIndex) >= 0 &&
          typeof item.error === 'string' &&
          item.error.length <= 100000,
      )
    )
      continue
    if (
      key === 'images' &&
      Array.isArray(val) &&
      val.length <= 100 &&
      val.every(
        (image) =>
          isRecord(image) &&
          typeof image.id === 'string' &&
          typeof image.content === 'string' &&
          image.content.length <= 100000 &&
          ['idle', 'loading', 'success', 'error'].includes(String(image.status)) &&
          [image.naturalWidth, image.naturalHeight, image.bytes].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0),
      )
    )
      continue
    throw new Error(`节点字段无效：${key}`)
  }
  if (value.status !== undefined && !['idle', 'loading', 'success', 'error'].includes(String(value.status))) throw new Error('节点状态无效')
  if (value.generationMode !== undefined && value.generationMode !== 'image') throw new Error('当前仅支持图片生成节点')
}

export function referencedCanvasImageIds(project: Pick<CanvasProject, 'nodes'>) {
  return Array.from(
    new Set(
      project.nodes.flatMap((node) =>
        [
          node.metadata?.imageId,
          node.metadata?.storageKey,
          node.metadata?.maskImageId,
          node.metadata?.maskTargetImageId,
          ...(node.metadata?.references || []),
          ...(node.metadata?.images || []).map((image) => image.storageKey),
        ].filter((id): id is string => Boolean(id)),
      ),
    ),
  )
}

// 存储只保留图片 ID，原图和缩略图由光构的图片仓库统一维护。
export function serializeCanvasProject(project: CanvasProject): CanvasProject {
  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.type !== 'image'
        ? node
        : { ...node, metadata: { ...node.metadata, content: '', images: node.metadata?.images?.map((image) => ({ ...image, content: '' })) } },
    ),
  }
}
