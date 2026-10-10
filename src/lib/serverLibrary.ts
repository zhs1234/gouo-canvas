import type { FavoriteCollection, StoredImage, TaskParams, TaskRecord } from '../types'
import { cacheImage, purgeLocalTasks, useStore } from '../store'
import {
  deleteCloudAssetMapItems,
  getCloudAssetMapItem,
  getCloudMeta,
  getImage,
  putCloudAssetMapItem,
  putCloudMeta,
  putImage,
  putTask,
} from './db'
import { blobToDataUrl } from './dataUrl'
import { dataUrlToBlob } from './canvasImage'
import { removeKeyedBackgroundFromDataUrl } from './transparentImage'
import {
  fetchCloudAssetContent,
  getCloudStorage,
  GouoAssetMissingError,
  GOUO_TRASH_RETENTION_MS,
  hideCloudCollection,
  isBackendAuthEnabled,
  listCloudCollections,
  listCloudTasks,
  patchCloudTaskMeta,
  putCloudCollection,
  putCloudTask,
  setCloudFavorite,
  setCloudTaskHidden,
  uploadCloudAsset,
  type GouoCloudAsset,
  type GouoCloudTask,
  type GouoCloudTaskAsset,
} from './gouoBackend'
import { isStorageScopeCurrent } from './storageScope'

// 作品以服务端为准：图片在生成时由服务端直接保存，浏览器只缓存，不再排队上传或双向合并。
let enabled = false
let refreshing: Promise<void> | null = null
let lastRefreshAt = 0
// 清空本地任务时递增；按旧游标进行中的读取不再写回游标
let cursorGeneration = 0
let refreshingGeneration = 0
// 服务端数据写回本地时不能再触发收藏/收藏夹的修改请求。
let applyingServer = false

export function isServerLibraryEnabled() {
  return enabled
}

function showError(message: string, err: unknown) {
  console.warn(message, err)
  useStore.getState().showToast(`${message}：${err instanceof Error ? err.message : String(err)}`, 'error')
}

async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
}

function mapAsset(localImageId: string, asset: GouoCloudAsset, derive?: 'transparent') {
  return putCloudAssetMapItem({ localImageId, cloudAssetId: asset.id, contentUrl: asset.content_url, sha256: asset.sha256, mimeType: asset.mime_type, derive, updatedAt: Date.now() })
}

export async function uploadImage(imageId: string): Promise<GouoCloudAsset> {
  if (!isStorageScopeCurrent()) throw new Error('账号已切换')
  const mapped = await getCloudAssetMapItem(imageId)
  if (mapped?.mimeType && !mapped.derive) {
    return { id: mapped.cloudAssetId, client_image_id: imageId, sha256: mapped.sha256, mime_type: mapped.mimeType, file_size: 0, content_url: mapped.contentUrl }
  }
  const image = await getImage(imageId)
  if (!image?.dataUrl) throw new Error(`本地图片 ${imageId} 不存在`)
  const blob = await dataUrlToBlob(image.dataUrl)
  const asset = await uploadCloudAsset(blob, imageId, await hashBlob(blob))
  if (!isStorageScopeCurrent()) throw new Error('账号已切换')
  await mapAsset(imageId, asset)
  return asset
}

export async function downloadAsset(asset: GouoCloudAsset, imageId: string): Promise<StoredImage> {
  const existing = await getImage(imageId)
  if (existing) return existing
  const blob = await fetchCloudAssetContent(asset)
  if (asset.sha256 && await hashBlob(blob) !== asset.sha256) throw new Error('云端图片校验失败，请重试或联系管理员恢复原图')
  const image: StoredImage = { id: imageId, dataUrl: await blobToDataUrl(blob, asset.mime_type), createdAt: Date.now(), source: 'generated', width: asset.width, height: asset.height }
  if (!isStorageScopeCurrent()) throw new Error('账号已切换')
  await putImage(image)
  cacheImage(imageId, image.dataUrl)
  return image
}

