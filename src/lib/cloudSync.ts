import { useSyncExternalStore } from 'react'
import type { FavoriteCollection, StoredImage, TaskParams, TaskRecord } from '../types'
import { useStore } from '../store'
import {
  deleteCloudSyncQueueItem,
  getAllTasks,
  getCloudAssetMapItem,
  getCloudSyncMeta,
  getCloudSyncQueue,
  getImage,
  getStoredImageThumbnail,
  putCloudAssetMapItem,
  putCloudSyncMeta,
  putCloudSyncQueueItem,
  putImage,
  putImageThumbnail,
  putTask,
  replaceTasks,
  type CloudSyncQueueItem,
} from './db'
import { blobToDataUrl } from './dataUrl'
import { dataUrlToBlob } from './canvasImage'
import {
  fetchCloudAssetContent,
  getCloudStorage,
  getCloudSync,
  isBackendAuthEnabled,
  putCloudCollection,
  putCloudTask,
  setCloudTaskHidden,
  uploadCloudAsset,
  type GouoCloudAsset,
  type GouoCloudStorage,
  type GouoCloudSyncResult,
  type GouoCloudTask,
  type GouoCloudTaskAsset,
} from './gouoBackend'

export interface CloudSyncSnapshot {
  status: 'idle' | 'syncing' | 'synced' | 'error' | 'disabled'
  phase: string
  completed: number
  total: number
  storage: GouoCloudStorage | null
  error: string
}

const listeners = new Set<() => void>()
let snapshot: CloudSyncSnapshot = {
  status: 'idle',
  phase: '',
  completed: 0,
  total: 0,
  storage: null,
  error: '',
}
let running: Promise<void> | null = null
let unsubscribeStore: (() => void) | null = null
let previousFingerprints = new Map<string, string>()
let previousCollectionsFingerprint = ''
let focusHandlerInstalled = false
let initialPullComplete = false

function setSnapshot(patch: Partial<CloudSyncSnapshot>) {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeCloudSync(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCloudSyncSnapshot() {
  return snapshot
}

export function useCloudSyncSnapshot() {
  return useSyncExternalStore(subscribeCloudSync, getCloudSyncSnapshot, getCloudSyncSnapshot)
}

function isGalleryTask(task: TaskRecord) {
  const legacy = task as TaskRecord & { sourceMode?: unknown; agentConversationId?: unknown; agentRoundId?: unknown }
  return legacy.sourceMode !== 'agent' && !legacy.agentConversationId && !legacy.agentRoundId
}

function taskFingerprint(task: TaskRecord) {
  return JSON.stringify({
    status: task.status,
    prompt: task.prompt,
    params: task.params,
    inputImageIds: task.inputImageIds,
    maskTargetImageId: task.maskTargetImageId,
    maskImageId: task.maskImageId,
    outputImages: task.outputImages,
    outputErrors: task.outputErrors,
    transparentOriginalImages: task.transparentOriginalImages,
    favoriteCollectionIds: task.favoriteCollectionIds,
    cloudHiddenAt: task.cloudHiddenAt,
  })
}

function queueId(taskId: string) {
  return `task:${taskId}`
}

async function enqueueTask(task: TaskRecord) {
  if (!isGalleryTask(task) || task.status === 'running' || task.cloudHiddenAt) return
  const current = (await getCloudSyncQueue()).find((item) => item.taskId === task.id)
  await putCloudSyncQueueItem({
    id: queueId(task.id),
    taskId: task.id,
    attempts: current?.attempts ?? 0,
    nextAttemptAt: 0,
    createdAt: current?.createdAt ?? Date.now(),
  })
  updateLocalTask(task.id, { cloudSyncStatus: 'pending', cloudSyncError: undefined })
}

function updateLocalTask(taskId: string, patch: Partial<TaskRecord>) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) return
  const updated = { ...task, ...patch }
  useStore.setState({ tasks: state.tasks.map((item) => item.id === taskId ? updated : item) })
  void putTask(updated)
}

function installStoreSubscription() {
  if (unsubscribeStore) return
  previousFingerprints = new Map(useStore.getState().tasks.map((task) => [task.id, taskFingerprint(task)]))
  previousCollectionsFingerprint = JSON.stringify(useStore.getState().favoriteCollections)
  unsubscribeStore = useStore.subscribe((state) => {
    const collectionsFingerprint = JSON.stringify(state.favoriteCollections)
    if (collectionsFingerprint !== previousCollectionsFingerprint) {
      previousCollectionsFingerprint = collectionsFingerprint
      void triggerCloudSync()
    }
    for (const task of state.tasks) {
      if (!isGalleryTask(task) || task.status === 'running' || task.cloudHiddenAt) continue
      const fingerprint = taskFingerprint(task)
      if (previousFingerprints.get(task.id) === fingerprint) continue
      previousFingerprints.set(task.id, fingerprint)
      if (task.cloudSyncStatus !== 'syncing') void enqueueTask(task).then(() => triggerCloudSync())
    }
  })
}

