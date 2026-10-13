import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import BackendModelSelector from './BackendModelSelector'

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
  state: { settings: { model: 'image-b' } as { model: string; gouoModelSelected?: boolean }, params: { n: 1 }, inputImages: [] as string[], maskDraft: null as object | null },
  setSettings: vi.fn(),
  getImageModels: vi.fn(),
}))

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [mocks.values[mocks.index++], vi.fn()],
  useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect) },
}))
vi.mock('../store', () => ({ useStore: Object.assign((select: (state: typeof mocks.state) => unknown) => select(mocks.state), { getState: () => ({ settings: mocks.state.settings, setSettings: mocks.setSettings }) }) }))
vi.mock('../lib/gouoBackend', async (original) => ({ ...await original<typeof import('../lib/gouoBackend')>(), getImageModels: mocks.getImageModels }))

beforeEach(() => {
  mocks.values = [[{ id: 'image-b', name: '图片 B', price_cny: 0.1, price_version: 'version-b', reference: false, mask: false, max_outputs: 1, quota: 100 }], '', false]
  mocks.index = 0
  mocks.effects = []
  mocks.setSettings.mockReset()
  mocks.state = { settings: { model: 'image-b' }, params: { n: 1 }, inputImages: [], maskDraft: null }
})

it.each([[1, '10'], [2, '20'], [10, '100']])('allows %s total images with a single-image model and estimates the total', (n, total) => {
  mocks.state.params.n = n
  const onReady = vi.fn()
  const markup = renderToStaticMarkup(<BackendModelSelector compact showEstimate onReady={onReady} />)
  mocks.effects[1]()
  expect(onReady).toHaveBeenCalledWith(true)
  expect(markup).toContain(`预计 ${total} 积分`)
  expect(markup).toContain('按成功张数计费')
  expect(markup).not.toContain('最多支持 1 张')
})

it.each([0, 11, 1.5])('disables submission for invalid total image count %s', (n) => {
  mocks.state.params.n = n
  const onReady = vi.fn()
  const markup = renderToStaticMarkup(<BackendModelSelector compact showEstimate onReady={onReady} />)
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
  const markup = renderToStaticMarkup(<BackendModelSelector compact showEstimate onReady={onReady} />)
  mocks.effects[1]()
  expect(onReady).toHaveBeenCalledWith(false)
  expect(markup).toContain('此模型不支持当前编辑操作')
})

it('keeps the home estimate out of the compact Agent selector by default', () => {
  mocks.state.params.n = 2
  const markup = renderToStaticMarkup(<BackendModelSelector compact onReady={() => {}} />)
  expect(markup).not.toContain('预计 ')
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