// 本地没有的作品图片按需从服务端取回；透明背景作品用原图重新去除背景。
export async function fetchServerImage(imageId: string) {
  const mapped = await getCloudAssetMapItem(imageId)
  if (!mapped) return undefined
  const asset: GouoCloudAsset = { id: mapped.cloudAssetId, sha256: mapped.sha256, mime_type: mapped.mimeType || '', file_size: 0, content_url: mapped.contentUrl }
  if (!mapped.derive) return (await downloadAsset(asset, imageId)).dataUrl
  const original = await fetchCloudAssetContent(asset)
  const dataUrl = await removeKeyedBackgroundFromDataUrl(await blobToDataUrl(original, asset.mime_type))
  if (!isStorageScopeCurrent()) throw new Error('账号已切换')
  await putImage({ id: imageId, dataUrl, createdAt: Date.now(), source: 'generated' })
  cacheImage(imageId, dataUrl)
  return dataUrl
}

function getTaskResultMeta(task: TaskRecord) {
  return {
    source: task.source,
    requestId: task.requestId,
    apiProvider: task.apiProvider,
    apiProfileName: task.apiProfileName,
    gouoPriceVersion: task.gouoPriceVersion,
    gouoPriceCNY: task.gouoPriceCNY,
    actualParams: task.actualParams,
    actualParamsByImage: task.actualParamsByImage,
    revisedPromptByImage: task.revisedPromptByImage,
    transparentOutput: task.transparentOutput,
    transparentPrompt: task.transparentPrompt,
    transparentOutputImageIds: task.transparentOutput ? task.outputImages : undefined,
    outputErrors: task.outputErrors,
    elapsed: task.elapsed,
  }
}

async function serverTaskToLocal(task: GouoCloudTask): Promise<TaskRecord> {
  const meta = task.result_meta || {}
  const ids = (role: GouoCloudTaskAsset['role']) => task.assets
    .filter((link) => link.role === role)
    .sort((a, b) => a.position - b.position)
    .map((link) => link.client_image_id || `cloud-${link.asset_id}`)
  for (const link of task.assets) await mapAsset(link.client_image_id || `cloud-${link.asset_id}`, link.asset)
  const outputs = ids('output')
  const transparent = Boolean(meta.transparentOutput)
  const transparentIds = Array.isArray(meta.transparentOutputImageIds) ? meta.transparentOutputImageIds as string[] : []
  const outputImages = transparent ? outputs.map((id, index) => transparentIds[index] || `${id}~transparent`) : outputs
  if (transparent) {
    const originals = task.assets.filter((link) => link.role === 'output').sort((a, b) => a.position - b.position)
    for (const [index, id] of outputImages.entries()) await mapAsset(id, originals[index].asset, 'transparent')
  }
  return {
    id: task.client_task_id,
    prompt: task.prompt,
    source: meta.source && typeof meta.source === 'object' && ['generate', 'canvas', 'agent'].includes(String((meta.source as Record<string, unknown>).kind)) ? meta.source as TaskRecord['source'] : undefined,
    requestId: typeof meta.requestId === 'string' ? meta.requestId : task.client_task_id,
    params: task.params as unknown as TaskParams,
    apiProvider: meta.apiProvider as TaskRecord['apiProvider'],
    apiProfileName: typeof meta.apiProfileName === 'string' ? meta.apiProfileName : undefined,
    apiMode: 'images',
    apiModel: task.model,
    gouoPriceVersion: typeof meta.gouoPriceVersion === 'string' ? meta.gouoPriceVersion : undefined,
    gouoPriceCNY: typeof meta.gouoPriceCNY === 'number' && meta.gouoPriceCNY > 0 ? meta.gouoPriceCNY : undefined,
    actualParams: meta.actualParams as TaskRecord['actualParams'],
    actualParamsByImage: meta.actualParamsByImage as TaskRecord['actualParamsByImage'],
    revisedPromptByImage: meta.revisedPromptByImage as TaskRecord['revisedPromptByImage'],
    transparentOutput: transparent,
    transparentPrompt: typeof meta.transparentPrompt === 'string' ? meta.transparentPrompt : undefined,
    inputImageIds: ids('input'),
    maskTargetImageId: ids('mask_target')[0] || null,
    maskImageId: ids('mask')[0] || null,
    outputImages,
    transparentOriginalImages: transparent ? outputs : undefined,
    outputErrors: meta.outputErrors as TaskRecord['outputErrors'],
    status: task.status,
    error: task.error_message || null,
    createdAt: task.client_created_at || task.created_at,
    finishedAt: task.finished_at || null,
    elapsed: typeof meta.elapsed === 'number' ? meta.elapsed : null,
    isFavorite: Boolean(task.favorite_collection_ids?.length),
    favoriteCollectionIds: task.favorite_collection_ids || [],
    cloudId: task.id,
    cloudHiddenAt: task.hidden_at || undefined,
  }
}