async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function uploadImage(imageId: string): Promise<GouoCloudAsset> {
  const mapped = await getCloudAssetMapItem(imageId)
  if (mapped) {
    return {
      id: mapped.cloudAssetId,
      client_image_id: imageId,
      sha256: mapped.sha256,
      mime_type: '',
      file_size: 0,
      content_url: mapped.contentUrl,
      deduplicated: true,
    }
  }
  const image = await getImage(imageId)
  if (!image?.dataUrl) throw new Error(`本地图片 ${imageId} 不存在`)
  const blob = await dataUrlToBlob(image.dataUrl)
  const asset = await uploadCloudAsset(blob, imageId, await hashBlob(blob))
  await putCloudAssetMapItem({
    localImageId: imageId,
    cloudAssetId: asset.id,
    contentUrl: asset.content_url,
    sha256: asset.sha256,
    updatedAt: Date.now(),
  })
  return asset
}

function taskImageRelations(task: TaskRecord) {
  const relations: Array<{ imageId: string; role: GouoCloudTaskAsset['role']; position: number }> = []
  task.inputImageIds.forEach((imageId, position) => relations.push({ imageId, role: 'input', position }))
  if (task.maskTargetImageId) relations.push({ imageId: task.maskTargetImageId, role: 'mask_target', position: 0 })
  if (task.maskImageId) relations.push({ imageId: task.maskImageId, role: 'mask', position: 0 })
  task.outputImages.forEach((imageId, position) => relations.push({ imageId, role: 'output', position }))
  task.streamPartialImageIds?.forEach((imageId, position) => relations.push({ imageId, role: 'partial', position }))
  task.transparentOriginalImages?.forEach((imageId, position) => relations.push({ imageId, role: 'transparent_original', position }))
  return relations.slice(0, 32)
}

async function uploadTaskAssets(task: TaskRecord) {
  const relations = taskImageRelations(task)
  const result: Array<{ asset_id: string; role: string; position: number; client_image_id: string }> = []
  for (let start = 0; start < relations.length; start += 2) {
    const batch = relations.slice(start, start + 2)
    const assets = await Promise.all(batch.map(async (relation) => ({ relation, asset: await uploadImage(relation.imageId) })))
    for (const item of assets) {
      result.push({
        asset_id: item.asset.id,
        role: item.relation.role,
        position: item.relation.position,
        client_image_id: item.relation.imageId,
      })
    }
  }
  for (const [position, imageId] of task.outputImages.entries()) {
    if (result.length >= 32) break
    const thumbnail = await getStoredImageThumbnail(imageId)
    if (!thumbnail?.thumbnailDataUrl) continue
    const blob = await dataUrlToBlob(thumbnail.thumbnailDataUrl, 'image/webp')
    const asset = await uploadCloudAsset(blob, imageId, await hashBlob(blob))
    result.push({ asset_id: asset.id, role: 'thumbnail', position, client_image_id: imageId })
  }
  return result
}

function getTaskOperation(task: TaskRecord): 'generation' | 'edit' | 'variation' {
  if (task.maskImageId || task.inputImageIds.length > 0) return 'edit'
  return 'generation'
}

function getTaskResultMeta(task: TaskRecord) {
  return {
    apiProvider: task.apiProvider,
    apiProfileName: task.apiProfileName,
    actualParams: task.actualParams,
    actualParamsByImage: task.actualParamsByImage,
    revisedPromptByImage: task.revisedPromptByImage,
    transparentOutput: task.transparentOutput,
    transparentPrompt: task.transparentPrompt,
    outputErrors: task.outputErrors,
    elapsed: task.elapsed,
  }
}

async function syncCollections(collections: FavoriteCollection[]) {
  for (const collection of collections) {
    await putCloudCollection(collection.id, collection.name)
  }
}

async function syncTask(item: CloudSyncQueueItem, task: TaskRecord) {
  updateLocalTask(task.id, { cloudSyncStatus: 'syncing', cloudSyncError: undefined })
  const assets = await uploadTaskAssets(task)
  const cloudTask = await putCloudTask(task.id, {
    schema_version: 1,
    status: task.status,
    prompt: task.prompt,
    model: task.apiModel || useStore.getState().settings.model || 'gpt-image-2',
    operation: getTaskOperation(task),
    params: task.params,
    result_meta: getTaskResultMeta(task),
    error_message: task.error || '',
    client_created_at: task.createdAt,
    finished_at: task.finishedAt || 0,
    assets,
    collection_ids: task.favoriteCollectionIds || [],
  })
  await deleteCloudSyncQueueItem(item.id)
  updateLocalTask(task.id, {
    cloudId: cloudTask.id,
    cloudSyncStatus: 'synced',
    cloudSyncError: undefined,
    cloudHiddenAt: cloudTask.hidden_at || undefined,
  })
  previousFingerprints.set(task.id, taskFingerprint({ ...task, cloudId: cloudTask.id, cloudSyncStatus: 'synced' }))
}

