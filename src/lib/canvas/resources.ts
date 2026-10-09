import type { CanvasConnection, CanvasNodeData } from './types'

export type CanvasResourceKind = 'image' | 'text' | 'video' | 'audio'
export type CanvasResourceReference = {
  id: string
  nodeId: string
  kind: CanvasResourceKind
  label: string
  title: string
  previewUrl?: string
  text?: string
  active: boolean
}

export function getNodeInputs(id: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
  const ids = new Set(connections.filter((conn) => conn.toNodeId === id).map((conn) => conn.fromNodeId))
  return nodes.filter((node) => ids.has(node.id) || (node.metadata?.groupId && ids.has(node.metadata.groupId))).filter((node) => node.type !== 'group')
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasResourceReference[] {
  return getNodeInputs(node.id, nodes, connections)
    .filter((item) => item.type === 'image' || item.type === 'text')
    .map((item, index) => ({
      id: item.id,
      nodeId: item.id,
      kind: item.type as 'image' | 'text',
      label: `参考${index + 1}`,
      title: item.title,
      previewUrl: item.type === 'image' ? item.metadata?.content : undefined,
      text: item.type === 'text' ? item.metadata?.content : undefined,
      active: true,
    }))
}