// 生成这些图片的设备保留本地图片编号，只补上服务端信息，避免重新下载。
function mergeWithLocal(local: TaskRecord | undefined, server: TaskRecord): TaskRecord {
  if (!local) return server
  const keep = <T,>(a: T[] | undefined, b: T[] | undefined) => (a?.length && a.length === b?.length ? a : b)
  const defined = Object.fromEntries(Object.entries(server).filter(([, value]) => value !== undefined))
  return {
    ...local,
    ...defined,
    cloudHiddenAt: server.cloudHiddenAt,
    outputImages: keep(local.outputImages, server.outputImages) ?? [],
    transparentOriginalImages: keep(local.transparentOriginalImages, server.transparentOriginalImages),
    inputImageIds: keep(local.inputImageIds, server.inputImageIds) ?? [],
    maskImageId: local.maskImageId ?? server.maskImageId,
    maskTargetImageId: local.maskTargetImageId ?? server.maskTargetImageId,
  }
}

function applyServerTasks(serverTasks: TaskRecord[]) {
  if (!serverTasks.length || !isStorageScopeCurrent()) return
  const state = useStore.getState()
  const pending = new Map(serverTasks.map((task) => [task.id, task]))
  const changed: TaskRecord[] = []
  const next = state.tasks.map((local) => {
    const server = pending.get(local.id)
    if (!server) return local
    pending.delete(local.id)
    // 正在生成的任务以本地进度为准，完成后会再次读取。
    if (local.status === 'running') return local
    const merged = mergeWithLocal(local, server)
    changed.push(merged)
    return merged
  })
  for (const task of pending.values()) {
    next.push(task)
    changed.push(task)
  }
  applyingServer = true
  try {
    state.setTasks(next)
  } finally {
    applyingServer = false
  }
  for (const task of changed) void putTask(task)
}

// 服务端按更新时间倒序返回，读到上次已见过的记录即可停止；首次登录读取全部。
async function loadTasks(hidden: boolean) {
  const key = hidden ? 'tasks:hidden:seen' : 'tasks:seen'
  const generation = cursorGeneration
  const seen = await getCloudMeta<number>(key) || 0
  let cursor = ''
  let newest = seen
  const loaded: TaskRecord[] = []
  do {
    const page = await listCloudTasks(hidden, cursor)
    let reachedSeen = false
    for (const task of page.data) {
      if (task.updated_at <= seen) {
        reachedSeen = true
        break
      }
      newest = Math.max(newest, task.updated_at)
      loaded.push(await serverTaskToLocal(task))
    }
    cursor = reachedSeen ? '' : page.next_cursor
  } while (cursor)
  if (generation !== cursorGeneration) return
  applyServerTasks(loaded)
  await putCloudMeta(key, newest)
}

async function loadCollections() {
  const remote = await listCloudCollections()
  const remoteIds = new Set(remote.map((item) => item.id))
  const visible: FavoriteCollection[] = remote.filter((item) => !item.hidden_at).map((item) => ({ id: item.id, name: item.name, createdAt: item.created_at, updatedAt: item.updated_at }))
  // 只在本地创建、尚未写到服务端的收藏夹补交上去；上次同步时服务端有、现在没有的，是在其他设备删除后已被彻底清除，不能重新创建
  const synced = new Set(await getCloudMeta<string[]>('collections:seen') || [])
  const localOnly = useStore.getState().favoriteCollections.filter((item) => !remoteIds.has(item.id) && !synced.has(item.id))
  for (const item of localOnly) await putCloudCollection(item.id, item.name)
  await putCloudMeta('collections:seen', [...remoteIds, ...localOnly.map((item) => item.id)])
  applyingServer = true
  try {
    useStore.getState().setFavoriteCollections([...visible, ...localOnly])
  } finally {
    applyingServer = false
  }
}

// 本地清空任务后从头拉取云端作品，否则游标停在已见过的位置，旧作品不会再下载
export async function resetServerTaskCursors() {
  cursorGeneration++
  await putCloudMeta('tasks:seen', 0)
  await putCloudMeta('tasks:hidden:seen', 0)
}

