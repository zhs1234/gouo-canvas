import { ensureImageCached } from '../../store'
import { getImage, getImageThumbnail, getStoredFreshImageThumbnail, storeImageWithSize } from '../db'
import { fileToDataUrl } from '../dataUrl'
import { loadImage } from '../canvasImage'
import type { CanvasNodeData } from './types'

const previews = new Map<string, string>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const previewOwners = new Map<symbol, Set<string>>()
let revision = 0

function trimImagePreviews() {
  if (previews.size <= 400) return false
  let changed = false
  const visible = new Set([...previewOwners.values()].flatMap((ids) => [...ids]))
  for (const id of previews.keys()) {
    if (previews.size <= 400) break
    if (!visible.has(id)) {
      previews.delete(id)
      changed = true
    }
  }
  return changed
}

export function setCanvasImagePreviewOwner(owner: symbol, ids: Iterable<string>) {
  previewOwners.set(owner, new Set(ids))
  if (trimImagePreviews()) {
    revision += 1
    listeners.forEach((listener) => listener())
  }
}

export function releaseCanvasImagePreviewOwner(owner: symbol) {
  previewOwners.delete(owner)
  if (trimImagePreviews()) {
    revision += 1
    listeners.forEach((listener) => listener())
  }
}

export function subscribeImagePreviews(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function getImagePreviewRevision() {
  return revision
}
export function previewUrlFor(id?: string) {
  return id ? previews.get(id) : undefined
}

export async function ensureCanvasImagePreview(id: string) {
  if (previews.has(id)) return
  if (pending.has(id)) return pending.get(id)
  const promise = getStoredFreshImageThumbnail(id)
    .then(async (thumbnail) => {
      const url = thumbnail?.thumbnailDataUrl || (await getImageThumbnail(id))?.thumbnailDataUrl
      if (!url) return
      previews.set(id, url)
      // 当前可见工作集可以超过上限；仅淘汰离屏图片，避免加载与淘汰相互触发。
      trimImagePreviews()
      revision += 1
      listeners.forEach((listener) => listener())
    })
    .finally(() => {
      pending.delete(id)
    })
  pending.set(id, promise)
  return promise
}

export async function uploadCanvasImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请上传 PNG、JPEG、WebP 或 GIF 图片')
  if (file.size > 30 * 1024 * 1024) throw new Error('单张图片不能超过 30 MB')
  const dataUrl = await fileToDataUrl(file)
  const result = await storeImageWithSize(dataUrl)
  await ensureCanvasImagePreview(result.id)
  return {
    imageId: result.id,
    storageKey: result.id,
    content: '',
    naturalWidth: result.width || 340,
    naturalHeight: result.height || 240,
    bytes: file.size,
    mimeType: file.type,
    status: 'success' as const,
  }
}

export async function imageToDataUrl(image: { storageKey?: string; url?: string }) {
  if (!image.storageKey) throw new Error('图片缺少素材 ID，请重新导入')
  const dataUrl = await ensureImageCached(image.storageKey)
  if (!dataUrl) throw new Error('无法读取原图，请检查云同步状态')
  return dataUrl
}

export function displayCanvasNodes(nodes: CanvasNodeData[]): CanvasNodeData[] {
  return nodes.map((node) =>
    node.type === 'image'
      ? {
          ...node,
          metadata: {
            ...node.metadata,
            content: previewUrlFor(node.metadata?.imageId || node.metadata?.storageKey) || '',
            images: node.metadata?.images?.map((image) => ({ ...image, content: previewUrlFor(image.storageKey) || '' })),
          },
        }
      : node,
  )
}

export async function readImageMeta(dataUrl: string) {
  const image = await loadImage(dataUrl)
  return { width: image.naturalWidth, height: image.naturalHeight, mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] || 'image/png' }
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}

export async function canvasImageMetadata(id: string) {
  const image = await getImage(id)
  if (!image) throw new Error('图片不存在')
  return { imageId: id, storageKey: id, content: '', naturalWidth: image.width || 340, naturalHeight: image.height || 240, status: 'success' as const }
}
