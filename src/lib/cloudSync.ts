import { useSyncExternalStore } from 'react'
import type { FavoriteCollection, StoredImage, TaskParams, TaskRecord } from '../types'
import { cacheImage, useStore } from '../store'
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
  mergeSyncedTasks,
  type CloudSyncQueueItem,
} from './db'
import { blobToDataUrl } from './dataUrl'
import { dataUrlToBlob } from './canvasImage'
import {
  fetchCloudAssetContent,
  getCurrentUser,
  getCloudStorage,
  getCloudSync,
  hideCloudCollection,
  GouoRateLimitError,
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
import { activateUserStorage, isLoadedStorageForUser } from './storageScope'

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
let pendingRun = false
let retryAt = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let failures = 0

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
    error: task.error,
    resultMeta: getTaskResultMeta(task),
    streamPartialImageIds: task.streamPartialImageIds,
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
  if (current) return
  await putCloudSyncQueueItem({
    id: queueId(task.id),
    taskId: task.id,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  })
  await updateLocalTask(task.id, { cloudSyncStatus: 'pending', cloudSyncError: undefined })
}

function updateLocalTask(taskId: string, patch: Partial<TaskRecord>) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) return
  const updated = { ...task, ...patch }
  useStore.setState({ tasks: state.tasks.map((item) => item.id === taskId ? updated : item) })
  return putTask(updated)
}

function installStoreSubscription() {
  if (unsubscribeStore) return
  previousFingerprints = new Map(useStore.getState().tasks.map((task) => [task.id, taskFingerprint(task)]))
  let previousTasks = useStore.getState().tasks
  previousCollectionsFingerprint = JSON.stringify(useStore.getState().favoriteCollections)
  unsubscribeStore = useStore.subscribe((state) => {
    const collectionsFingerprint = JSON.stringify(state.favoriteCollections)
    if (collectionsFingerprint !== previousCollectionsFingerprint) {
      previousCollectionsFingerprint = collectionsFingerprint
      void triggerCloudSync()
    }
    if (state.tasks === previousTasks) return
    const previousById = new Map(previousTasks.map((task) => [task.id, task]))
    previousTasks = state.tasks
    for (const task of state.tasks) {
      if (previousById.get(task.id) === task) continue
      if (!isGalleryTask(task) || task.status === 'running' || task.cloudHiddenAt) continue
      const fingerprint = taskFingerprint(task)
      if (previousFingerprints.get(task.id) === fingerprint) continue
      previousFingerprints.set(task.id, fingerprint)
      // 先同步标记脏数据，防止正在进行的拉取/上传把新编辑当成已同步内容。
      void updateLocalTask(task.id, { cloudSyncStatus: 'pending', cloudSyncError: undefined })
      void triggerCloudSync()
    }
  })
}

