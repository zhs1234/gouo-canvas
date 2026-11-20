import { type ReactElement, type ReactNode, isValidElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GouoUser } from '../../lib/gouoBackend'
import type { TopupPayment } from '../../lib/topup'
import OnlineTopupCard from './OnlineTopupCard'
import TopupPayDialog from './TopupPayDialog'
import TopupSection from './TopupSection'

// 直接驱动组件事件与 hook 状态（同 accountForms.test），不引入 DOM 测试依赖
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }))
const api = vi.hoisted(() => ({ backendRequest: vi.fn(), redeemCode: vi.fn(), getImagePrice: vi.fn() }))
vi.mock('react', async (load) => ({
  ...await load<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial
    return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value }]
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => {
    const index = state.cursor++
    if (index in state.slots) return
    state.slots[index] = true
    state.effects.push(effect)
  },
}))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../../lib/gouoBackend', () => api)
vi.mock('../../hooks/useImageModels', () => ({ useImageModels: () => [] }))
vi.mock('../../hooks/useCloseOnEscape', () => ({ useCloseOnEscape: () => {} }))

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function button(node: ReactNode, label: string) {
  const found = elements(node).find((element) => element.type === 'button' && text(element).includes(label))
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
function render(component: () => ReactNode) {
  state.cursor = 0
  return component()
}
async function flush() {
  for (const effect of state.effects.splice(0)) effect()
  await vi.advanceTimersByTimeAsync(0)
}

const options = { packages: [{ price: 10, points: 1000, bonus: 0 }, { price: 50, points: 5000, bonus: 150 }], custom: { min: 5, max: 2000 } }
const gateway = { uuid: 'g1', name: '支付宝', icon: '', fixed_fee: 0, percent_fee: 0.01, currency: 'CNY', sort: 1 }
const order = (status: string) => ({ trade_no: 'T1', status, points: 5150, pay_amount: 50.5, currency: 'CNY', created_at: 1_700_000_000 })
const payment: TopupPayment = { trade_no: 'T1', type: 1, data: { url: 'https://pay.example/submit', method: 'POST', params: { pid: 1 } }, pay_amount: 50.5, currency: 'CNY', points: 5150 }
let history: { state: unknown; replaceState: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  state.slots = []
  state.effects = []
  state.cursor = 0
  vi.resetAllMocks()
  history = { state: { idx: 1 }, replaceState: vi.fn() }
  vi.stubGlobal('window', { location: { pathname: '/', search: '', hash: '#/generate' }, history, open: vi.fn() })
  vi.stubGlobal('document', { body: { appendChild: vi.fn() }, createElement: () => ({ appendChild: vi.fn(), submit: vi.fn(), remove: vi.fn() }) })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('选择积分包和唯一的支付方式后下单，跳转支付立即提交表单', async () => {
  api.backendRequest.mockImplementation(async (path: string) => path === '/api/user/payment' ? [gateway] : payment)
  const onOrderCreated = vi.fn()
  const draw = () => OnlineTopupCard({ options, onOrderCreated })
  render(draw)
  await flush()
  let tree = render(draw)
  // 只有一种支付方式时直接选中，默认选中第一个积分包
  expect(button(tree, '支付宝').props['aria-pressed']).toBe(true)
  expect(button(tree, '¥10').props['aria-pressed']).toBe(true)
  expect(text(tree)).toContain('该支付方式收取手续费')
  ;(button(tree, '¥50').props.onClick as () => void)()
  tree = render(draw)
  expect(text(tree)).toContain('到账 5,150 积分')
  const form = { appendChild: vi.fn(), submit: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', { body: { appendChild: vi.fn() }, createElement: (tag: string) => tag === 'form' ? form : {} })
  ;(button(tree, '立即支付').props.onClick as () => void)()
  await vi.advanceTimersByTimeAsync(0)
  expect(api.backendRequest).toHaveBeenLastCalledWith('/api/gouo/topup/order', { method: 'POST', body: '{"gateway":"g1","package":1,"price":50,"points":5150}' })
  expect(form.submit).toHaveBeenCalledOnce()
  expect(onOrderCreated).toHaveBeenCalledWith(payment)
})

it('后台改过积分包导致下单失败时显示原因并重新读取配置', async () => {
  api.backendRequest.mockImplementation(async (path: string) => {
    if (path === '/api/user/payment') return [gateway]
    throw new Error('积分包已更新，请重新选择后再支付')
  })
  const onOrderCreated = vi.fn()
  const onOrderFailed = vi.fn()
  const draw = () => OnlineTopupCard({ options, onOrderCreated, onOrderFailed })
  render(draw)
  await flush()
  const tree = render(draw)
  ;(button(tree, '立即支付').props.onClick as () => void)()
  await vi.advanceTimersByTimeAsync(0)
  expect(text(render(draw))).toContain('积分包已更新，请重新选择后再支付')
  expect(onOrderFailed).toHaveBeenCalledOnce()
  expect(onOrderCreated).not.toHaveBeenCalled()
})

it('自定义金额校验整数范围，没有支付方式时提示改用兑换码', async () => {
  api.backendRequest.mockImplementation(async (path: string) => path === '/api/user/payment' ? null : { ...payment, type: 2, data: { url: 'https://qr.alipay.com/x' } })
  const onOrderCreated = vi.fn()
  const draw = () => OnlineTopupCard({ options, onOrderCreated })
  render(draw)
  await flush()
  let tree = render(draw)
  expect(text(tree)).toContain('暂无可用支付方式，请使用兑换码或联系客服')
  ;(button(tree, '自定义金额').props.onClick as () => void)()
  tree = render(draw)
  const input = () => elements(render(draw)).find((element) => element.type === 'input')!
  ;(input().props.onChange as (event: unknown) => void)({ target: { value: '3' } })
  tree = render(draw)
  expect(text(tree)).toContain('请输入 5–2000 之间的整数金额')
  expect(button(tree, '立即支付').props.disabled).toBe(true)
  ;(input().props.onChange as (event: unknown) => void)({ target: { value: '20' } })
  tree = render(draw)
  expect(text(tree)).toContain('可得 2,000 积分')
  // 没有支付方式仍不能下单
  expect(button(tree, '立即支付').props.disabled).toBe(true)
})

it('支付弹窗每 3 秒查询订单，到账后回调；失败、超时分别提示', async () => {
  const onPaid = vi.fn()
  api.backendRequest.mockResolvedValueOnce([order('pending')]).mockResolvedValueOnce([order('pending')]).mockResolvedValueOnce([order('success')])
  const draw = () => TopupPayDialog({ payment, onPaid, onClose: () => {} })
  render(draw)
  await flush()
  await vi.advanceTimersByTimeAsync(3000)
  expect(onPaid).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(3000)
  expect(onPaid).toHaveBeenCalledExactlyOnceWith(order('success'))
  expect(api.backendRequest).toHaveBeenCalledWith('/api/gouo/topup/orders?trade_no=T1')

  state.slots = []
  api.backendRequest.mockReset().mockResolvedValue([order('failed')])
  render(draw)
  await flush()
  expect(text(render(draw))).toContain('支付失败，积分未到账')

  state.slots = []
  api.backendRequest.mockReset().mockResolvedValue([order('pending')])
  render(draw)
  await flush()
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
  expect(text(render(draw))).toContain('已停止自动查询')
})

it('支付到账后提示积分、刷新余额和订单，并关闭支付弹窗', async () => {
  api.backendRequest.mockResolvedValue([])
  const onRedeemed = vi.fn().mockResolvedValue(undefined)
  const status = { emailService: false, turnstileEnabled: false, turnstileSiteKey: '', redemptionHelp: '', supportContact: '', topupUrl: '', onlineTopup: options, loading: false, error: '', reload: () => {} }
  const draw = () => TopupSection({ user: { id: 1 } as GouoUser, status, onRedeemed })
  render(draw)
  await flush()
  const card = elements(render(draw)).find((element) => element.type === OnlineTopupCard)!
  ;(card.props.onOrderCreated as (value: TopupPayment) => void)(payment)
  const dialog = elements(render(draw)).find((element) => element.type === TopupPayDialog)!
  expect(dialog.props.payment).toBe(payment)
  ;(dialog.props.onPaid as (value: unknown) => void)(order('success'))
  await vi.advanceTimersByTimeAsync(0)
  const tree = render(draw)
  expect(text(tree)).toContain('支付成功，已到账 5,150 积分')
  expect(elements(tree).some((element) => element.type === TopupPayDialog)).toBe(false)
  expect(onRedeemed).toHaveBeenCalledOnce()
  expect(api.backendRequest.mock.calls.filter((call) => call[0] === '/api/gouo/topup/orders').length).toBeGreaterThanOrEqual(2)
})

it('从支付页跳回时确认订单，到账后刷新余额并从地址栏去掉 trade_no', async () => {
  window.location.search = '?trade_no=T1&from=pay'
  api.backendRequest.mockResolvedValue([order('pending')])
  const onRedeemed = vi.fn().mockResolvedValue(undefined)
  const status = { emailService: false, turnstileEnabled: false, turnstileSiteKey: '', redemptionHelp: '', supportContact: '', topupUrl: '', onlineTopup: null, loading: false, error: '', reload: () => {} }
  const draw = () => TopupSection({ user: { id: 1 } as GouoUser, status, onRedeemed })
  render(draw)
  await flush()
  let tree = render(draw)
  expect(text(tree)).toContain('正在确认支付结果…')
  // 用户已有订单时，即使未开放在线充值也显示订单列表
  expect(text(tree)).toContain('最近充值订单')
  expect(text(tree)).toContain('待支付')
  expect(history.replaceState).not.toHaveBeenCalled()

  api.backendRequest.mockImplementation(async () => [order('success')])
  await vi.advanceTimersByTimeAsync(3000)
  tree = render(draw)
  expect(text(tree)).toContain('支付成功，已到账 5,150 积分')
  expect(text(tree)).toContain('已到账')
  expect(onRedeemed).toHaveBeenCalledOnce()
  expect(history.replaceState).toHaveBeenCalledWith({ idx: 1 }, '', '/?from=pay#/generate')
})

it('跳回后 2 分钟仍未确认时停止查询并提示稍后查看', async () => {
  window.location.search = '?trade_no=T1'
  api.backendRequest.mockResolvedValue([order('pending')])
  const onRedeemed = vi.fn()
  const status = { emailService: false, turnstileEnabled: false, turnstileSiteKey: '', redemptionHelp: '', supportContact: '', topupUrl: '', onlineTopup: options, loading: false, error: '', reload: () => {} }
  const draw = () => TopupSection({ user: { id: 1 } as GouoUser, status, onRedeemed })
  render(draw)
  await flush()
  await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
  expect(text(render(draw))).toContain('暂未确认到支付结果')
  expect(onRedeemed).not.toHaveBeenCalled()
  expect(history.replaceState).toHaveBeenCalledWith({ idx: 1 }, '', '/#/generate')
})
