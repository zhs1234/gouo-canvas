import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import type { AgentConversation, CanvasProject, AppSettings, ExportData, FavoriteCollection, StoredImage, StoredImageThumbnail, TaskRecord } from '../types'
import { bytesToDataUrl, dataUrlToBytes } from './dataUrl'
import { getNumberedFileNameBase, sanitizeFileNamePart } from './exportFileName'
import { isRecord } from './storeInputNormalization'
import { getDocumentImageIds } from './documentAssets'
import { validateCanvasProject } from './canvas/document'

type ZipFiles = Record<string, Uint8Array | [Uint8Array, { mtime: Date }]>

export interface BuildExportZipOptions {
  exportConfig?: boolean
  exportTasks?: boolean
}

export interface BuildExportZipParams {
  canvasProjects?: CanvasProject[]
  agentConversations?: AgentConversation[]
  options: BuildExportZipOptions
  exportedAt: number
  settings: AppSettings
  tasks: TaskRecord[]
  images: StoredImage[]
  thumbnailsByImageId: Map<string, StoredImageThumbnail>
  favoriteCollections: FavoriteCollection[]
  defaultFavoriteCollectionId: string | null
}

export interface ExportZipContents {
  manifest: ExportData
  files: Record<string, Uint8Array>
}

export function buildExportZip(params: BuildExportZipParams) {
  const exportedAtDate = new Date(params.exportedAt)
  const imageCreatedAtFallback = getImageCreatedAtFallback(params.options.exportTasks ? params.tasks : [])
  const imageFileNameBases = getImageFileNameBases(params.options.exportTasks ? params.tasks : [])
  const imageFiles: ExportData['imageFiles'] = {}
  const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
  const zipFiles: ZipFiles = {}
  const usedImagePaths = new Set<string>()

  if (params.options.exportTasks) {
    const imageIds = new Set(params.images.map((image) => image.id))
    for (const id of getImageCreatedAtFallback(params.tasks).keys()) {
      if (!imageIds.has(id)) throw new Error(`备份缺少原图 ${id}，请恢复原图后重试`)
    }
    for (const img of params.images) {
      const { ext, bytes } = dataUrlToBytes(img.dataUrl)
      const path = getUniqueImagePath(imageFileNameBases.get(img.id) || `image-${img.id}`, ext, usedImagePaths)
      const pathBase = path.slice('images/'.length, -(ext.length + 1))
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? params.exportedAt
      imageFiles[img.id] = {
        path,
        createdAt,
        source: img.source,
        width: img.width,
        height: img.height,
      }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]

      const thumbnail = params.thumbnailsByImageId.get(img.id)
      if (thumbnail?.thumbnailDataUrl) {
        const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
        const thumbnailPath = `thumbnails/${pathBase}.${thumbnailExt}`
        imageFiles[img.id].width = imageFiles[img.id].width ?? thumbnail.width
        imageFiles[img.id].height = imageFiles[img.id].height ?? thumbnail.height
        thumbnailFiles[img.id] = {
          path: thumbnailPath,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailVersion: thumbnail.thumbnailVersion,
        }
        zipFiles[thumbnailPath] = [thumbnailBytes, { mtime: new Date(createdAt) }]
      }
    }
  }

  const manifest: ExportData = {
    version: 4,
    exportedAt: exportedAtDate.toISOString(),
  }

  if (params.options.exportConfig) manifest.settings = params.settings
  if (params.options.exportTasks) {
    manifest.canvasProjects = params.canvasProjects
    manifest.agentConversations = params.agentConversations
    manifest.tasks = params.tasks
    manifest.favoriteCollections = params.favoriteCollections
    manifest.defaultFavoriteCollectionId = params.defaultFavoriteCollectionId
    manifest.imageFiles = imageFiles
    manifest.thumbnailFiles = thumbnailFiles
  }

  zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: exportedAtDate }]

  return {
    manifest,
    bytes: zipSync(zipFiles, { level: 6 }),
  }
}

// 全量备份上限：导入在主线程一次性读入内存，超限的文件在分配大块内存前就拒绝
export const MAX_BACKUP_FILE_BYTES = 512 * 1024 * 1024
const MAX_BACKUP_ENTRY_BYTES = 100 * 1024 * 1024
const MAX_BACKUP_TOTAL_BYTES = 1024 * 1024 * 1024

