import { describe, expect, it } from 'vitest'
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from './agentOps'
import { createCanvasNode, referencedCanvasImageIds, serializeCanvasProject, validateCanvasProject } from './document'
import { applyGroupSelection, applyUngroupSelection, getGroupWrapRect } from './nodeGeometry'
import { fitNodeSize } from './nodeSize'
import { pinchCanvasViewport, visibleCanvasNodes } from './viewport'
import { CanvasNodeType } from './types'

const empty: CanvasAgentSnapshot = { id: 'canvas', projectId: 'canvas', title: '测试', schemaVersion: 1, revision: 1, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'lines', showImageInfo: false, createdAt: 1, updatedAt: 1 }

describe('画布操作边界', () => {
  it('离线文档可原子添加、连接、更新节点，输入快照不被修改', () => {
    const next = applyCanvasAgentOps(empty, [
      { type: 'add_node', id: 'text', nodeType: 'text', metadata: { content: '一座山' } },
      { type: 'add_node', id: 'config', nodeType: 'config', x: 400 },
      { type: 'connect_nodes', id: 'edge', fromNodeId: 'text', toNodeId: 'config' },
      { type: 'update_node', id: 'text', patch: { position: { x: 20, y: 30 } } },
      { type: 'select_nodes', ids: ['text', 'config'] },
    ])
    expect(empty.nodes).toEqual([])
    expect(next.nodes[0].metadata?.content).toBe('一座山')
    expect(next.nodes[0].position).toEqual({ x: 20, y: 30 })
    expect(next.connections).toHaveLength(1)
    expect(next.selectedNodeIds).toEqual(['text', 'config'])
    expect(() => validateCanvasProject(next)).not.toThrow()
  })

  it.each([
    [{ type: 'add_node', nodeType: 'video' }],
    [{ type: 'add_node', id: 'same' }, { type: 'add_node', id: 'same' }],
    [{ type: 'add_node', width: -100 }],
    [{ type: 'add_node', position: { x: Number.NaN, y: 0 } }],
    [{ type: 'connect_nodes', fromNodeId: 'missing', toNodeId: 'other' }],
    [{ type: 'set_viewport', viewport: { x: 0, y: 0, k: Number.POSITIVE_INFINITY } }],
    [{ type: 'add_node', metadata: { apiKey: 'secret' } }],
    [{ type: 'add_node', nodeType: 'image', metadata: { content: 'https://untrusted.example/image.png' } }],
    [{ type: 'constructor' }],
    [JSON.parse('{"type":"add_node","__proto__":{"polluted":true}}')],
    [{ type: 'run_generation', nodeId: 'x' }],
  ].map((ops) => ({ ops })))('拒绝非法工具操作 %#，原快照保持完整', ({ ops }) => {
    expect(() => applyCanvasAgentOps(empty, ops)).toThrow()
    expect(empty.nodes).toEqual([])
  })

  it('删除分组释放成员并清理边，不产生悬挂引用', () => {
    const snapshot = applyCanvasAgentOps(empty, [
      { type: 'add_node', id: 'group', nodeType: 'group' },
      { type: 'add_node', id: 'child', metadata: { groupId: 'group' } },
      { type: 'connect_nodes', fromNodeId: 'group', toNodeId: 'child' },
    ])
    const result = applyCanvasAgentOps(snapshot, [{ type: 'delete_node', id: 'group' }])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].metadata?.groupId).toBeUndefined()
    expect(result.connections).toEqual([])
  })

  it('存储只清除图片显示缓存，保留文本和所有素材引用', () => {
    const text = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 }, { content: '文字保留' })
    const image = createCanvasNode(CanvasNodeType.Image, { x: 100, y: 0 }, { content: 'data:image/png;base64,preview', imageId: 'original', storageKey: 'original', references: ['reference'], images: [{ id: 'batch', storageKey: 'second', content: 'blob:preview', status: 'success', naturalWidth: 1024, naturalHeight: 1024, bytes: 2, mimeType: 'image/png' }] })
    const saved = serializeCanvasProject({ ...empty, nodes: [text, image] })
    expect(saved.nodes[0].metadata?.content).toBe('文字保留')
    expect(saved.nodes[1].metadata?.content).toBe('')
    expect(saved.nodes[1].metadata?.images?.[0].content).toBe('')
    expect(referencedCanvasImageIds(saved)).toEqual(['original', 'reference', 'second'])
  })
})