async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function uploadImage(imageId: string, forceUpload = false): Promise<GouoCloudAsset> {
  const mapped = await getCloudAssetMapItem(imageId)
  // 旧映射可能指向缩略图，只有带真实 MIME 的新版原图映射才能复用。
  if (mapped?.mimeType && !forceUpload) {
    return {
      id: mapped.cloudAssetId,
      client_image_id: imageId,
      sha256: mapped.sha256,
      mime_type: mapped.mimeType,
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
    mimeType: asset.mime_type,
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
    const hash = await hashBlob(blob)
    const cached = await getCloudSyncMeta<GouoCloudAsset>(`thumbnail:${imageId}`)
    const asset = cached?.sha256 === hash ? cached : await uploadCloudAsset(blob, imageId, hash)
    await putCloudSyncMeta(`thumbnail:${imageId}`, asset)
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
    gouoPriceVersion: task.gouoPriceVersion,
    gouoPriceCNY: task.gouoPriceCNY,
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
  const acknowledged = new Map((await getCloudSyncMeta<FavoriteCollection[]>('collections') ?? []).map((collection) => [collection.id, collection]))
  const localIds = new Set(collections.map((collection) => collection.id))
  for (const id of acknowledged.keys()) {
    if (localIds.has(id)) continue
    await hideCloudCollection(id)
    acknowledged.delete(id)
    await putCloudSyncMeta('collections', [...acknowledged.values()])
  }
  for (const collection of collections) {
    if (acknowledged.get(collection.id)?.name === collection.name) continue
    await putCloudCollection(collection.id, collection.name)
    acknowledged.set(collection.id, collection)
    await putCloudSyncMeta('collections', [...acknowledged.values()])
  }
}

async function syncTask(item: CloudSyncQueueItem, task: TaskRecord) {
  await updateLocalTask(task.id, { cloudSyncStatus: 'syncing', cloudSyncError: undefined })
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
  const latest = useStore.getState().tasks.find((entry) => entry.id === task.id)
  if (!latest) return
  const changed = taskFingerprint(latest) !== taskFingerprint(task)
  await updateLocalTask(task.id, {
    cloudId: cloudTask.id,
    cloudSyncStatus: changed ? 'pending' : 'synced',
    cloudSyncError: undefined,
  })
  if (changed) pendingRun = true
}

async function processQueue() {
  const queue = (await getCloudSyncQueue()).sort((a, b) => a.createdAt - b.createdAt)
  setSnapshot({ total: queue.length, completed: 0, phase: queue.length ? '正在同步作品' : '正在检查云端变化' })
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index]
    const task = useStore.getState().tasks.find((entry) => entry.id === item.taskId)
    if (!task || !isGalleryTask(task) || task.cloudHiddenAt || task.status === 'running') {
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
        nextAttemptAt: error instanceof GouoRateLimitError ? error.retryAt : Date.now() + Math.min(60_000, 2 ** attempts * 1_000),
      })
      await updateLocalTask(task.id, { cloudSyncStatus: 'error', cloudSyncError: message })
      if (error instanceof GouoRateLimitError) throw error
    }
    setSnapshot({ completed: index + 1 })
  }
}

async function downloadAsset(asset: GouoCloudAsset, imageId: string, replacePreview = false): Promise<StoredImage> {
  const existing = await getImage(imageId)
  if (existing && !replacePreview) return existing
  const blob = await fetchCloudAssetContent(asset)
  if (asset.sha256 && await hashBlob(blob) !== asset.sha256) throw new Error('云端图片校验失败，请重试或联系管理员恢复原图')
  const image: StoredImage = {
    id: imageId,
    dataUrl: await blobToDataUrl(blob, asset.mime_type),
    createdAt: Date.now(),
    source: 'generated',
    width: asset.width,
    height: asset.height,
  }
  await putImage(image)
  cacheImage(imageId, image.dataUrl)
  return image
}

