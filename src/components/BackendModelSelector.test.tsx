import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import BackendModelSelector from './BackendModelSelector'

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as (() => void | (() => void))[],
  state: { settings: { model: 'image-b' }, params: { n: 1 }, inputImages: [] as string[], maskDraft: null as object | null },
}))

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [mocks.values[mocks.index++], vi.fn()],
  useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect) },
}))
vi.mock('../store', () => ({ useStore: (select: (state: typeof mocks.state) => unknown) => select(mocks.state) }))
vi.mock('../lib/gouoBackend', () => ({ getImageModels: vi.fn() }))

beforeEach(() => {
  mocks.values = [[{ id: 'image-b', name: '图片 B', price_cny: 0.1, price_version: 'version-b', reference: false, mask: false, max_outputs: 1, quota: 100 }], '', false]
  mocks.index = 0
  mocks.effects = []
  mocks.state = { settings: { model: 'image-b' }, params: { n: 1 }, inputImages: [], maskDraft: null }
})

it.each([[1, '0.10'], [2, '0.20'], [10, '1.00']])('allows %s total images with a single-image model and estimates the total', (n, total) => {
  mocks.state.params.n = n
  const onReady = vi.fn()
  const markup = renderToStaticMarkup(<BackendModelSelector compact showEstimate onReady={onReady} />)
  mocks.effects[1]()
  expect(onReady).toHaveBeenCalledWith(true)
  expect(markup).toContain(`预计 ¥${total}`)
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
  expect(markup).not.toContain('预计 ¥')
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
  expect(markup).not.toContain('预计 ¥')
})
