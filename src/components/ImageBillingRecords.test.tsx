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
const charge = { id: 'new-request', model_name: 'image-model', price_cny: 0.01, status: 'needs_review', created_at: 1, note: '' }
// 按状态分三次查询，只有“待核对”返回记录
const pendingOnly = (_page: number, status: string) => Promise.resolve({ data: status === 'needs_review' ? [charge] : [], total_count: status === 'needs_review' ? 1 : 0 })
vi.mock('../lib/clipboard', () => ({ copyTextToClipboard: vi.fn() }))

beforeEach(() => { mocks.values = []; mocks.ref = undefined; mocks.effect = undefined; mocks.getImageCharges.mockReset() })

it('lists only pending requests and renders nothing when none need attention', async () => {
  mocks.getImageCharges.mockImplementation(pendingOnly)
  render()
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('new-request'))
  expect(render()).toContain('1 个图片请求待处理')
  expect(mocks.getImageCharges.mock.calls.map((call) => call[1]).sort()).toEqual(['dispatched', 'needs_review', 'reserved'])
  mocks.getImageCharges.mockImplementation(() => Promise.resolve({ data: [], total_count: 0 }))
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toBe(''))
})

it('does not show stale rows when refreshing charges fails', async () => {
  mocks.getImageCharges.mockImplementation(pendingOnly)
  render()
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('new-request'))
  mocks.getImageCharges.mockImplementation(() => Promise.reject(new Error('账务服务暂不可用')))
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('账务服务暂不可用'))
  expect(render()).not.toContain('new-request')
})

it('keeps the latest charge response and ignores a late failure from an older request', async () => {
  const rejects: Array<(error: Error) => void> = []
  mocks.getImageCharges.mockImplementation(() => new Promise((_resolve, reject) => { rejects.push(reject) }))
  render()
  mocks.effect!()
  mocks.getImageCharges.mockImplementation(pendingOnly)
  mocks.effect!()
  await vi.waitFor(() => expect(render()).toContain('new-request'))
  for (const reject of rejects) reject(new Error('过期的失败'))
  await Promise.resolve()
  expect(render()).toContain('new-request')
  expect(render()).not.toContain('过期的失败')
})