async function registerCloudAssets(task: GouoCloudTask, previews: Map<string, GouoCloudAsset>) {
  let repaired = false
  for (const link of task.assets) {
    if (!link.client_image_id) continue
    if (link.role === 'thumbnail') {
      const cached = await getCloudSyncMeta<GouoCloudAsset>(`thumbnail:${link.client_image_id}`)
      if (cached?.sha256 === link.asset.sha256 && await getStoredImageThumbnail(link.client_image_id)) continue
      const blob = await fetchCloudAssetContent(link.asset)
      await putImageThumbnail({
        id: link.client_image_id,
        thumbnailDataUrl: await blobToDataUrl(blob, link.asset.mime_type),
        width: link.asset.width,
        height: link.asset.height,
        thumbnailVersion: 2,
      })
      await putCloudSyncMeta(`thumbnail:${link.client_image_id}`, link.asset)
      continue
    }
    const mapped = await getCloudAssetMapItem(link.client_image_id)
    if (!mapped?.mimeType || mapped.cloudAssetId !== link.asset.id) {
      const local = await getImage(link.client_image_id)
      const preview = previews.get(link.client_image_id)
      if (local && preview) {
        const localHash = await hashBlob(await dataUrlToBlob(local.dataUrl))
        if (localHash === preview.sha256 && localHash !== link.asset.sha256) {
          // 旧版本已把预览存入原图缓存时，重新取原图并同时更新内存缓存。
          await downloadAsset(link.asset, link.client_image_id, true)
        } else if (link.asset.id === preview.id && localHash !== link.asset.sha256) {
          // 云端关联已受损，但此设备还保留原图：重新上传原文件修复关联。
          await uploadImage(link.client_image_id, true)
          repaired = true
          continue
        }
      }
    }
    await putCloudAssetMapItem({
      localImageId: link.client_image_id,
      cloudAssetId: link.asset.id,
      contentUrl: link.asset.content_url,
      sha256: link.asset.sha256,
      mimeType: link.asset.mime_type,
      updatedAt: Date.now(),
    })
  }
  return repaired
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
    gouoPriceVersion: typeof meta.gouoPriceVersion === 'string' ? meta.gouoPriceVersion : undefined,
    gouoPriceCNY: typeof meta.gouoPriceCNY === 'number' && Number.isFinite(meta.gouoPriceCNY) && meta.gouoPriceCNY > 0 ? meta.gouoPriceCNY : undefined,
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

  const acknowledged = new Map((await getCloudSyncMeta<FavoriteCollection[]>('collections') ?? []).map((collection) => [collection.id, collection]))
  const localCollections = new Map(useStore.getState().favoriteCollections.map((collection) => [collection.id, collection]))
  const remoteIds = new Set(latest.collections.map((collection) => collection.id))
  const remoteCollections = latest.collections.filter((collection) => !collection.hidden_at).map((collection) => ({ id: collection.id, name: collection.name, createdAt: collection.created_at, updatedAt: collection.updated_at }))
  const collections: FavoriteCollection[] = []
  for (const remote of remoteCollections) {
    const local = localCollections.get(remote.id)
    const previous = acknowledged.get(remote.id)
    // 保留未同步的本地编辑/删除；未修改的旧名称不能覆盖另一设备的新名称。
    if (previous && !local) continue
    collections.push(previous && local && local.name !== previous.name ? local : remote)
  }
  for (const local of localCollections.values()) {
    if (!remoteIds.has(local.id)) collections.push(local)
  }
  if (!collections.length && latest.collections.length) collections.push({ id: crypto.randomUUID(), name: '默认', createdAt: Date.now(), updatedAt: Date.now() })
  previousCollectionsFingerprint = JSON.stringify(collections)
  useStore.getState().setFavoriteCollections(collections)
  await putCloudSyncMeta('collections', remoteCollections)
  // 接口返回完整收藏关系，隐藏的收藏夹不应继续把任务标记为已收藏。
  const visibleCollectionIds = new Set(collections.map((collection) => collection.id))
  const favorites = new Map<string, string[]>()
  for (const item of latest.favorite_items) {
    if (visibleCollectionIds.has(item.collection_id)) favorites.set(item.task_id, [...favorites.get(item.task_id) ?? [], item.collection_id])
  }

  const repaired = new Set<string>()
  const previews = new Map(changed.flatMap((task) => task.assets.filter((link) => link.role === 'thumbnail').map((link) => [link.client_image_id, link.asset] as const)))
  for (const task of changed) {
    if (await registerCloudAssets(task, previews)) repaired.add(task.client_task_id)
  }
  const localTasks = useStore.getState().tasks
  const cloudByClientID = new Map(changed.map((task) => [task.client_task_id, cloudTaskToLocal(task)]))
  const merged = localTasks.map((task) => {
    if (task.cloudSyncStatus !== 'synced' || repaired.has(task.id)) return task
    return cloudByClientID.get(task.id) ?? task
  })
  const localIDs = new Set(localTasks.map((task) => task.id))
  for (const task of cloudByClientID.values()) {
    if (!localIDs.has(task.id)) merged.push(task)
  }
  for (const id of repaired) await updateLocalTask(id, { cloudSyncStatus: 'pending' })
  const candidates = merged.filter((task) => task.cloudSyncStatus === 'synced' && !repaired.has(task.id)).map((task) => {
    const ids = favorites.get(task.cloudId || '') ?? []
    return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
  })
  const saved = new Map((await mergeSyncedTasks(candidates)).map((task) => [task.id, task]))
  const current = useStore.getState().tasks
  const currentIds = new Set(current.map((task) => task.id))
  const next = current.map((task) => task.cloudSyncStatus === 'synced' ? saved.get(task.id) ?? task : task)
  for (const task of saved.values()) {
    if (!currentIds.has(task.id)) next.push(task)
  }
  for (const task of next) previousFingerprints.set(task.id, taskFingerprint(task))
  useStore.getState().setTasks(next)

  await putCloudSyncMeta('cursor', cursor)
  initialPullComplete = true
}

