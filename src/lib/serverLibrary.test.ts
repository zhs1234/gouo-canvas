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

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', new EventTarget())
  listeners = []
  meta = new Map()
  assetMap = new Map()
  pages = { visible: [], hidden: [] }
  const notify = () => { for (const listener of listeners) listener(state) }
  state = {
    tasks: [], favoriteCollections: [], settings: { model: 'image' }, showToast: vi.fn(),
    setTasks: (tasks) => { state.tasks = tasks; notify() },
    setFavoriteCollections: (items) => { state.favoriteCollections = items; notify() },
  }
  vi.doMock('../store', () => ({ cacheImage: vi.fn(), useStore: { getState: () => state, subscribe: (fn: (value: typeof state) => void) => { listeners.push(fn); return () => {} } } }))
  vi.doMock('./storageScope', () => ({ isStorageScopeCurrent: () => true }))
  vi.doMock('./serverDocuments', () => ({ startServerDocuments: vi.fn() }))
  vi.doMock('./db', () => ({
    getCloudAssetMapItem: async (id: string) => assetMap.get(id),
    putCloudAssetMapItem: async (item: { localImageId: string }) => assetMap.set(item.localImageId, item),
    getCloudMeta: async (key: string) => meta.get(key),
    putCloudMeta: async (key: string, value: unknown) => meta.set(key, value),
    getImage: async (id: string) => ({ id, dataUrl: 'data:image/png;base64,AQID', createdAt: 1, source: 'generated' }),
    putImage: vi.fn(),
    putTask: vi.fn(),
  }))
  vi.doMock('./gouoBackend', () => ({
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
    expect(state.tasks[0].cloudId).toBe('cloud-1')
    expect(backend.putCloudTask).not.toHaveBeenCalled()
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
})