export function refreshServerLibrary(): Promise<void> {
  if (!enabled) return Promise.resolve()
  // 进行中的读取用的是重置前的游标，结束后再从头读一次
  if (refreshing) return refreshingGeneration === cursorGeneration ? refreshing : refreshing.then(() => refreshServerLibrary())
  lastRefreshAt = Date.now()
  refreshingGeneration = cursorGeneration
  refreshing = (async () => {
    try {
      await loadCollections()
      await loadTasks(false)
      await loadTasks(true)
      // 回收站中的作品保留 3 天后彻底删除，与服务端清理保持一致
      const cutoff = Date.now() - GOUO_TRASH_RETENTION_MS
      const expired = useStore.getState().tasks.filter((task) => task.cloudHiddenAt && task.cloudHiddenAt < cutoff)
      if (expired.length) await purgeLocalTasks(expired.map((task) => task.id))
    } catch (err) {
      showError('读取云端作品失败', err)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

function installSubscriptions() {
  let previousTasks = useStore.getState().tasks
  let previousCollections = useStore.getState().favoriteCollections
  useStore.subscribe((state) => {
    if (state.favoriteCollections !== previousCollections) {
      const before = new Map(previousCollections.map((item) => [item.id, item]))
      const after = new Map(state.favoriteCollections.map((item) => [item.id, item]))
      previousCollections = state.favoriteCollections
      if (!applyingServer) {
        for (const item of after.values()) {
          if (before.get(item.id)?.name === item.name) continue
          // 上传成功即记为服务端已有，之后在别处删除并清除时不会被当成本地新建而补交
          putCloudCollection(item.id, item.name)
            .then(async () => putCloudMeta('collections:seen', [...new Set([...(await getCloudMeta<string[]>('collections:seen') || []), item.id])]))
            .catch((err) => showError('收藏夹未能保存到服务器', err))
        }
        for (const id of before.keys()) {
          if (!after.has(id)) hideCloudCollection(id).catch((err) => showError('收藏夹未能从服务器删除', err))
        }
      }
    }
    if (state.tasks === previousTasks) return
    const before = new Map(previousTasks.map((task) => [task.id, task]))
    previousTasks = state.tasks
    if (applyingServer) return
    for (const task of state.tasks) {
      const old = before.get(task.id)
      if (!task.cloudId || !old || old === task) continue
      const was = new Set(old.favoriteCollectionIds ?? [])
      const now = new Set(task.favoriteCollectionIds ?? [])
      for (const id of now) if (!was.has(id)) setCloudFavorite(id, task.id, true).catch((err) => showError('收藏未能保存到服务器', err))
      for (const id of was) if (!now.has(id)) setCloudFavorite(id, task.id, false).catch((err) => showError('取消收藏未能保存到服务器', err))
    }
  })
  window.addEventListener('focus', () => {
    if (Date.now() - lastRefreshAt > 60_000) void refreshServerLibrary()
  })
}

export async function startServerLibrary() {
  if (!isBackendAuthEnabled() || enabled) return
  try {
    if (!(await getCloudStorage()).enabled) return
  } catch (err) {
    showError('无法读取云端作品库状态', err)
    return
  }
  enabled = true
  installSubscriptions()
  await refreshServerLibrary()
  const { startServerDocuments } = await import('./serverDocuments')
  await startServerDocuments()
}

// 整条作品（含图片）上传，用于服务端没有保存到的作品和旧的本地作品。
async function uploadTask(task: TaskRecord) {
  const links: Array<{ imageId: string; role: GouoCloudTaskAsset['role']; position: number }> = []
  task.inputImageIds.forEach((imageId, position) => links.push({ imageId, role: 'input', position }))
  if (task.maskTargetImageId) links.push({ imageId: task.maskTargetImageId, role: 'mask_target', position: 0 })
  if (task.maskImageId) links.push({ imageId: task.maskImageId, role: 'mask', position: 0 })
  const outputs = task.transparentOriginalImages?.length ? task.transparentOriginalImages : task.outputImages
  outputs.forEach((imageId, position) => links.push({ imageId, role: 'output', position }))
  if (links.length > 32) throw new Error(`作品包含 ${links.length} 张图片，超过单个作品 32 张的上限`)
  const assets = []
  for (const link of links) {
    const asset = await uploadImage(link.imageId)
    assets.push({ asset_id: asset.id, role: link.role, position: link.position, client_image_id: link.imageId })
  }
  return putCloudTask(task.id, {
    schema_version: 1,
    status: task.status,
    prompt: task.prompt,
    model: task.apiModel || useStore.getState().settings.model || 'gpt-image-2',
    operation: task.maskImageId || task.inputImageIds.length ? 'edit' : 'generation',
    params: task.params,
    result_meta: getTaskResultMeta(task),
    error_message: task.error || '',
    client_created_at: task.createdAt,
    finished_at: task.finishedAt || 0,
    assets,
    collection_ids: (task.favoriteCollectionIds ?? []).filter((id) => useStore.getState().favoriteCollections.some((item) => item.id === id)),
  }).catch(async (err) => {
    // 服务端已清除的图片：忘掉本地记录的映射，下次重试时重新上传
    if (err instanceof GouoAssetMissingError) await deleteCloudAssetMapItems(links.map((link) => link.imageId))
    throw err
  })
}

function markSaved(taskId: string, cloud: GouoCloudTask) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) return
  const updated = { ...task, cloudId: cloud.id }
  applyingServer = true
  try {
    state.setTasks(state.tasks.map((item) => (item.id === taskId ? updated : item)))
  } finally {
    applyingServer = false
  }
  void putTask(updated)
  for (const link of cloud.assets) if (link.client_image_id) void mapAsset(link.client_image_id, link.asset)
}

// 生成完成后补充服务端无法得知的信息；服务端未能保存图片时由浏览器整条上传兜底。
export async function recordServerTask(taskId: string) {
  if (!enabled) return
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = useStore.getState().tasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'done' || !task.outputImages.length || !isStorageScopeCurrent()) return
    try {
      const outputs = task.transparentOriginalImages?.length ? task.transparentOriginalImages : task.outputImages
      // 并发批量中失败的请求不产出图片，服务端按原请求序号保存：成功图片依次对应未失败的序号。
      const failed = new Set(task.outputErrors?.map((item) => item.requestIndex))
      const positions = Array.from({ length: outputs.length + failed.size }, (_, index) => index).filter((index) => !failed.has(index))
      const meta = {
        prompt: task.prompt,
        params: task.params as unknown as Record<string, unknown>,
        result_meta: getTaskResultMeta(task),
        client_created_at: task.createdAt,
        client_image_ids: {
          output: outputs,
          input: task.inputImageIds,
          ...(task.maskImageId ? { mask: [task.maskImageId] } : {}),
        },
        ...(failed.size && positions.length === outputs.length ? { client_image_positions: { output: positions } } : {}),
        collection_ids: task.favoriteCollectionIds ?? [],
      }
      const cloud = await patchCloudTaskMeta(task.id, meta).catch(async (err) => {
        if (!/作品不存在|HTTP 404/.test(err instanceof Error ? err.message : String(err))) throw err
        return uploadTask(task)
      })
      markSaved(taskId, cloud)
      return
    } catch (err) {
      if (attempt === 2) showError('作品未能保存到服务器，已保留在本地', err)
      else await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)))
    }
  }
}

