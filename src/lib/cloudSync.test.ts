import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord, StoredImage, StoredImageThumbnail, FavoriteCollection } from '../types'
import type { CloudAssetMapItem, CloudSyncQueueItem } from './db'
import type { GouoCloudAsset, GouoCloudTask, GouoCloudCollection } from './gouoBackend'
import { blobToDataUrl } from './dataUrl'

let tasks: TaskRecord[]
let images: Map<string, StoredImage>
let thumbnails: Map<string, StoredImageThumbnail>
let mappings: Map<string, CloudAssetMapItem>
let queue: Map<string, CloudSyncQueueItem>
let cloud: GouoCloudTask
let preceding: GouoCloudTask | undefined
let original: GouoCloudAsset
let preview: GouoCloudAsset
let originalBlob: Blob
let previewBlob: Blob
let cache: Map<string, string>
let writes: Array<Record<string, unknown>>
let collections: GouoCloudCollection[]

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  vi.resetModules()
  tasks = []
  preceding = undefined
  images = new Map()
  thumbnails = new Map()
  mappings = new Map()
  queue = new Map()
  cache = new Map()
  writes = []
  collections = []
  originalBlob = new Blob([new Uint8Array([137, 80, 78, 71, 10, 20, 30])], { type: 'image/png' })
  previewBlob = new Blob(['lossy webp preview'], { type: 'image/webp' })
  const hash = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map((x) => x.toString(16).padStart(2, '0')).join('')
  original = { id: 'original', sha256: await hash(originalBlob), mime_type: 'image/png', file_size: originalBlob.size, content_url: '/original' }
  preview = { id: 'preview', sha256: await hash(previewBlob), mime_type: 'image/webp', file_size: previewBlob.size, content_url: '/preview' }
  cloud = { id: 'cloud-task', client_task_id: 'task', status: 'done', schema_version: 1, prompt: '原图恢复', model: 'image', operation: 'generation', params: {}, result_meta: {}, client_created_at: 1, created_at: 1, updated_at: 1, assets: [
    { asset_id: original.id, asset: original, client_image_id: 'image', role: 'output', position: 0 },
    { asset_id: preview.id, asset: preview, client_image_id: 'image', role: 'thumbnail', position: 0 },
  ] }
  const meta = new Map<string, unknown>()
  const state = { tasks, favoriteCollections: [] as FavoriteCollection[], settings: { model: 'image' }, setTasks: (next: TaskRecord[]) => { state.tasks = next; notify() }, setFavoriteCollections: (next: FavoriteCollection[]) => { state.favoriteCollections = next; notify() } }
  const listeners = new Set<(value: typeof state) => void>()
  const notify = () => { for (const listener of listeners) listener(state) }
  vi.doMock('../store', () => ({ cacheImage: (id: string, data: string) => cache.set(id, data), useStore: {
    getState: () => state,
    setState: (patch: Partial<typeof state>) => { Object.assign(state, patch); notify() },
    subscribe: (fn: (value: typeof state) => void) => { listeners.add(fn); return () => listeners.delete(fn) },
  } }))
  vi.doMock('./storageScope', () => ({ isLoadedStorageForUser: () => true, activateUserStorage: vi.fn() }))
  vi.doMock('./db', () => ({
    getAllTasks: async () => tasks,
    getImage: async (id: string) => images.get(id),
    putImage: async (image: StoredImage) => images.set(image.id, image),
    getStoredImageThumbnail: async (id: string) => thumbnails.get(id),
    putImageThumbnail: async (image: StoredImageThumbnail) => thumbnails.set(image.id, image),
    getCloudAssetMapItem: async (id: string) => mappings.get(id),
    putCloudAssetMapItem: async (item: CloudAssetMapItem) => mappings.set(item.localImageId, item),
    getCloudSyncMeta: async (key: string) => meta.get(key),
    putCloudSyncMeta: async (key: string, value: unknown) => meta.set(key, value),
    getCloudSyncQueue: async () => [...queue.values()],
    putCloudSyncQueueItem: async (item: CloudSyncQueueItem) => queue.set(item.id, item),
    deleteCloudSyncQueueItem: async (id: string) => queue.delete(id),
    mergeSyncedTasks: async (next: TaskRecord[]) => {
      const saved = next.filter((task) => !tasks.some((item) => item.id === task.id && item.cloudSyncStatus !== 'synced'))
      tasks = [...tasks.filter((task) => !saved.some((item) => item.id === task.id)), ...saved]
      return saved
    },
    putTask: async (task: TaskRecord) => { tasks = [...tasks.filter((t) => t.id !== task.id), task] },
  }))
  vi.doMock('./gouoBackend', () => ({
    GouoRateLimitError: class extends Error { constructor(public retryAt: number) { super('限流') } },
    isBackendAuthEnabled: () => true,
    getCurrentUser: async () => ({ id: 1 }),
    getCloudStorage: async () => ({ enabled: true, used_bytes: 0, quota_bytes: 100000, remaining_bytes: 100000, asset_count: 2 }),
    getCloudSync: vi.fn(async () => ({ tasks: preceding ? [preceding, cloud] : [cloud], collections, favorite_items: [], next_cursor: 'cursor', has_more: false, server_time: 1 })),
    fetchCloudAssetContent: vi.fn(async (asset: GouoCloudAsset) => asset.id === original.id ? originalBlob : previewBlob),
    uploadCloudAsset: vi.fn(async (blob: Blob) => blob.type === original.mime_type ? original : preview),
    putCloudCollection: vi.fn(async (id: string, name: string) => {
      const previous = collections.find((item) => item.id === id)
      collections = [...collections.filter((item) => item.id !== id), { ...previous, id, name, created_at: 1, updated_at: Date.now() }]
    }),
    hideCloudCollection: vi.fn(async (id: string) => { collections = collections.map((item) => item.id === id ? { ...item, hidden_at: Date.now() } : item) }),
    setCloudTaskHidden: vi.fn(),
    putCloudTask: vi.fn(async (_id: string, input: Record<string, unknown>) => {
      writes.push(input)
      cloud = { ...cloud, prompt: input.prompt as string, assets: (input.assets as Array<{ asset_id: string; role: 'output' | 'thumbnail'; position: number; client_image_id: string }>).map((link) => ({ ...link, asset: link.asset_id === original.id ? original : preview })) }
      return cloud
    }),
  }))
})

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

