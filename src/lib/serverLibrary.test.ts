import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FavoriteCollection, TaskRecord } from '../types'
import type { GouoCloudTask } from './gouoBackend'

const asset = (id: string) => ({ id, sha256: `sha-${id}`, mime_type: 'image/png', file_size: 1, content_url: `/api/gouo/assets/${id}/content` })
const cloudTask = (patch: Partial<GouoCloudTask> = {}): GouoCloudTask => ({
  id: 'cloud-1', client_task_id: 'task-1', schema_version: 1, status: 'done', prompt: '一只猫', model: 'image', operation: 'generation',
  params: { size: '1024x1024' }, result_meta: {}, client_created_at: 1, created_at: 1, updated_at: 10,
  assets: [{ asset_id: 'a-out', role: 'output', position: 0, client_image_id: '', asset: asset('a-out') }], ...patch,
})
const localTask = (patch: Partial<TaskRecord> = {}) => ({
  id: 'task-1', prompt: '一只猫', params: { size: '1024x1024', n: 1 }, inputImageIds: [], maskTargetImageId: null, maskImageId: null,
  outputImages: ['local-out'], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1, ...patch,
}) as TaskRecord

let state: { tasks: TaskRecord[]; favoriteCollections: FavoriteCollection[]; settings: { model: string }; showToast: ReturnType<typeof vi.fn>; setTasks: (tasks: TaskRecord[]) => void; setFavoriteCollections: (items: FavoriteCollection[]) => void }
let listeners: Array<(value: typeof state) => void>
let meta: Map<string, unknown>
let assetMap: Map<string, unknown>
let pages: Record<string, GouoCloudTask[]>
let purged: string[][]

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', new EventTarget())
  listeners = []
  meta = new Map()
  assetMap = new Map()
  pages = { visible: [], hidden: [] }
  purged = []
  const notify = () => { for (const listener of listeners) listener(state) }
  state = {
    tasks: [], favoriteCollections: [], settings: { model: 'image' }, showToast: vi.fn(),
    setTasks: (tasks) => { state.tasks = tasks; notify() },
    setFavoriteCollections: (items) => { state.favoriteCollections = items; notify() },
  }
  vi.doMock('../store', () => ({ cacheImage: vi.fn(), purgeLocalTasks: vi.fn(async (ids: string[]) => { purged.push(ids) }), useStore: { getState: () => state, subscribe: (fn: (value: typeof state) => void) => { listeners.push(fn); return () => {} } } }))
  vi.doMock('./storageScope', () => ({ isStorageScopeCurrent: () => true }))
  vi.doMock('./serverDocuments', () => ({ startServerDocuments: vi.fn() }))
  vi.doMock('./db', () => ({
    getCloudAssetMapItem: async (id: string) => assetMap.get(id),
    deleteCloudAssetMapItems: async (ids: string[]) => { for (const id of ids) assetMap.delete(id) },
    putCloudAssetMapItem: async (item: { localImageId: string }) => assetMap.set(item.localImageId, item),
    getCloudMeta: async (key: string) => meta.get(key),
    putCloudMeta: async (key: string, value: unknown) => meta.set(key, value),
    getImage: async (id: string) => ({ id, dataUrl: 'data:image/png;base64,AQID', createdAt: 1, source: 'generated' }),
    putImage: vi.fn(),
    putTask: vi.fn(),
  }))
  vi.doMock('./gouoBackend', () => ({
    GOUO_TRASH_RETENTION_MS: 3 * 24 * 60 * 60 * 1000,
    GouoAssetMissingError: class extends Error {},
    isBackendAuthEnabled: () => true,
    getCloudStorage: vi.fn(async () => ({ enabled: true })),
    listCloudCollections: vi.fn(async () => []),
    listCloudTasks: vi.fn(async (hidden: boolean) => ({ data: pages[hidden ? 'hidden' : 'visible'], next_cursor: '' })),
    patchCloudTaskMeta: vi.fn(async () => cloudTask({ assets: [{ asset_id: 'a-out', role: 'output', position: 0, client_image_id: 'local-out', asset: asset('a-out') }] })),
    putCloudTask: vi.fn(async () => cloudTask()),
    uploadCloudAsset: vi.fn(async () => asset('uploaded')),
    putCloudCollection: vi.fn(),
    hideCloudCollection: vi.fn(),
    setCloudFavorite: vi.fn(async () => {}),
    setCloudTaskHidden: vi.fn(),
    fetchCloudAssetContent: vi.fn(),
  }))
})

