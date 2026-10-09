import { strFromU8, strToU8, zipSync } from 'fflate'
import { ensureImageCached } from '../../store'
import { markCanvasPersisted, useCanvasStore } from '../../stores/canvasStore'
import { bytesToDataUrl, dataUrlToBytes } from '../dataUrl'
import { hashDataUrl, importTaskData } from '../db'
import { unzipWithLimits } from '../exportZip'
import type { StoredImage } from '../../types'
import { isRecord, referencedCanvasImageIds, serializeCanvasProject, validateCanvasProject } from './document'
import type { CanvasNodeData, CanvasProject } from './types'

export function downloadCanvasBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.replace(/[<>:"/\\|?*]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportCanvasProjects(projects: CanvasProject[], name = '光构画布') {
  const files: Record<string, Uint8Array> = {}
  const assets: Record<string, string> = {}
  for (const id of new Set(projects.flatMap(referencedCanvasImageIds))) {
    const dataUrl = await ensureImageCached(id)
    if (!dataUrl) throw new Error(`缺少原图 ${id}，请完成云同步后重试导出`)
    const image = dataUrlToBytes(dataUrl)
    const path = `images/${Object.keys(assets).length}.${image.ext}`
    assets[id] = path
    files[path] = image.bytes
  }
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'gouo-canvas', version: 1, projects: projects.map(serializeCanvasProject), assets }))
  downloadCanvasBlob(new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), `${name}.gouo-canvas.zip`)
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], name: string) {
  const now = Date.now()
  const project: CanvasProject = {
    id: crypto.randomUUID(),
    title: name,
    nodes: nodes.map((node) => ({
      ...node,
      metadata: { ...node.metadata, groupId: nodes.some((group) => group.id === node.metadata?.groupId) ? node.metadata?.groupId : undefined },
    })),
    connections: [],
    viewport: { x: 100, y: 100, k: 1 },
    backgroundMode: 'lines',
    showImageInfo: false,
    revision: 1,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
  await exportCanvasProjects([project], name)
}

export async function importCanvasArchive(file: File): Promise<CanvasProject[]> {
  if (file.size > 100 * 1024 * 1024) throw new Error('画布备份不能超过 100 MB')
  const files = unzipWithLimits(new Uint8Array(await file.arrayBuffer()), {
    maxEntry: 100 * 1024 * 1024,
    maxTotal: 300 * 1024 * 1024,
    allow: (name) => name === 'manifest.json' || /^images\/\d+\.(png|jpg|jpeg|webp|gif)$/.test(name),
  })
  if (!files['manifest.json']) throw new Error('不是光构画布备份')
  const value: unknown = JSON.parse(strFromU8(files['manifest.json']))
  if (
    !isRecord(value) ||
    value.format !== 'gouo-canvas' ||
    value.version !== 1 ||
    !Array.isArray(value.projects) ||
    !value.projects.length ||
    value.projects.length > 100 ||
    !isRecord(value.assets)
  )
    throw new Error('画布备份格式无效')
  for (const project of value.projects) validateCanvasProject(project)
  const projects = value.projects as CanvasProject[]
  const assets = value.assets
  const required = [...new Set(projects.flatMap(referencedCanvasImageIds))]
  const missing = required.find((id) => typeof assets[id] !== 'string' || !files[String(assets[id])])
  if (missing) throw new Error(`备份缺少素材：${missing}`)
  const imageIds = new Map<string, string>()
  const images: StoredImage[] = []
  for (const id of required) {
    const dataUrl = bytesToDataUrl(files[String(assets[id])], String(assets[id]))
    const imageId = await hashDataUrl(dataUrl)
    imageIds.set(id, imageId)
    images.push({ id: imageId, dataUrl, createdAt: Date.now(), source: 'upload' })
  }
  const imported: CanvasProject[] = []
  for (const original of projects) {
    const nodes = original.nodes.map((node) => ({
      ...node,
      metadata: {
        ...node.metadata,
        taskId: undefined,
        requestId: undefined,
        status: node.metadata?.status === 'loading' ? ('idle' as const) : node.metadata?.status,
        imageId: node.metadata?.imageId ? imageIds.get(node.metadata.imageId) : undefined,
        storageKey: node.metadata?.storageKey ? imageIds.get(node.metadata.storageKey) : undefined,
        maskImageId: node.metadata?.maskImageId ? imageIds.get(node.metadata.maskImageId) : undefined,
        maskTargetImageId: node.metadata?.maskTargetImageId ? imageIds.get(node.metadata.maskTargetImageId) : undefined,
        references: node.metadata?.references?.map((id) => imageIds.get(id)!),
        images: node.metadata?.images?.map((image) => ({ ...image, storageKey: image.storageKey ? imageIds.get(image.storageKey) : undefined })),
      },
    }))
    const now = Date.now()
    const project: CanvasProject = {
      id: crypto.randomUUID(),
      title: [...original.title].length <= 196 ? `${original.title}（导入）` : original.title,
      schemaVersion: 1,
      revision: 1,
      nodes,
      connections: original.connections,
      viewport: original.viewport,
      backgroundMode: original.backgroundMode,
      showImageInfo: original.showImageInfo,
      createdAt: now,
      updatedAt: now,
    }
    validateCanvasProject(project)
    imported.push(serializeCanvasProject(project))
  }
  await importTaskData([], images, [], { canvases: imported, conversations: [] })
  imported.forEach(markCanvasPersisted)
  useCanvasStore.setState((state) => ({ projects: [...imported, ...state.projects] }))
  // importTaskData 直接写库，不会触发文档变更事件；需要手动通知云同步上传。
  window.dispatchEvent(new Event('gouo:documents-changed'))
  return imported
}
