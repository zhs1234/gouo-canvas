import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AccountBalance from './AccountBalance'

const mocks = vi.hoisted(() => ({
  balance: 'loading' as number | string,
  effect: undefined as (() => (() => void)) | undefined,
  dependencies: [] as unknown[],
  tasks: [] as { status: string }[],
  getCurrentUser: vi.fn(),
  setBalance: vi.fn(),
}))

// 用轻量 hook 驱动器检查真实刷新副作用，避免为按钮引入 DOM 测试依赖。
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: () => [mocks.balance, mocks.setBalance],
  useEffect: (effect: () => (() => void), dependencies: unknown[]) => {
    mocks.effect = effect
    mocks.dependencies = dependencies
  },
}))
vi.mock('../store', () => ({ useStore: (select: (state: { tasks: typeof mocks.tasks }) => unknown) => select({ tasks: mocks.tasks }) }))
vi.mock('../lib/gouoBackend', () => ({ getCurrentUser: mocks.getCurrentUser }))

let cleanup: (() => void) | undefined
let page: EventTarget & { visibilityState: string }

beforeEach(() => {
  vi.useFakeTimers()
  mocks.balance = 'loading'
  mocks.tasks = []
  mocks.getCurrentUser.mockReset()
  mocks.setBalance.mockReset().mockImplementation((value: number | string) => { mocks.balance = value })
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', new EventTarget())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([
  [0, '余额 ¥0.00'],
  [9999, '余额 ¥9999.00'],
  [undefined, '余额暂不可用'],
  [NaN, '余额暂不可用'],
  [Infinity, '余额暂不可用'],
  ['12.50', '余额暂不可用'],
])('renders only finite numeric balance %s without substituting a fake zero', async (balance, expected) => {
  mocks.getCurrentUser.mockResolvedValue({ balance_cny: balance })
  const onClick = vi.fn()
  expect(renderToStaticMarkup(<AccountBalance onClick={onClick} />)).toContain('余额 …')
  cleanup = mocks.effect!()
  await Promise.resolve()
  const markup = renderToStaticMarkup(<AccountBalance onClick={onClick} />)
  expect(markup).toContain(expected)
  expect(markup).toContain(`aria-label="${expected}，打开用户中心"`)
  expect(onClick).not.toHaveBeenCalled()
})

it('replaces a previous balance with an unavailable message after refresh fails', async () => {
  mocks.getCurrentUser.mockResolvedValueOnce({ balance_cny: 20 }).mockRejectedValueOnce(new Error('offline'))
  renderToStaticMarkup(<AccountBalance onClick={() => {}} />)
  cleanup = mocks.effect!()
  await Promise.resolve()
  window.dispatchEvent(new Event('focus'))
  await Promise.resolve()
  expect(renderToStaticMarkup(<AccountBalance onClick={() => {}} />)).toContain('余额暂不可用')
  expect(console.warn).toHaveBeenCalledWith('读取账户余额失败', expect.any(Error))
})

it('ignores older requests and responses after unmount', async () => {
  const requests: ((value: { balance_cny: number }) => void)[] = []
  mocks.getCurrentUser.mockImplementation(() => new Promise((resolve) => requests.push(resolve)))
  renderToStaticMarkup(<AccountBalance onClick={() => {}} />)
  cleanup = mocks.effect!()
  window.dispatchEvent(new Event('focus'))
  requests[1]({ balance_cny: 8 })
  await Promise.resolve()
  requests[0]({ balance_cny: 10 })
  await Promise.resolve()
  expect(mocks.balance).toBe(8)
  window.dispatchEvent(new Event('focus'))
  cleanup()
  cleanup = undefined
  requests[2]({ balance_cny: 4 })
  await Promise.resolve()
  expect(mocks.balance).toBe(8)
})

it('refreshes while visible, on focus and visibility restoration, and cleans up listeners and polling', async () => {
  mocks.getCurrentUser.mockResolvedValue({ balance_cny: 1 })
  mocks.tasks = [{ status: 'running' }, { status: 'done' }]
  renderToStaticMarkup(<AccountBalance refreshKey onClick={() => {}} />)
  expect(mocks.dependencies).toEqual([1, true])
  cleanup = mocks.effect!()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2)
  page.visibilityState = 'hidden'
  window.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2)
  page.visibilityState = 'visible'
  page.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('focus'))
  expect(mocks.getCurrentUser).toHaveBeenCalledTimes(4)
  cleanup()
  cleanup = undefined
  window.dispatchEvent(new Event('focus'))
  page.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.getCurrentUser).toHaveBeenCalledTimes(4)
})
