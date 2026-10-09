import { useStore, ensureImageCached } from '../../store'
import { useCanvasStore } from '../../stores/canvasStore'
import { submitImageTask } from '../imageTasks'
import { isStorageScopeCurrent } from '../storageScope'
import { getAllTasks } from '../db'
import { validateMaskMatchesImage } from '../canvasImage'
import { createCanvasNode } from './document'
import { getNodeInputs } from './resources'
import { CanvasNodeType } from './types'
import type { TaskParams } from '../../types'

const pending = new Map<string, Promise<string>>()

export function generateCanvasNode(projectId: string, nodeId: string, prompt?: string, allowFullMask = false): Promise<string> {
  const key = `${projectId}:${nodeId}`
  if (pending.has(key)) return pending.get(key)!
  const run = (async () => {
    const store = useCanvasStore.getState()
    await store.hydrate()
    const project = store.getSnapshot(projectId)
    const node = project.nodes.find((item) => item.id === nodeId)
    if (!node) throw new Error('生成节点不存在')
    const running = project.nodes.find(
      (item) =>
        item.metadata?.status === 'loading' && project.connections.some((connection) => connection.fromNodeId === nodeId && connection.toNodeId === item.id),
    )
    if (running?.metadata?.taskId) {
      const task = useStore.getState().tasks.find((item) => item.id === running.metadata?.taskId)
      if (task?.status === 'running') return task.id
    }
    const inputs = getNodeInputs(nodeId, project.nodes, project.connections)
    const isRetry = node.metadata?.status === 'error' && Boolean(node.metadata.requestId)
    const fullPrompt = [
      prompt ?? node.metadata?.composerContent ?? node.metadata?.prompt ?? '',
      ...(isRetry ? [] : inputs.filter((item) => item.type === 'text').map((item) => item.metadata?.content || '')),
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim()
    if (!fullPrompt) throw new Error('请填写提示词，或连接一个文本节点')
    if (node.metadata?.maskImageId) {
      const targetId = node.metadata.maskTargetImageId || node.metadata.imageId
      const target = targetId ? await ensureImageCached(targetId) : undefined
      const mask = await ensureImageCached(node.metadata.maskImageId)
      if (!target || !mask) throw new Error('遮罩或主图不可用，请重新编辑遮罩')
      if ((await validateMaskMatchesImage(mask, target)) === 'full' && !allowFullMask) throw new Error('遮罩覆盖整张图片，请确认全图重绘后再次提交')
    }
    const imageIds = [
      ...new Set(
        [
          ...(node.metadata?.references || []),
          ...(node.type === 'image' && node.metadata?.imageId ? [node.metadata.imageId] : []),
          ...inputs.filter((item) => item.type === 'image').map((item) => item.metadata?.imageId || item.metadata?.storageKey || ''),
        ].filter(Boolean),
      ),
    ]
    const requestId = crypto.randomUUID()
    const output = createCanvasNode(
      CanvasNodeType.Image,
      { x: node.position.x + node.width + 260, y: node.position.y + node.height / 2 },
      {
        prompt: fullPrompt,
        model: node.metadata?.model,
        size: node.metadata?.size,
        quality: node.metadata?.quality,
        count: node.metadata?.count,
        references: imageIds,
        maskImageId: node.metadata?.maskImageId,
        maskTargetImageId: node.metadata?.maskTargetImageId || (node.metadata?.maskImageId ? node.metadata.imageId : undefined),
        status: 'loading',
        requestId,
      },
    )
    output.title = `${node.title} · 生成结果`
    await store.updateProject(
      projectId,
      { nodes: [...project.nodes, output], connections: [...project.connections, { id: crypto.randomUUID(), fromNodeId: nodeId, toNodeId: output.id }] },
      { expectedRevision: project.revision },
    )
    try {
      const taskId = await submitImageTask({
        model: node.metadata?.model,
        maskImageId: node.metadata?.maskImageId,
        maskTargetImageId: node.metadata?.maskTargetImageId || node.metadata?.imageId,
        allowFullMask,
        prompt: fullPrompt,
        params: { size: node.metadata?.size || 'auto', quality: (node.metadata?.quality || 'auto') as TaskParams['quality'], n: node.metadata?.count || 1 },
        inputImageIds: imageIds,
        source: { kind: 'canvas', projectId, nodeId: output.id },
        requestId,
      })
      const latest = store.getSnapshot(projectId)
      await store.updateProject(
        projectId,
        { nodes: latest.nodes.map((item) => (item.id === output.id ? { ...item, metadata: { ...item.metadata, taskId } } : item)) },
        { history: false },
      )
      await reconcileCanvasTasks()
      return taskId
    } catch (err) {
      const latest = store.getSnapshot(projectId)
      await store.updateProject(
        projectId,
        {
          nodes: latest.nodes.map((item) =>
            item.id === output.id
              ? { ...item, metadata: { ...item.metadata, status: 'error', errorDetails: err instanceof Error ? err.message : String(err) } }
              : item,
          ),
        },
        { history: false },
      )
      throw err
    }
  })()
  pending.set(key, run)
  void run.finally(() => pending.delete(key)).catch(() => {})
  return run
}

let reconciling = false
let reconcileAgain = false

export async function reconcileCanvasTasks() {
  if (reconciling) {
    reconcileAgain = true
    return
  }
  if (!isStorageScopeCurrent() || !useCanvasStore.getState().hydrated) return
  reconciling = true
  try {
    do {
      reconcileAgain = false
      const tasks = useStore.getState().tasks
      for (const id of useCanvasStore.getState().projects.map((project) => project.id)) {
        // 前一个项目保存期间可能发生编辑，回填前重新读取当前节点。
        const project = useCanvasStore.getState().projects.find((item) => item.id === id)
        if (!project) continue
        let changed = false
        const nodes = project.nodes.map((node) => {
          if (node.metadata?.status !== 'loading') return node
          const task = tasks.find((item) => item.id === node.metadata?.taskId || (node.metadata?.requestId && item.requestId === node.metadata.requestId))
          if (!task || task.status === 'running') return node
          changed = true
          const images = task.outputImages.map((id) => ({
            id,
            storageKey: id,
            content: '',
            status: 'success' as const,
            naturalWidth: 0,
            naturalHeight: 0,
            bytes: 0,
            mimeType: `image/${task.params.output_format}`,
          }))
          return {
            ...node,
            metadata: {
              ...node.metadata,
              taskId: task.id,
              imageId: task.outputImages[0],
              storageKey: task.outputImages[0],
              images,
              primaryImageId: task.outputImages[0],
              maskImageId: images.length ? undefined : node.metadata.maskImageId,
              maskTargetImageId: images.length ? undefined : node.metadata.maskTargetImageId,
              status: task.status === 'done' || images.length ? ('success' as const) : ('error' as const),
              errorDetails: task.error || undefined,
              outputErrors: task.outputErrors,
            },
          }
        })
        if (changed) await useCanvasStore.getState().updateProject(project.id, { nodes }, { history: false })
      }
    } while (reconcileAgain)
  } catch (err) {
    console.error('同步画布生成结果失败', err)
  } finally {
    reconciling = false
  }
}

useStore.subscribe((state, previous) => {
  if (state.tasks !== previous.tasks) void reconcileCanvasTasks()
})
useCanvasStore.subscribe((state, previous) => {
  if (!state.hydrated || previous.hydrated) return
  const loaded = state.projects
  void getAllTasks()
    .then(async (tasks) => {
      for (const project of loaded) {
        const interrupted = new Set(
          project.nodes
            .filter(
              (node) =>
                node.metadata?.status === 'loading' &&
                !tasks.some((task) => task.id === node.metadata?.taskId || (node.metadata?.requestId && task.requestId === node.metadata.requestId)),
            )
            .map((node) => node.id),
        )
        if (!interrupted.size) continue
        const current = useCanvasStore.getState().projects.find((item) => item.id === project.id)
        if (!current) continue
        await useCanvasStore.getState().updateProject(
          project.id,
          {
            nodes: current.nodes.map((node) =>
              interrupted.has(node.id)
                ? { ...node, metadata: { ...node.metadata, status: 'error', errorDetails: '上次提交已中断，请手动重试。不会自动重新生成或扣费。' } }
                : node,
            ),
          },
          { history: false },
        )
      }
      await reconcileCanvasTasks()
    })
    .catch((err) => console.error('恢复画布任务失败', err))
})