describe('cloud image integrity', () => {
  it.each([false, true])('keeps original bytes and MIME across pull/download/resync, reversed=%s', async (reverse) => {
    if (reverse) cloud.assets.reverse()
    const sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    expect(mappings.get('image')).toMatchObject({ cloudAssetId: 'original', mimeType: 'image/png' })
    expect(await sync.fetchCloudImageIfNeeded('image')).toBe(await blobToDataUrl(originalBlob))
    tasks[0].cloudSyncStatus = 'pending'
    await sync.triggerCloudSync()
    expect(writes[writes.length - 1]?.assets).toContainEqual({ asset_id: 'original', role: 'output', position: 0, client_image_id: 'image' })
    expect(cloud.assets.find((x) => x.role === 'output')?.asset_id).toBe('original')
  })

  it.each([false, true])('replaces a legacy preview in disk and memory caches, reference first=%s', async (referenceFirst) => {
    if (referenceFirst) preceding = { ...cloud, id: 'reference-task', client_task_id: 'reference', assets: [{ ...cloud.assets[0], role: 'input' }] }
    mappings.set('image', { localImageId: 'image', cloudAssetId: 'preview', contentUrl: '/preview', sha256: preview.sha256, updatedAt: 0 })
    images.set('image', { id: 'image', dataUrl: await blobToDataUrl(previewBlob), createdAt: 1, source: 'generated' })
    const sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    expect(images.get('image')?.dataUrl).toBe(await blobToDataUrl(originalBlob))
    expect(cache.get('image')).toBe(await blobToDataUrl(originalBlob))
    expect(mappings.get('image')?.cloudAssetId).toBe('original')
  })

  it('uses the retained local original to repair an already corrupted cloud output', async () => {
    const sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    images.set('image', { id: 'image', dataUrl: await blobToDataUrl(originalBlob), createdAt: 1, source: 'generated' })
    cloud.assets[0] = { ...cloud.assets[0], asset_id: 'preview', asset: preview }
    mappings.set('image', { localImageId: 'image', cloudAssetId: 'preview', contentUrl: '/preview', sha256: preview.sha256, updatedAt: 0 })
    await sync.triggerCloudSync()
    await sync.triggerCloudSync()
    expect(cloud.assets.find((x) => x.role === 'output')?.asset_id).toBe('original')
    expect(images.get('image')?.dataUrl).toBe(await blobToDataUrl(originalBlob))
  })

  it('rejects content that does not match the cloud checksum without saving it', async () => {
    const sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    mappings.get('image')!.sha256 = '0'.repeat(64)
    await expect(sync.fetchCloudImageIfNeeded('image')).rejects.toThrow('校验失败')
    expect(images.has('image')).toBe(false)
  })
})