// 按 ZIP 目录里声明的解压体积限制单项和累计大小；fflate 按声明体积分配输出，声明不实也不会多占内存。
export function unzipWithLimits(bytes: Uint8Array, limits: { maxEntry: number; maxTotal: number; allow: (name: string) => boolean }) {
  let total = 0
  return unzipSync(bytes, {
    filter: (entry) => {
      if (!limits.allow(entry.name)) return false
      total += entry.originalSize
      if (entry.originalSize > limits.maxEntry || total > limits.maxTotal) throw new Error('解压后的备份过大')
      return true
    },
  })
}

export function readExportZip(bytes: Uint8Array): ExportZipContents {
  const files = unzipWithLimits(bytes, {
    maxEntry: MAX_BACKUP_ENTRY_BYTES,
    maxTotal: MAX_BACKUP_TOTAL_BYTES,
    allow: (name) => name === 'manifest.json' || name.startsWith('images/') || name.startsWith('thumbnails/'),
  })
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

  const data: unknown = JSON.parse(strFromU8(manifestBytes))
  if (!isRecord(data) || ![2, 3, 4].includes(Number(data.version)) || typeof data.version !== 'number') throw new Error('不支持的备份版本，仅支持 ZIP 版本 2、3、4')
  if (data.exportedAt !== undefined && (typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt)))) throw new Error('备份导出时间无效')
  if (data.settings !== undefined && !isRecord(data.settings)) throw new Error('备份配置格式无效')
  if (data.tasks !== undefined && !Array.isArray(data.tasks)) throw new Error('备份任务列表格式无效')
  if (!data.settings && !data.tasks) throw new Error('备份不包含配置或任务')
  for (const field of ['imageFiles', 'thumbnailFiles']) {
    const entries = data[field]
    if (entries === undefined) continue
    if (!isRecord(entries)) throw new Error(`备份 ${field} 格式无效`)
    for (const [id, info] of Object.entries(entries)) {
      if (!id || !isRecord(info) || typeof info.path !== 'string' || /(^\/|\\|(^|\/)\.\.($|\/))/.test(info.path)) throw new Error(`图片 ${id} 的文件路径无效`)
      if (!Object.prototype.hasOwnProperty.call(files, info.path) || !files[info.path].length) throw new Error(`备份缺少图片文件：${info.path}`)
      for (const key of ['width', 'height', 'createdAt', 'thumbnailVersion']) {
        if (info[key] !== undefined && (typeof info[key] !== 'number' || !Number.isFinite(info[key]) || info[key] < 0)) throw new Error(`图片 ${id} 的 ${key} 无效`)
      }
    }
  }
  const taskIds = new Set<string>()
  for (const task of (data.tasks ?? []) as unknown[]) {
    if (!isRecord(task) || typeof task.id !== 'string' || !task.id || taskIds.has(task.id) || typeof task.prompt !== 'string' || !isRecord(task.params) || !['running', 'done', 'error'].includes(String(task.status)) || typeof task.createdAt !== 'number' || !Number.isFinite(task.createdAt)) throw new Error('备份任务字段无效或 ID 重复')
    taskIds.add(task.id)
    const imageIds: string[] = []
    for (const key of ['inputImageIds', 'outputImages', 'streamPartialImageIds', 'transparentOriginalImages', 'favoriteCollectionIds']) {
      const ids = task[key]
      if (ids === undefined && key !== 'inputImageIds' && key !== 'outputImages') continue
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || (!id && key !== 'transparentOriginalImages'))) throw new Error(`任务 ${task.id} 的 ${key} 无效`)
      if (key !== 'favoriteCollectionIds') imageIds.push(...ids)
    }
    for (const key of ['maskImageId', 'maskTargetImageId']) {
      if (task[key] == null) continue
      if (typeof task[key] !== 'string') throw new Error(`任务 ${task.id} 的 ${key} 无效`)
      imageIds.push(task[key])
    }
    for (const id of imageIds.filter(Boolean)) {
      if (!isRecord(data.imageFiles) || !Object.prototype.hasOwnProperty.call(data.imageFiles, id)) throw new Error(`任务 ${task.id} 缺少原图 ${id}`)
    }
  }
  for (const key of ['canvasProjects', 'agentConversations']) {
    if (data[key] === undefined) continue
    if (!Array.isArray(data[key])) throw new Error('备份文档列表无效')
    const ids = new Set<string>()
    for (const doc of data[key]) {
      if (!isRecord(doc) || typeof doc.id !== 'string' || !doc.id || ids.has(doc.id) || doc.schemaVersion !== 1 || typeof doc.title !== 'string' || !Number.isSafeInteger(doc.revision) || !Number.isFinite(doc.createdAt) || !Number.isFinite(doc.updatedAt)) throw new Error('备份文档字段无效或重复')
      ids.add(doc.id)
      if (key === 'canvasProjects') validateCanvasProject(doc)
      else if (!Array.isArray(doc.messages) || typeof doc.modelId !== 'string' || !Array.isArray(doc.referenceImageIds) || doc.messages.some((message) => !isRecord(message) || typeof message.id !== 'string' || typeof message.content !== 'string' || !['user', 'assistant', 'tool'].includes(String(message.role)))) throw new Error('备份会话格式无效')
      for (const id of getDocumentImageIds(doc)) if (!isRecord(data.imageFiles) || !data.imageFiles[id]) throw new Error(`文档缺少原图 ${id}`)
    }
  }
  if (data.favoriteCollections !== undefined && (!Array.isArray(data.favoriteCollections) || data.favoriteCollections.some((collection) => !isRecord(collection) || typeof collection.id !== 'string' || !collection.id || typeof collection.name !== 'string' || !collection.name.trim()))) throw new Error('备份收藏夹格式无效')
  return { manifest: data as unknown as ExportData, files }
}