async function processQueue() {
  const queue = (await getCloudSyncQueue()).sort((a, b) => a.createdAt - b.createdAt)
  const tasks = new Map((await getAllTasks()).map((task) => [task.id, task]))
  setSnapshot({ total: queue.length, completed: 0, phase: queue.length ? '正在同步作品' : '正在检查云端变化' })
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]
    const task = tasks.get(item.taskId)
    if (!task || !isGalleryTask(task)) {
      await deleteCloudSyncQueueItem(item.id)
      continue
    }
    if (item.nextAttemptAt > Date.now()) continue
    try {
      await syncTask(item, task)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const attempts = item.attempts + 1
      await putCloudSyncQueueItem({
        ...item,
        attempts,
        error: message,
        nextAttemptAt: Date.now() + Math.min(60_000, 2 ** attempts * 1_000),
      })
      updateLocalTask(task.id, { cloudSyncStatus: 'error', cloudSyncError: message })
    }
    setSnapshot({ completed: index + 1 })
  }
}

async function downloadAsset(asset: GouoCloudAsset, imageId: string): Promise<StoredImage> {
  const existing = await getImage(imageId)
  if (existing) return existing
  const blob = await fetchCloudAssetContent(asset)
  const image: StoredImage = {
    id: imageId,
    dataUrl: await blobToDataUrl(blob, asset.mime_type),
    createdAt: Date.now(),
    source: 'generated',
    width: asset.width,
    height: asset.height,
  }
  await putImage(image)
  return image
}

async function registerCloudAssets(task: GouoCloudTask) {
  for (const link of task.assets) {
    if (!link.client_image_id) continue
    await putCloudAssetMapItem({
      localImageId: link.client_image_id,
      cloudAssetId: link.asset.id,
      contentUrl: link.asset.content_url,
      sha256: link.asset.sha256,
      updatedAt: Date.now(),
    })
    if (link.role === 'thumbnail') {
      const blob = await fetchCloudAssetContent(link.asset)
      await putImageThumbnail({
        id: link.client_image_id,
        thumbnailDataUrl: await blobToDataUrl(blob, link.asset.mime_type),
        width: link.asset.width,
        height: link.asset.height,
        thumbnailVersion: 2,
      })
    }
  }
}

function cloudTaskToLocal(task: GouoCloudTask): TaskRecord {
  const byRole = (role: GouoCloudTaskAsset['role']) => task.assets
    .filter((item) => item.role === role)
    .sort((a, b) => a.position - b.position)
    .map((item) => item.client_image_id)
    .filter(Boolean)
  const meta = task.result_meta || {}
  return {
    id: task.client_task_id,
    prompt: task.prompt,
    params: task.params as unknown as TaskParams,
    apiProvider: meta.apiProvider as TaskRecord['apiProvider'],
    apiProfileName: typeof meta.apiProfileName === 'string' ? meta.apiProfileName : undefined,
    apiMode: 'images',
    apiModel: task.model,
    actualParams: meta.actualParams as TaskRecord['actualParams'],
    actualParamsByImage: meta.actualParamsByImage as TaskRecord['actualParamsByImage'],
    revisedPromptByImage: meta.revisedPromptByImage as TaskRecord['revisedPromptByImage'],
    transparentOutput: Boolean(meta.transparentOutput),
    transparentPrompt: typeof meta.transparentPrompt === 'string' ? meta.transparentPrompt : undefined,
    inputImageIds: byRole('input'),
    maskTargetImageId: byRole('mask_target')[0] || null,
    maskImageId: byRole('mask')[0] || null,
    outputImages: byRole('output'),
    outputErrors: meta.outputErrors as TaskRecord['outputErrors'],
    transparentOriginalImages: byRole('transparent_original'),
    streamPartialImageIds: byRole('partial'),
    status: task.status,
    error: task.error_message || null,
    createdAt: task.client_created_at,
    finishedAt: task.finished_at || null,
    elapsed: typeof meta.elapsed === 'number' ? meta.elapsed : null,
    isFavorite: Boolean(task.favorite_collection_ids?.length),
    favoriteCollectionIds: task.favorite_collection_ids || [],
    cloudId: task.id,
    cloudSyncStatus: 'synced',
    cloudHiddenAt: task.hidden_at || undefined,
  }
}