describe('cloud collection changes', () => {
  it('uploads only edits, keeps offline deletions across restart, and accepts remote renames', async () => {
    collections = [{ id: 'default', name: '默认', created_at: 1, updated_at: 1 }, { id: 'album', name: '原名', created_at: 1, updated_at: 1 }]
    const { useStore } = await import('../store')
    const backend = await import('./gouoBackend')
    let sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    expect(backend.putCloudCollection).not.toHaveBeenCalled()
    collections[1].name = '另一设备改名'
    await sync.triggerCloudSync()
    expect(useStore.getState().favoriteCollections.find((item) => item.id === 'album')?.name).toBe('另一设备改名')
    expect(backend.putCloudCollection).not.toHaveBeenCalled()
    useStore.getState().setFavoriteCollections(useStore.getState().favoriteCollections.map((item) => item.id === 'album' ? { ...item, name: '本机改名' } : item))
    await sync.triggerCloudSync()
    expect(collections.find((item) => item.id === 'album')?.name).toBe('本机改名')
    expect(backend.putCloudCollection).toHaveBeenCalledTimes(1)
    useStore.getState().setFavoriteCollections(useStore.getState().favoriteCollections.filter((item) => item.id !== 'album'))
    vi.resetModules()
    sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    expect(backend.hideCloudCollection).toHaveBeenCalledWith('album')
    expect(collections.find((item) => item.id === 'album')?.hidden_at).toBeGreaterThan(0)
    expect(useStore.getState().favoriteCollections.some((item) => item.id === 'album')).toBe(false)
    await sync.triggerCloudSync()
    expect(useStore.getState().favoriteCollections.some((item) => item.id === 'album')).toBe(false)
    expect(backend.putCloudCollection).toHaveBeenCalledTimes(1)
  })

  it('does not revive remote tombstones when a stale offline device reconnects', async () => {
    collections = [{ id: 'default', name: '默认', created_at: 1, updated_at: 1 }, { id: 'album', name: '已删除', created_at: 1, updated_at: 2, hidden_at: 2 }]
    const { useStore } = await import('../store')
    useStore.getState().setFavoriteCollections([{ id: 'album', name: '旧名称', createdAt: 1, updatedAt: 1 }])
    const sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    expect(useStore.getState().favoriteCollections.map((item) => item.id)).toEqual(['default'])
    const backend = await import('./gouoBackend')
    expect(backend.putCloudCollection).not.toHaveBeenCalled()
  })
})