async function queueHistoricalTasks() {
  const tasks = useStore.getState().tasks.filter((task) => isGalleryTask(task) && task.status !== 'running' && !task.cloudHiddenAt)
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
    retryAt = await getCloudSyncMeta<number>('retryAt') || 0
    if (retryAt > Date.now()) {
      setSnapshot({ status: 'error', phase: '等待自动重试', error: '同步暂缓，已保存的作品不受影响' })
      return
    }
    const user = await getCurrentUser()
    if (!isLoadedStorageForUser(user.id)) {
      activateUserStorage(user.id)
      window.location.reload()
      return
    }
    const storage = await getCloudStorage()
    setSnapshot({ storage })
    if (!storage.enabled) {
      setSnapshot({ status: 'disabled', phase: '云端作品库未启用' })
      return
    }
    // 先读取原图角色，避免升级后的第一次上传再次使用旧缩略图映射。
    await pullCloudState()
    await syncCollections(useStore.getState().favoriteCollections)
    await queueHistoricalTasks()
    await processQueue()
    await pullCloudState()
    const remaining = await getCloudSyncQueue()
    failures = 0
    if (remaining.length) {
      retryAt = Math.max(Date.now() + 1000, Math.min(...remaining.map((item) => item.nextAttemptAt)))
      setSnapshot({ status: 'error', phase: '部分作品同步失败', storage: await getCloudStorage(), error: remaining[0].error || '稍后将自动重试' })
      return
    }
    setSnapshot({ status: 'synced', phase: '云端作品已同步', storage: await getCloudStorage(), error: '' })
  } catch (error) {
    failures++
    retryAt = error instanceof GouoRateLimitError ? error.retryAt : Date.now() + Math.min(60_000, 2 ** Math.min(failures, 6) * 1000)
    await putCloudSyncMeta('retryAt', retryAt).catch((err) => console.warn('保存同步重试时间失败', err))
    setSnapshot({ status: 'error', phase: '等待自动重试', error: error instanceof Error ? error.message : String(error) })
  }
}

export function triggerCloudSync() {
  pendingRun = true
  if (running) return running
  if (retryTimer) clearTimeout(retryTimer)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSnapshot({ status: 'error', phase: '等待网络恢复', error: '连接恢复后会自动继续同步' })
    return Promise.resolve()
  }
  if (retryAt > Date.now()) {
    retryTimer = setTimeout(() => void triggerCloudSync(), retryAt - Date.now())
    return Promise.resolve()
  }
  running = (async () => {
    do {
      pendingRun = false
      await runCloudSync()
    } while (pendingRun && retryAt <= Date.now())
  })().finally(() => {
    running = null
    if (retryAt > Date.now()) retryTimer = setTimeout(() => void triggerCloudSync(), retryAt - Date.now())
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
    mime_type: mapped.mimeType || '',
    file_size: 0,
    content_url: mapped.contentUrl,
  }
  return (await downloadAsset(asset, imageId)).dataUrl
}