async function pullCloudState() {
  const existingLocalTasks = await getAllTasks()
  let cursor = !initialPullComplete || !existingLocalTasks.length ? '' : await getCloudSyncMeta<string>('cursor') || ''
  let firstPage = true
  const changed: GouoCloudTask[] = []
  let latest: GouoCloudSyncResult | null = null
  do {
    latest = await getCloudSync(cursor)
    changed.push(...latest.tasks)
    cursor = latest.next_cursor
    firstPage = false
  } while (latest.has_more && !firstPage)
  if (!latest) return

  for (const task of changed) await registerCloudAssets(task)
  const localTasks = await getAllTasks()
  const cloudByClientID = new Map(changed.map((task) => [task.client_task_id, cloudTaskToLocal(task)]))
  const merged = localTasks.map((task) => cloudByClientID.get(task.id) ?? task)
  const localIDs = new Set(localTasks.map((task) => task.id))
  for (const task of cloudByClientID.values()) {
    if (!localIDs.has(task.id)) merged.push(task)
  }
  await replaceTasks(merged)
  useStore.getState().setTasks(merged)

  const collections = latest.collections
    .filter((collection) => !collection.hidden_at)
    .map((collection) => ({ id: collection.id, name: collection.name, createdAt: collection.created_at, updatedAt: collection.updated_at }))
  if (collections.length) useStore.getState().setFavoriteCollections(collections)
  await putCloudSyncMeta('cursor', cursor)
  initialPullComplete = true
}

async function queueHistoricalTasks() {
  const tasks = (await getAllTasks()).filter((task) => isGalleryTask(task) && task.status !== 'running' && !task.cloudHiddenAt)
  for (let start = 0; start < tasks.length; start += 20) {
    const batch = tasks.slice(start, start + 20)
    for (const task of batch) {
      if (task.cloudSyncStatus !== 'synced') await enqueueTask(task)
    }
    await putCloudSyncMeta('migration', { completed: Math.min(start + 20, tasks.length), total: tasks.length, updatedAt: Date.now() })
  }
}

async function runCloudSync() {
  if (!isBackendAuthEnabled()) {
    setSnapshot({ status: 'disabled', phase: '', error: '' })
    return
  }
  setSnapshot({ status: 'syncing', phase: '正在检查云端空间', error: '', completed: 0, total: 0 })
  try {
    const storage = await getCloudStorage()
    setSnapshot({ storage })
    if (!storage.enabled) {
      setSnapshot({ status: 'disabled', phase: '云端作品库未启用' })
      return
    }
    await syncCollections(useStore.getState().favoriteCollections)
    await queueHistoricalTasks()
    await processQueue()
    await pullCloudState()
    const remaining = await getCloudSyncQueue()
    if (remaining.length) {
      setSnapshot({ status: 'error', phase: '部分作品同步失败', storage: await getCloudStorage(), error: remaining[0].error || '稍后将自动重试' })
      return
    }
    setSnapshot({ status: 'synced', phase: '云端作品已同步', storage: await getCloudStorage(), error: '' })
  } catch (error) {
    setSnapshot({ status: 'error', phase: '云端同步失败', error: error instanceof Error ? error.message : String(error) })
  }
}

export function triggerCloudSync() {
  if (running) return running
  running = runCloudSync().finally(() => {
    running = null
  })
  return running
}

export async function startCloudSync() {
  if (!isBackendAuthEnabled()) return
  installStoreSubscription()
  if (!focusHandlerInstalled) {
    focusHandlerInstalled = true
    window.addEventListener('online', () => void triggerCloudSync())
    window.addEventListener('focus', () => void triggerCloudSync())
  }
  await triggerCloudSync()
}

export async function hideCloudTask(task: TaskRecord) {
  if (!task.cloudId) return false
  await setCloudTaskHidden(task.cloudId, true)
  updateLocalTask(task.id, { cloudHiddenAt: Date.now(), cloudSyncStatus: 'synced' })
  return true
}

export async function restoreCloudTask(task: TaskRecord) {
  if (!task.cloudId) return
  await setCloudTaskHidden(task.cloudId, false)
  updateLocalTask(task.id, { cloudHiddenAt: undefined, cloudSyncStatus: 'synced' })
}

export async function fetchCloudImageIfNeeded(imageId: string) {
  const existing = await getImage(imageId)
  if (existing) return existing.dataUrl
  const mapped = await getCloudAssetMapItem(imageId)
  if (!mapped) return undefined
  const asset: GouoCloudAsset = {
    id: mapped.cloudAssetId,
    sha256: mapped.sha256,
    mime_type: 'image/png',
    file_size: 0,
    content_url: mapped.contentUrl,
  }
  return (await downloadAsset(asset, imageId)).dataUrl
}