describe('cloud scheduling and request budget', () => {
  it('sends edits made during upload and drains new work without another user action', async () => {
    cloud.assets = []
    const sync = await import('./cloudSync')
    const { useStore } = await import('../store')
    const backend = await import('./gouoBackend')
    await sync.startCloudSync()
    const originalPut = vi.mocked(backend.putCloudTask).getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const enteredGate = new Promise<void>((resolve) => { entered = resolve })
    vi.mocked(backend.putCloudTask).mockImplementationOnce(async (...args) => { entered(); await gate; return originalPut(...args) })
    useStore.setState({ tasks: useStore.getState().tasks.map((task) => ({ ...task, prompt: '第一版' })) })
    await enteredGate
    const task = { ...useStore.getState().tasks[0], prompt: '上传期间编辑' }
    useStore.setState({ tasks: [task, { ...task, id: 'new-task', cloudId: undefined, cloudSyncStatus: undefined }] })
    release()
    await sync.triggerCloudSync()
    expect(writes.map((input) => input.prompt)).toEqual(['第一版', '上传期间编辑', '上传期间编辑'])
    expect(queue.size).toBe(0)
    expect(useStore.getState().tasks).toHaveLength(2)
    expect(useStore.getState().tasks.every((item) => item.cloudSyncStatus === 'synced')).toBe(true)
  })

  it('automatically retries queued failures without resetting their backoff', async () => {
    cloud.assets = []
    const sync = await import('./cloudSync')
    await sync.triggerCloudSync()
    const { useStore } = await import('../store')
    useStore.getState().tasks[0].cloudSyncStatus = 'pending'
    const backend = await import('./gouoBackend')
    vi.mocked(backend.putCloudTask).mockRejectedValueOnce(new Error('临时断网'))
    await sync.triggerCloudSync()
    expect(queue.get('task:task')?.attempts).toBe(1)
    const next = queue.get('task:task')!.nextAttemptAt
    await sync.triggerCloudSync()
    expect(queue.get('task:task')?.nextAttemptAt).toBe(next)
    expect(backend.putCloudTask).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(backend.putCloudTask).toHaveBeenCalledTimes(2)
    expect(queue.size).toBe(0)
    expect(sync.getCloudSyncSnapshot().status).toBe('synced')
  })

  it('resumes a failed pull while the page is left idle', async () => {
    cloud.assets = []
    const backend = await import('./gouoBackend')
    vi.mocked(backend.getCloudSync).mockRejectedValueOnce(new Error('网络暂不可用'))
    const sync = await import('./cloudSync')
    await sync.startCloudSync()
    expect(sync.getCloudSyncSnapshot().status).toBe('error')
    await vi.advanceTimersByTimeAsync(2000)
    expect(sync.getCloudSyncSnapshot().status).toBe('synced')
  })

  it('stops a 1000-task batch at the first 429, persists the delay, then drains the queue', async () => {
    cloud.assets = []
    const backend = await import('./gouoBackend')
    const sync = await import('./cloudSync')
    const { useStore } = await import('../store')
    await sync.triggerCloudSync()
    const base = useStore.getState().tasks[0]
    const next = Array.from({ length: 1000 }, (_, index) => ({ ...base, id: `scale-${index}`, cloudId: undefined, cloudSyncStatus: 'pending' as const }))
    tasks = next
    useStore.setState({ tasks: next })
    vi.mocked(backend.getCloudSync).mockResolvedValue({ tasks: [], collections: [], favorite_items: [], next_cursor: 'cursor', has_more: false, server_time: 1 })
    vi.mocked(backend.putCloudTask).mockRejectedValueOnce(new backend.GouoRateLimitError(Date.now() + 180000))
    await sync.triggerCloudSync()
    expect(backend.putCloudTask).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(1000)
    await sync.triggerCloudSync()
    expect(backend.putCloudTask).toHaveBeenCalledTimes(1)
    const db = await import('./db')
    expect(await db.getCloudSyncMeta('retryAt')).toBe(Date.now() + 180000)
    await vi.advanceTimersByTimeAsync(180000)
    expect(queue.size).toBe(0)
    expect(backend.putCloudTask).toHaveBeenCalledTimes(1001)
    expect(sync.getCloudSyncSnapshot().status).toBe('synced')
  })

  it('reuses uploaded thumbnails when only task metadata changes', async () => {
    const sync = await import('./cloudSync')
    const backend = await import('./gouoBackend')
    await sync.triggerCloudSync()
    await sync.fetchCloudImageIfNeeded('image')
    vi.mocked(backend.fetchCloudAssetContent).mockClear()
    const { useStore } = await import('../store')
    useStore.getState().tasks[0].cloudSyncStatus = 'pending'
    await sync.triggerCloudSync()
    expect(backend.fetchCloudAssetContent).not.toHaveBeenCalled()
    expect(backend.uploadCloudAsset).not.toHaveBeenCalled()
    expect(writes[0].assets).toContainEqual({ asset_id: 'preview', role: 'thumbnail', position: 0, client_image_id: 'image' })
  })
})
