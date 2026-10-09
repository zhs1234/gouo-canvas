import type { TaskRecord, StoredImage, StoredImageThumbnail, CanvasProject, AgentConversation } from '../types'
import { loadImage } from './canvasImage'
import { getLoadedStorageName, isStorageScopeCurrent } from './storageScope'
import { getDocumentImageIds, getLiveDocumentImageIds } from './documentAssets'

const DB_NAME = getLoadedStorageName()
const DB_VERSION = 5
const STORE_CANVASES = 'canvasProjects'
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_AGENT_CONVERSATIONS = 'agentConversations'
const STORE_CLOUD_QUEUE = 'cloudSyncQueue'
const STORE_CLOUD_META = 'cloudSyncMeta'
const STORE_CLOUD_ASSET_MAP = 'cloudAssetMap'
const THUMBNAIL_MAX_SIZE = 720
const THUMBNAIL_QUALITY = 0.9
const THUMBNAIL_VERSION = 2

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    let blocked = false
    req.onblocked = () => {
      blocked = true
      reject(new Error('数据库升级被其他标签页占用，请关闭其他光构页面后重试'))
    }
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_CANVASES)) db.createObjectStore(STORE_CANVASES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
        db.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_CONVERSATIONS)) {
        db.createObjectStore(STORE_AGENT_CONVERSATIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CLOUD_QUEUE)) {
        db.createObjectStore(STORE_CLOUD_QUEUE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CLOUD_META)) {
        db.createObjectStore(STORE_CLOUD_META, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_CLOUD_ASSET_MAP)) {
        db.createObjectStore(STORE_CLOUD_ASSET_MAP, { keyPath: 'localImageId' })
      }
    }
    req.onsuccess = () => {
      // 已因 blocked 拒绝的调用方拿不到连接，迟到的成功连接需立即关闭。
      if (blocked) return req.result.close()
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        tx.oncomplete = () => { db.close(); resolve(req.result) }
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? req.error) }
      }),
  )
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

export function replaceTasks(tasks: TaskRecord[]): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TASKS, 'readwrite')
        const store = tx.objectStore(STORE_TASKS)
        store.clear()
        for (const task of tasks) store.put(task)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

// 云端拉取只合并已同步记录；事务期间新增或编辑的本地任务不能被整库覆盖。
export async function mergeSyncedTasks(tasks: TaskRecord[]): Promise<TaskRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite')
    const store = tx.objectStore(STORE_TASKS)
    const saved: TaskRecord[] = []
    for (const task of tasks) {
      const req = store.get(task.id)
      req.onsuccess = () => {
        if (req.result && req.result.cloudSyncStatus !== 'synced') return
        store.put(task)
        saved.push(task)
      }
    }
    tx.oncomplete = () => { db.close(); resolve(saved) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

// 整批恢复共用一个事务，冲突或空间不足时不能留下半套任务和图片。
export async function importTaskData(tasks: TaskRecord[], images: StoredImage[], thumbnails: StoredImageThumbnail[], documents?: { canvases: CanvasProject[]; conversations: AgentConversation[] }) {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_TASKS, STORE_IMAGES, STORE_THUMBNAILS, STORE_CLOUD_ASSET_MAP, STORE_CANVASES, STORE_AGENT_CONVERSATIONS], 'readwrite')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error('导入事务已中止')) }
    try {
      for (const doc of documents?.canvases ?? []) tx.objectStore(STORE_CANVASES).add(doc)
      for (const doc of documents?.conversations ?? []) tx.objectStore(STORE_AGENT_CONVERSATIONS).add(doc)
      for (const task of tasks) tx.objectStore(STORE_TASKS).add(task)
      for (const image of images) {
        const store = tx.objectStore(STORE_IMAGES)
        const req = store.get(image.id)
        req.onsuccess = () => {
          if (req.result && req.result.dataUrl !== image.dataUrl) {
            reject(new Error(`图片 ID 冲突：${image.id}；保留现有图片，本批作品未导入`))
            tx.abort()
            return
          }
          if (!req.result) store.add(image)
        }
        tx.objectStore(STORE_CLOUD_ASSET_MAP).delete(image.id)
      }
      for (const thumbnail of thumbnails) {
        const store = tx.objectStore(STORE_THUMBNAILS)
        const req = store.get(thumbnail.id)
        req.onsuccess = () => { if (!req.result) store.add(thumbnail) }
      }
    } catch (error) {
      tx.abort()
      reject(error)
    }
  })
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id))
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const existingThumbnail = await getStoredImageThumbnail(id)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    return existingThumbnail
  }

  const image = await getImage(id)
  if (!image) return undefined
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  const metadata = await safeCreateImageThumbnail(image.dataUrl)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  )
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

export interface CloudSyncQueueItem {
  id: string
  taskId: string
  attempts: number
  nextAttemptAt: number
  createdAt: number
  error?: string
}

export interface CloudAssetMapItem {
  localImageId: string
  cloudAssetId: string
  contentUrl: string
  sha256: string
  mimeType?: string
  updatedAt: number
}

interface CloudSyncMetaItem {
  key: string
  value: unknown
}

export function getCloudSyncQueue(): Promise<CloudSyncQueueItem[]> {
  return dbTransaction(STORE_CLOUD_QUEUE, 'readonly', (s) => s.getAll())
}

export function putCloudSyncQueueItem(item: CloudSyncQueueItem): Promise<IDBValidKey> {
  return dbTransaction(STORE_CLOUD_QUEUE, 'readwrite', (s) => s.put(item))
}

