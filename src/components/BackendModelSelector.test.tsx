import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import BackendModelSelector from './BackendModelSelector'

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  initials: [] as unknown[],
  cached: [] as unknown[],
  effects: [] as (() => void | (() => void))[],
  state: { settings: { model: 'image-b' } as { model: string; gouoModelSelected?: boolean }, params: { n: 1, size: 'auto', quality: 'auto' }, inputImages: [] as string[], maskDraft: null as object | null },
  setSettings: vi.fn(),
  getImageModels: vi.fn(),
  setters: [] as ReturnType<typeof vi.fn>[],
}))

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    mocks.initials.push(typeof initial === 'function' ? initial() : initial)
    const setter = vi.fn()
    mocks.setters.push(setter)
    return [mocks.values[mocks.index++], setter]
  },
  useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect) },
}))
vi.mock('../store', () => ({ useStore: Object.assign((select: (state: typeof mocks.state) => unknown) => select(mocks.state), { getState: () => ({ settings: mocks.state.settings, setSettings: mocks.setSettings }) }) }))
vi.mock('../lib/gouoBackend', async (original) => ({ ...await original<typeof import('../lib/gouoBackend')>(), getImageModels: mocks.getImageModels, getCachedImageModels: () => mocks.cached }))

beforeEach(() => {
  mocks.values = [[{ id: 'image-b', name: '图片 B', price_cny: 0.1, price_version: 'version-b', reference: false, mask: false, max_outputs: 1, quota: 100 }], '', false]
  mocks.index = 0
  mocks.initials = []
  mocks.cached = []
  mocks.setters = []
  mocks.effects = []
  mocks.setSettings.mockReset()
  mocks.state = { settings: { model: 'image-b' }, params: { n: 1, size: 'auto', quality: 'auto' }, inputImages: [], maskDraft: null }
})

it.each([1, 2, 10])('allows %s total images with a single-image model and shows no price', (n) => {
  mocks.state.params.n = n
  const onReady = vi.fn()
  const markup = renderToStaticMarkup(<BackendModelSelector compact onReady={onReady} />)
  mocks.effects[1]()
  expect(onReady).toHaveBeenCalledWith(true)
  expect(markup).not.toContain('积分')
  expect(markup).not.toContain('最多支持 1 张')
})

it.each([0, 11, 1.5])('disables submission for invalid total image count %s', (n) => {
  mocks.state.params.n = n
  const onReady = vi.fn()
  const markup = renderToStaticMarkup(<BackendModelSelector compact onReady={onReady} />)
  mocks.effects[1]()
  expect(onReady).toHaveBeenCalledWith(false)
  expect(markup).toContain('图片总数量必须为 1 到 10 的整数')
  expect(markup).not.toContain('预计 ')
})

it.each(['reference', 'mask'])('keeps the %s capability guard when multiple images are requested', (capability) => {
  mocks.state.params.n = 2
  if (capability === 'reference') mocks.state.inputImages = ['reference-image']
  else mocks.state.maskDraft = {}
  const onReady = vi.fn()
  const markup = renderToStaticMarkup(<BackendModelSelector compact onReady={onReady} />)
  mocks.effects[1]()
  expect(onReady).toHaveBeenCalledWith(false)
  expect(markup).toContain('此模型不支持当前编辑操作')
})

it('switches to the backend default model when the user has not picked one', async () => {
  const model = (id: string, isDefault = false) => ({ id, name: id, price_cny: 0.1, price_version: `v-${id}`, reference: true, mask: true, max_outputs: 1, quota: 1, ...(isDefault ? { default: true } : {}) })
  mocks.getImageModels.mockResolvedValue([model('image-a'), model('image-c', true)])
  mocks.state.settings = { model: 'gpt-image-2' }
  renderToStaticMarkup(<BackendModelSelector onReady={() => {}} />)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  try {
    mocks.effects[0]()
    await vi.waitFor(() => expect(mocks.setSettings).toHaveBeenCalledWith({ model: 'image-c', gouoModelSelected: false, gouoPriceVersion: 'v-image-c' }))
  } finally {
    vi.unstubAllGlobals()
  }
})

it('shows the cached catalog right away and refreshes it in the background', async () => {
  const cached = [{ id: 'image-b', name: '图片 B', price_cny: 0.1, price_version: 'version-b', reference: false, mask: false, max_outputs: 1, quota: 100 }]
  mocks.cached = cached
  mocks.getImageModels.mockRejectedValue(new Error('网络中断'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  renderToStaticMarkup(<BackendModelSelector onReady={() => {}} />)
  expect(mocks.initials[0]).toBe(cached)
  expect(mocks.initials[2]).toBe(false)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  try {
    mocks.effects[0]()
    await vi.waitFor(() => expect(mocks.getImageModels).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    const [setModels, setError, setLoading] = mocks.setters
    expect(setLoading).not.toHaveBeenCalledWith(true)
    expect(setError).not.toHaveBeenCalled()
    expect(setModels).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('waits for the first catalog when nothing is cached yet', () => {
  renderToStaticMarkup(<BackendModelSelector onReady={() => {}} />)
  expect(mocks.initials[0]).toEqual([])
  expect(mocks.initials[2]).toBe(true)
})