export function readExportZipFileAsDataUrl(files: Record<string, Uint8Array>, path: string): string | null {
  const bytes = files[path]
  if (!bytes) return null
  return bytesToDataUrl(bytes, path)
}

function getImageCreatedAtFallback(tasks: TaskRecord[]) {
  const imageCreatedAtFallback = new Map<string, number>()

  for (const task of tasks) {
    for (const id of [
      ...(task.inputImageIds || []),
      ...(task.maskTargetImageId ? [task.maskTargetImageId] : []),
      ...(task.maskImageId ? [task.maskImageId] : []),
      ...(task.outputImages || []),
      ...(task.transparentOriginalImages || []),
      ...(task.streamPartialImageIds || []),
    ]) {
      if (!id) continue
      const prev = imageCreatedAtFallback.get(id)
      if (prev == null || task.createdAt < prev) imageCreatedAtFallback.set(id, task.createdAt)
    }
  }

  return imageCreatedAtFallback
}

function getImageFileNameBases(tasks: TaskRecord[]) {
  const bases = new Map<string, string>()

  for (const task of tasks) addImageFileNameBases(bases, task.outputImages || [], `task-${task.id}`)
  for (const task of tasks) addImageFileNameBases(bases, task.transparentOriginalImages || [], `task-${task.id}-orig`)
  for (const task of tasks) addImageFileNameBases(bases, task.streamPartialImageIds || [], `task-${task.id}-partial`)
  for (const task of tasks) addImageFileNameBases(bases, task.inputImageIds || [], `task-${task.id}-input`)
  for (const task of tasks) {
    if (task.maskImageId && !bases.has(task.maskImageId)) bases.set(task.maskImageId, `task-${task.id}-mask`)
  }

  return bases
}

function addImageFileNameBases(bases: Map<string, string>, imageIds: string[], fileNameBase: string) {
  const ids = imageIds.filter(Boolean)
  for (let index = 0; index < ids.length; index++) {
    if (bases.has(ids[index])) continue
    bases.set(ids[index], getNumberedFileNameBase(fileNameBase, index, ids.length))
  }
}

function getUniqueImagePath(fileNameBase: string, ext: string, usedPaths: Set<string>) {
  const base = sanitizeFileNamePart(fileNameBase) || 'image'
  let path = `images/${base}.${ext}`
  let duplicateIndex = 2
  while (usedPaths.has(path)) {
    path = `images/${base}-${String(duplicateIndex).padStart(2, '0')}.${ext}`
    duplicateIndex++
  }
  usedPaths.add(path)
  return path
}