export function deleteCloudSyncQueueItem(id: string): Promise<undefined> {
  return dbTransaction(STORE_CLOUD_QUEUE, 'readwrite', (s) => s.delete(id))
}

export function getCloudAssetMapItem(localImageId: string): Promise<CloudAssetMapItem | undefined> {
  return dbTransaction(STORE_CLOUD_ASSET_MAP, 'readonly', (s) => s.get(localImageId))
}

export function putCloudAssetMapItem(item: CloudAssetMapItem): Promise<IDBValidKey> {
  return dbTransaction(STORE_CLOUD_ASSET_MAP, 'readwrite', (s) => s.put(item))
}

export function getCloudSyncMeta<T>(key: string): Promise<T | undefined> {
  return dbTransaction<CloudSyncMetaItem | undefined>(STORE_CLOUD_META, 'readonly', (s) => s.get(key)).then((item) => item?.value as T | undefined)
}

export function putCloudSyncMeta(key: string, value: unknown): Promise<IDBValidKey> {
  return dbTransaction(STORE_CLOUD_META, 'readwrite', (s) => s.put({ key, value }))
}

export function deleteImage(id: string): Promise<undefined> {
  return deleteImages([id])
}

// 批量删除只读取一次画布/对话引用，避免启动清理时逐张反序列化全部文档。
export async function deleteImages(ids: string[]): Promise<undefined> {
  if (!ids.length) return undefined
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS, STORE_CANVASES, STORE_AGENT_CONVERSATIONS], 'readwrite')
    let remaining = 2
    const referenced = new Set<string>()
    for (const name of [STORE_CANVASES, STORE_AGENT_CONVERSATIONS]) {
      const req = tx.objectStore(name).getAll()
      req.onsuccess = () => {
        for (const imageId of getDocumentImageIds(req.result)) referenced.add(imageId)
        remaining--
        if (remaining) return
        const live = getLiveDocumentImageIds()
        for (const id of ids) {
          if (referenced.has(id) || live.has(id)) continue
          tx.objectStore(STORE_IMAGES).delete(id)
          tx.objectStore(STORE_THUMBNAILS).delete(id)
        }
      }
    }
    tx.oncomplete = () => { db.close(); resolve(undefined) }
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

export async function clearImages(): Promise<undefined> {
  return deleteImages(await getAllImageIds())
}

export async function getAllCanvasProjects(): Promise<CanvasProject[]> {
  const records: CanvasProject[] = await dbTransaction(STORE_CANVASES, 'readonly', (s) => s.getAll())
  return records.filter((item) => item.schemaVersion === 1)
}

export function getCanvasProject(id: string): Promise<CanvasProject | undefined> {
  return dbTransaction(STORE_CANVASES, 'readonly', (s) => s.get(id))
}

export async function getAllAgentConversations(): Promise<AgentConversation[]> {
  const records: AgentConversation[] = await dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.getAll())
  return records.filter((item) => item.schemaVersion === 1)
}

export function getAgentConversation(id: string): Promise<AgentConversation | undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.get(id))
}

async function putDocument(storeName: string, document: CanvasProject | AgentConversation, expectedRevision?: number, fromSync = false): Promise<void> {
  if (!isStorageScopeCurrent()) throw new Error('账号已切换，请刷新页面')
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.get(document.id)
    let failure: Error | undefined
    let changed = false
    req.onsuccess = () => {
      const current = req.result as CanvasProject | AgentConversation | undefined
      if (!isStorageScopeCurrent() || (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision)) {
        failure = new Error('文档已变更，请读取最新内容后重试')
        tx.abort()
        return
      }
      if (expectedRevision === undefined && current && current.revision >= document.revision) {
        if (JSON.stringify(current) === JSON.stringify(document)) return
        failure = new Error('文档已变更，请读取最新内容后重试')
        tx.abort()
        return
      }
      store.put(document)
      changed = true
    }
    tx.oncomplete = () => {
      db.close()
      // fromSync 让云同步忽略自己写回的变更，界面仍需刷新。
      if (changed) window.dispatchEvent(new CustomEvent('gouo:documents-changed', { detail: { fromSync } }))
      resolve()
    }
    tx.onerror = tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('文档保存失败')) }
  })
}

export function putCanvasProject(project: CanvasProject, expectedRevision?: number, fromSync = false): Promise<void> {
  return putDocument(STORE_CANVASES, project, expectedRevision, fromSync)
}

export function putAgentConversation(conversation: AgentConversation, expectedRevision?: number, fromSync = false): Promise<void> {
  return putDocument(STORE_AGENT_CONVERSATIONS, conversation, expectedRevision, fromSync)
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export interface StoreImageResult {
  id: string
  width?: number
  height?: number
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id 及图片真实宽高。
 */
export async function storeImage(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<string> {
  return (await storeImageWithSize(dataUrl, source)).id
}

export async function storeImageWithSize(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<StoreImageResult> {
  const id = await hashDataUrl(dataUrl)
  const existing = await getImage(id)
  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    await putImage({
      id,
      dataUrl,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
    return { id, width: thumbnail.width, height: thumbnail.height }
  }

  if ((await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION) {
    const thumbnail = await safeCreateImageThumbnail(existing.dataUrl)
    const width = thumbnail.width ?? existing.width
    const height = thumbnail.height ?? existing.height
    if (thumbnail.width && thumbnail.height && (existing.width !== thumbnail.width || existing.height !== thumbnail.height)) {
      await putImage({ ...existing, width: thumbnail.width, height: thumbnail.height })
    }
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
    return { id, width, height }
  }
  return { id, width: existing.width, height: existing.height }
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}