describe('复用的分组与视口几何', () => {
  it('双指缩放保持手势中心下的世界坐标，并限制缩放范围', () => {
    const result = pinchCanvasViewport({ x: 10, y: 20, k: 1 }, { x: 110, y: 120 }, { x: 210, y: 220 }, 100, 200)
    expect(result).toEqual({ x: 10, y: 20, k: 2 })
    expect((210 - result.x) / result.k).toBe(100)
    expect(pinchCanvasViewport(result, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 100).k).toBe(5)
  })
  it('分组、解组保留内容、位置和连接', () => {
    const first = createCanvasNode(CanvasNodeType.Text, { x: 200, y: 200 }, { content: 'A' })
    const second = createCanvasNode(CanvasNodeType.Image, { x: 600, y: 200 }, { imageId: 'image' })
    const group = createCanvasNode(CanvasNodeType.Group, { x: 0, y: 0 })
    const rect = getGroupWrapRect([first, second])
    group.position = { x: rect.x, y: rect.y }
    group.width = rect.width
    group.height = rect.height
    const connections = [{ id: 'edge', fromNodeId: first.id, toNodeId: second.id }]
    const result = applyGroupSelection(new Set([first.id, second.id]), [first, second], connections, group)!
    expect(result.nodes).toHaveLength(3)
    const restored = applyUngroupSelection(new Set([group.id]), result.nodes, result.connections)!
    expect(restored.nodes).toHaveLength(2)
    expect(restored.nodes[0].metadata?.content).toBe('A')
    expect(restored.nodes[0].position).toEqual(first.position)
    expect(restored.connections).toEqual(connections)
  })

  it('分组、解组不删除画布上本来就空着的分组', () => {
    const first = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 })
    const second = createCanvasNode(CanvasNodeType.Text, { x: 300, y: 0 })
    const frame = createCanvasNode(CanvasNodeType.Group, { x: 1000, y: 1000 })
    const group = createCanvasNode(CanvasNodeType.Group, { x: 0, y: 0 })
    const grouped = applyGroupSelection(new Set([first.id, second.id]), [frame, first, second], [], group)!
    expect(grouped.nodes.map((node) => node.id)).toContain(frame.id)
    const released = applyUngroupSelection(new Set([group.id]), grouped.nodes, grouped.connections)!
    expect(released.nodes.map((node) => node.id)).toContain(frame.id)
    // 成员全部移走后变空的旧分组仍然清理
    const regrouped = applyGroupSelection(new Set([first.id, second.id]), grouped.nodes, [], createCanvasNode(CanvasNodeType.Group, { x: 0, y: 0 }))!
    expect(regrouped.nodes.map((node) => node.id)).not.toContain(group.id)
  })

  it('小图标和细长横幅的节点尺寸不低于画布校验下限', () => {
    expect(fitNodeSize(16, 16, 420, 420)).toEqual({ width: 20, height: 20 })
    const banner = fitNodeSize(4000, 100, 420, 420)
    expect(banner.width).toBe(420)
    expect(banner.height).toBe(20)
    const node = { ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { imageId: 'icon' }), ...banner }
    expect(() => validateCanvasProject({ ...empty, nodes: [node] })).not.toThrow()
  })

  it('1000个文本和100个图片只挂载可见区，并保留完整文档', () => {
    const nodes = Array.from({ length: 1100 }, (_, index) => createCanvasNode(index < 1000 ? CanvasNodeType.Text : CanvasNodeType.Image, { x: (index % 20) * 500, y: Math.floor(index / 20) * 400 }))
    const start = performance.now()
    for (let index = 0; index < 100; index++) {
      const visible = visibleCanvasNodes(nodes, { x: -index * 40, y: -index * 20, k: 1 }, { width: 1200, height: 800 })
      expect(visible.length).toBeLessThan(40)
    }
    expect(performance.now() - start).toBeLessThan(1500)
    expect(nodes).toHaveLength(1100)
    expect(visibleCanvasNodes(nodes, { x: -9000, y: -20000, k: 1 }, { width: 1200, height: 800 }).some((node) => node.type === 'image')).toBe(true)
  })
})