describe('server library', () => {
  it('records client metadata with local image ids after generation', async () => {
    const backend = await import('./gouoBackend')
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    state.setTasks([localTask({ requestId: 'agent:conv:call', favoriteCollectionIds: ['album'] })])
    await library.recordServerTask('task-1')
    expect(backend.patchCloudTaskMeta).toHaveBeenCalledWith('task-1', expect.objectContaining({
      prompt: '一只猫',
      client_image_ids: { output: ['local-out'], input: [] },
      collection_ids: ['album'],
    }))
    expect(vi.mocked(backend.patchCloudTaskMeta).mock.calls[0][1]).not.toHaveProperty('client_image_positions')
    expect(state.tasks[0].cloudId).toBe('cloud-1')
    expect(backend.putCloudTask).not.toHaveBeenCalled()
  })

  it('sends the original request positions when part of a batch failed', async () => {
    const backend = await import('./gouoBackend')
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    // 4 张中第 0、2 个请求失败（含服务端已生成但浏览器下载失败），成功图片对应位置 1、3
    state.setTasks([localTask({ outputImages: ['local-b', 'local-d'], outputErrors: [{ requestIndex: 0, error: '失败' }, { requestIndex: 2, error: '下载失败' }] })])
    await library.recordServerTask('task-1')
    expect(backend.patchCloudTaskMeta).toHaveBeenCalledWith('task-1', expect.objectContaining({
      client_image_ids: { output: ['local-b', 'local-d'], input: [] },
      client_image_positions: { output: [1, 3] },
    }))
  })

  it('uploads the whole task when the server did not keep the generation', async () => {
    const backend = await import('./gouoBackend')
    vi.mocked(backend.patchCloudTaskMeta).mockRejectedValueOnce(new Error('作品不存在'))
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    state.setTasks([localTask()])
    await library.recordServerTask('task-1')
    expect(backend.uploadCloudAsset).toHaveBeenCalledTimes(1)
    expect(backend.putCloudTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ assets: [{ asset_id: 'uploaded', role: 'output', position: 0, client_image_id: 'local-out' }] }))
    expect(state.tasks[0].cloudId).toBe('cloud-1')
  })

  it('loads server works, keeps local image ids, derives transparent outputs, and reads only newer pages later', async () => {
    pages.visible = [
      cloudTask(),
      cloudTask({ id: 'cloud-2', client_task_id: 'task-2', updated_at: 9, result_meta: { transparentOutput: true }, assets: [{ asset_id: 'a-raw', role: 'output', position: 0, client_image_id: '', asset: asset('a-raw') }] }),
    ]
    const backend = await import('./gouoBackend')
    const library = await import('./serverLibrary')
    state.tasks = [localTask()]
    await library.startServerLibrary()
    const generated = state.tasks.find((task) => task.id === 'task-1')!
    expect(generated).toMatchObject({ cloudId: 'cloud-1', outputImages: ['local-out'] })
    const other = state.tasks.find((task) => task.id === 'task-2')!
    expect(other).toMatchObject({ transparentOutput: true, transparentOriginalImages: ['cloud-a-raw'], outputImages: ['cloud-a-raw~transparent'] })
    expect(assetMap.get('cloud-a-raw~transparent')).toMatchObject({ cloudAssetId: 'a-raw', derive: 'transparent' })
    expect(meta.get('tasks:seen')).toBe(10)
    vi.mocked(backend.listCloudTasks).mockClear()
    pages.visible = [cloudTask({ updated_at: 12, prompt: '改名后' }), cloudTask({ id: 'cloud-2', client_task_id: 'task-2', updated_at: 9 })]
    await library.refreshServerLibrary()
    expect(state.tasks.find((task) => task.id === 'task-1')?.prompt).toBe('改名后')
    expect(meta.get('tasks:seen')).toBe(12)
  })

  it('downloads all server works again after local tasks are cleared', async () => {
    pages.visible = [cloudTask()]
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    expect(state.tasks.map((task) => task.id)).toEqual(['task-1'])
    // 本地清空任务：游标仍停在已见过的位置时，刷新拿不回旧作品
    state.setTasks([])
    await library.resetServerTaskCursors()
    await library.refreshServerLibrary()
    expect(state.tasks.map((task) => task.id)).toEqual(['task-1'])
  })

  it('does not recreate a collection that was purged on the server after it had been synced', async () => {
    const backend = await import('./gouoBackend')
    vi.mocked(backend.listCloudCollections).mockResolvedValueOnce([{ id: 'old-album', name: '旧', created_at: 1, updated_at: 1, hidden_at: 0 }] as never)
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    // 之后在其他设备删除并被彻底清除；本设备还留着它，另有一个刚在本地新建、尚未上传的收藏夹
    vi.mocked(backend.putCloudCollection).mockRejectedValue(new Error('offline'))
    state.setFavoriteCollections([{ id: 'old-album', name: '旧', createdAt: 1, updatedAt: 1 }, { id: 'new-album', name: '新', createdAt: 2, updatedAt: 2 }])
    vi.mocked(backend.putCloudCollection).mockReset().mockResolvedValue(undefined as never)
    await library.refreshServerLibrary()
    expect(backend.putCloudCollection).toHaveBeenCalledWith('new-album', '新')
    expect(backend.putCloudCollection).not.toHaveBeenCalledWith('old-album', expect.anything())
    expect(state.favoriteCollections.map((item) => item.id)).toEqual(['new-album'])
  })

  it('a sync started before local tasks were cleared does not write back its old cursor', async () => {
    pages.visible = [cloudTask()]
    const backend = await import('./gouoBackend')
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    // 按旧游标的读取还在等待响应时，本地清空任务并重置游标
    let release: (() => void) | undefined
    vi.mocked(backend.listCloudTasks).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { data: [], next_cursor: '' }
    })
    const stale = library.refreshServerLibrary()
    await vi.waitFor(() => expect(release).toBeDefined())
    state.setTasks([])
    await library.resetServerTaskCursors()
    const fresh = library.refreshServerLibrary()
    release!()
    await Promise.all([stale, fresh])
    expect(state.tasks.map((task) => task.id)).toEqual(['task-1'])
    expect(meta.get('tasks:seen')).toBe(10)
  })

  it('does not recreate a collection this device uploaded after it was purged elsewhere', async () => {
    const backend = await import('./gouoBackend')
    vi.mocked(backend.putCloudCollection).mockResolvedValue(undefined as never)
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    state.setFavoriteCollections([{ id: 'fresh', name: '新', createdAt: 1, updatedAt: 1 }])
    await vi.waitFor(() => expect(meta.get('collections:seen')).toContain('fresh'))
    vi.mocked(backend.putCloudCollection).mockClear()
    // 在其他设备删除并被服务端彻底清除后刷新
    await library.refreshServerLibrary()
    expect(backend.putCloudCollection).not.toHaveBeenCalled()
    expect(state.favoriteCollections).toEqual([])
  })

  it('writes favorite changes directly but not when applying server data', async () => {
    pages.visible = [cloudTask({ favorite_collection_ids: ['album'] })]
    const backend = await import('./gouoBackend')
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    expect(backend.setCloudFavorite).not.toHaveBeenCalled()
    state.setTasks(state.tasks.map((task) => ({ ...task, favoriteCollectionIds: ['other'] })))
    expect(backend.setCloudFavorite).toHaveBeenCalledWith('other', 'task-1', true)
    expect(backend.setCloudFavorite).toHaveBeenCalledWith('album', 'task-1', false)
  })

  it('purges local tasks that stayed in the recycle bin past the retention period', async () => {
    const library = await import('./serverLibrary')
    const day = 24 * 60 * 60 * 1000
    state.tasks = [localTask({ id: 'old', cloudHiddenAt: Date.now() - 4 * day }), localTask({ id: 'recent', cloudHiddenAt: Date.now() - day }), localTask({ id: 'visible' })]
    await library.startServerLibrary()
    expect(purged).toEqual([['old']])
  })

  it('forgets cached cloud image ids when the server no longer has the image', async () => {
    const backend = await import('./gouoBackend')
    vi.mocked(backend.patchCloudTaskMeta).mockRejectedValue(new Error('作品不存在'))
    vi.mocked(backend.putCloudTask).mockRejectedValue(new backend.GouoAssetMissingError('图片已清除'))
    assetMap.set('local-out', { localImageId: 'local-out', cloudAssetId: 'purged', contentUrl: '', sha256: '', mimeType: 'image/png', updatedAt: 1 })
    const library = await import('./serverLibrary')
    await library.startServerLibrary()
    state.setTasks([localTask()])
    // 首次上传失败后立即清除映射，之后的重试会重新上传图片
    void library.recordServerTask('task-1')
    await vi.waitFor(() => expect(backend.putCloudTask).toHaveBeenCalled())
    await vi.waitFor(() => expect(assetMap.has('local-out')).toBe(false))
  })
})
