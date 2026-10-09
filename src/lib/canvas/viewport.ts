import type { CanvasNodeData, ViewportTransform } from './types'
import type { Position } from './types'

// 交互开始前提交视口，交互期间暂缓保存，避免自身保存改变节点拖动的版本基线。
export function createCanvasViewportPersistence(save: (viewport: ViewportTransform) => void) {
  let pending: ViewportTransform | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let interacting = false
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending) return
    const next = pending
    pending = undefined
    save(next)
  }
  return {
    schedule(next: ViewportTransform) {
      pending = next
      if (timer) clearTimeout(timer)
      timer = undefined
      if (!interacting) timer = setTimeout(flush, 350)
    },
    beginInteraction() {
      flush()
      interacting = true
    },
    endInteraction() {
      interacting = false
      flush()
    },
    dispose() {
      interacting = false
      flush()
    },
  }
}

// 屏幕边缘留出工具面板空间；大画布仅挂载可见节点，文档和小地图仍保留完整数据。
export function visibleCanvasNodes(nodes: CanvasNodeData[], viewport: ViewportTransform, size: { width: number; height: number }, margin = 360) {
  const left = (-viewport.x - margin) / viewport.k
  const top = (-viewport.y - margin) / viewport.k
  const right = (size.width - viewport.x + margin) / viewport.k
  const bottom = (size.height - viewport.y + margin) / viewport.k
  return nodes.filter(
    (node) => node.position.x <= right && node.position.x + node.width >= left && node.position.y <= bottom && node.position.y + node.height >= top,
  )
}

export function pinchCanvasViewport(
  viewport: ViewportTransform,
  start: Position,
  next: Position,
  startDistance: number,
  nextDistance: number,
): ViewportTransform {
  const k = Math.max(0.05, Math.min(5, viewport.k * (startDistance > 0 ? nextDistance / startDistance : 1)))
  return { x: next.x - ((start.x - viewport.x) / viewport.k) * k, y: next.y - ((start.y - viewport.y) / viewport.k) * k, k }
}