export async function hideServerTask(task: TaskRecord) {
  await setCloudTaskHidden(task.cloudId ?? task.id, true)
  const state = useStore.getState()
  state.setTasks(state.tasks.map((item) => (item.id === task.id ? { ...item, cloudHiddenAt: Date.now() } : item)))
  const updated = useStore.getState().tasks.find((item) => item.id === task.id)
  if (updated) await putTask(updated)
}

export async function restoreServerTask(task: TaskRecord) {
  await setCloudTaskHidden(task.cloudId ?? task.id, false)
  const state = useStore.getState()
  state.setTasks(state.tasks.map((item) => (item.id === task.id ? { ...item, cloudHiddenAt: undefined } : item)))
  const updated = useStore.getState().tasks.find((item) => item.id === task.id)
  if (updated) await putTask(updated)
}

// 把只存在于这台设备的旧作品上传到账户，返回成功与失败数量。
export async function importLocalTasks(onProgress?: (done: number, total: number) => void) {
  const tasks = useStore.getState().tasks.filter((task) => !task.cloudId && task.status === 'done' && task.outputImages.length > 0)
  let failed = 0
  for (const [index, task] of tasks.entries()) {
    try {
      markSaved(task.id, await uploadTask(task))
    } catch (err) {
      failed++
      console.warn('导入本地作品失败', task.id, err)
    }
    onProgress?.(index + 1, tasks.length)
  }
  return { total: tasks.length, failed }
}
