// 基于 basketikun/infinite-canvas 的内置节点注册信息；仅保留平台支持的节点。
import { Group, Image as ImageIcon, FileText, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from './types'

interface NodeDefinition {
  type: string
  title: string
  description?: string
  icon: ReactNode
  defaultSize: { width: number; height: number }
  defaultMetadata: CanvasNodeMetadata
  minimapColor?: string
  showInCreateMenu?: boolean
  hasSourceHandle?: boolean
  interactionToggle?: boolean
  transparentBackground?: boolean
  forceInteractive?: (node: CanvasNodeData) => boolean
  keepAspectRatio?: (node: CanvasNodeData) => boolean
}

const definitions: NodeDefinition[] = [
  {
    type: CanvasNodeType.Text,
    title: '文本',
    icon: <FileText className="size-5" />,
    defaultSize: { width: 340, height: 240 },
    defaultMetadata: { content: '', status: 'idle', fontSize: 14 },
  },
  {
    type: CanvasNodeType.Image,
    title: '图片',
    icon: <ImageIcon className="size-5" />,
    defaultSize: { width: 340, height: 240 },
    defaultMetadata: { content: '', status: 'idle' },
    minimapColor: '#10b981',
    keepAspectRatio: (node) => !node.metadata?.freeResize,
  },
  {
    type: CanvasNodeType.Config,
    title: '生成配置',
    icon: <Settings2 className="size-5" />,
    defaultSize: { width: 340, height: 320 },
    defaultMetadata: { content: '', status: 'idle', generationMode: 'image' },
    minimapColor: '#60a5fa',
    hasSourceHandle: false,
  },
  {
    type: CanvasNodeType.Group,
    title: '分组',
    icon: <Group className="size-5" />,
    defaultSize: { width: 760, height: 480 },
    defaultMetadata: { status: 'idle' },
    minimapColor: '#94a3b8',
  },
]

export function getNodeDefinition(type: string) {
  return definitions.find((def) => def.type === type)
}
export function listNodeDefinitions() {
  return definitions
}
export function isRegisteredNodeType(type: string) {
  return definitions.some((def) => def.type === type)
}
export function getNodePluginId(_type: string) {
  return 'builtin'
}
export function useNodeRegistryVersion() {
  return 0
}
export function getNodeSpec(type: string) {
  const def = getNodeDefinition(type)
  if (!def) throw new Error('暂不支持这种节点类型')
  return { ...def.defaultSize, title: def.title, metadata: def.defaultMetadata }
}
