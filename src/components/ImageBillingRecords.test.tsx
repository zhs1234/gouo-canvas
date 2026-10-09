import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import ImageBillingRecords from './ImageBillingRecords'

const mocks = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, ref: undefined as { current: unknown } | undefined,
  effect: undefined as (() => (() => void)) | undefined,
  getImageCharges: vi.fn(),
}))

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = mocks.index++
    if (!(index in mocks.values)) mocks.values[index] = initial
    return [mocks.values[index], (value: unknown) => { mocks.values[index] = value }]
  },
  useRef: (value: unknown) => mocks.ref ??= { current: value },
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => (() => void)) => { mocks.effect = effect },
}))
vi.mock('../lib/gouoBackend', () => ({ getImageCharges: mocks.getImageCharges }))

const render = () => { mocks.index = 0; return renderToStaticMarkup(<ImageBillingRecords />) }
const charge = { id: 'new-request', model_name: 'image-model', price_cny: 0.01, status: 'settled', created_at: 1, note: '' }

beforeEach(() => { mocks.values = []; mocks.ref = undefined; mocks.effect = undefined; mocks.getImageCharges.mockReset() })

it('does not show an empty success state or stale rows when refreshing charges fails', async () => {
  mocks.getImageCharges.mockResolvedValueOnce({ data: [charge], total_count: 1 })
  render()
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('new-request'))
  mocks.getImageCharges.mockRejectedValueOnce(new Error('账务服务暂不可用'))
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('账务服务暂不可用'))
  expect(render()).not.toContain('暂无图片请求记录')
  expect(render()).not.toContain('new-request')
  expect(render()).toContain('分页信息不可用')
})

it('keeps the latest charge response and ignores a late failure from an older request', async () => {
  let rejectOld!: (error: Error) => void
  mocks.getImageCharges.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
  mocks.getImageCharges.mockResolvedValueOnce({ data: [charge], total_count: 1 })
  render()
  mocks.effect!()
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('new-request'))
  rejectOld(new Error('过期的失败'))
  await Promise.resolve()
  expect(render()).toContain('new-request')
  expect(render()).not.toContain('过期的失败')
})
