import { backendRequest, type GouoBackendStatus } from './gouoBackend'

// 积分包按人民币计价：price 为元，points 为基础积分，bonus 为额外赠送积分
export interface TopupPackage {
  price: number
  points: number
  bonus: number
}

export interface TopupOptions {
  packages: TopupPackage[]
  // 自定义金额范围（整数元），未开放时为 null
  custom: { min: number; max: number } | null
}

export interface PaymentGateway {
  uuid: string
  name: string
  icon: string
  fixed_fee: number
  percent_fee: number
  currency: string
  sort: number
}

export interface TopupPayment {
  trade_no: string
  // 1 跳转支付页，2 扫码支付（url 为二维码内容）
  type: 1 | 2
  data: { url: string; method?: string; params?: Record<string, string | number> }
  pay_amount: number
  currency: string
  points: number
}

export type TopupOrderStatus = 'pending' | 'success' | 'failed' | 'closed'

export interface TopupOrder {
  trade_no: string
  status: TopupOrderStatus
  points: number
  pay_amount: number
  currency: string
  created_at: number
}

export const TOPUP_STATUS_LABELS: Record<TopupOrderStatus, string> = { pending: '待支付', success: '已到账', failed: '失败', closed: '已关闭' }
const TOPUP_POLL_MS = 3000

const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isText = (value: unknown): value is string => typeof value === 'string'
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// 旧后端没有在线充值字段，或积分包和自定义金额都不可用时视为未开放
export function getTopupOptions(status: GouoBackendStatus): TopupOptions | null {
  if (status.gouo_online_topup !== true) return null
  const raw = status.gouo_topup_packages
  // 下单按下标选积分包，有一项格式不对就整体不用，避免下标与服务端错位
  const packages = Array.isArray(raw) && raw.every((item) => isRecord(item) && isAmount(item.price) && item.price > 0 && isAmount(item.points) && isAmount(item.bonus))
    ? raw.map((item) => ({ price: item.price, points: item.points, bonus: item.bonus }))
    : []
  const custom = status.gouo_topup_custom
  const range = isRecord(custom) && Number.isInteger(custom.min) && Number.isInteger(custom.max) && (custom.min as number) >= 1 && (custom.max as number) >= (custom.min as number)
    ? { min: custom.min as number, max: custom.max as number }
    : null
  return packages.length || range ? { packages, custom: range } : null
}

export async function getPaymentGateways(): Promise<PaymentGateway[]> {
  const data = await backendRequest<unknown>('/api/user/payment')
  // 没有启用的支付方式时服务端返回 null
  if (data === null) return []
  if (!Array.isArray(data) || data.some((item) => !isRecord(item) || !isText(item.uuid) || !item.uuid || !isText(item.name))) throw new Error('支付方式格式无效')
  return data
    .map((item) => ({
      uuid: item.uuid,
      name: item.name,
      icon: isText(item.icon) ? item.icon : '',
      fixed_fee: isAmount(item.fixed_fee) ? item.fixed_fee : 0,
      percent_fee: isAmount(item.percent_fee) ? item.percent_fee : 0,
      currency: isText(item.currency) ? item.currency : '',
      sort: typeof item.sort === 'number' && Number.isFinite(item.sort) ? item.sort : 0,
    }))
    // 与后台面板一致，sort 大的排在前面
    .sort((a, b) => b.sort - a.sort)
}

export async function createTopupOrder(input: { gateway: string; package?: number; amount?: number }): Promise<TopupPayment> {
  const data = await backendRequest<unknown>('/api/gouo/topup/order', { method: 'POST', body: JSON.stringify(input) })
  const pay = isRecord(data) && isRecord(data.data) ? data.data : null
  // 跳转支付只接受 http(s) 链接，扫码支付的 url 是二维码内容
  const valid = isRecord(data) && pay && isText(data.trade_no) && data.trade_no && (data.type === 1 || data.type === 2) && isText(pay.url) && pay.url
    && (data.type === 2 || /^https?:\/\//i.test(pay.url))
    && (pay.method == null || isText(pay.method))
    && (pay.params == null || (isRecord(pay.params) && Object.values(pay.params).every((value) => isText(value) || typeof value === 'number')))
    && isAmount(data.pay_amount) && isText(data.currency) && isAmount(data.points)
  if (!valid) throw new Error('支付订单格式无效，请联系客服')
  return data as unknown as TopupPayment
}

export async function getTopupOrders(tradeNo?: string): Promise<TopupOrder[]> {
  const data = await backendRequest<unknown>(`/api/gouo/topup/orders${tradeNo ? `?trade_no=${encodeURIComponent(tradeNo)}` : ''}`)
  if (data === null) return []
  if (!Array.isArray(data) || data.some((item) => !isRecord(item) || !isText(item.trade_no) || !(isText(item.status) && item.status in TOPUP_STATUS_LABELS) || !isAmount(item.points) || !isAmount(item.pay_amount) || !isText(item.currency) || !isAmount(item.created_at))) {
    throw new Error('充值订单格式无效')
  }
  return data as TopupOrder[]
}

export function formatPayAmount(amount: number, currency: string) {
  const value = amount.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return !currency || currency.toUpperCase() === 'CNY' ? `¥${value}` : `${value} ${currency}`
}

// 跳转支付：网关要求 POST 时用表单提交到新窗口，否则直接打开链接。新窗口可能被浏览器拦截，支付弹窗里保留手动跳转按钮
export function openPayUrl(data: TopupPayment['data']) {
  if (data.method?.toUpperCase() === 'POST' && data.params) {
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = data.url
    form.target = '_blank'
    for (const [name, value] of Object.entries(data.params)) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = String(value)
      form.appendChild(input)
    }
    document.body.appendChild(form)
    form.submit()
    form.remove()
    return
  }
  const win = window.open(data.url, '_blank')
  if (win) win.opener = null
}

// 立即并每 3 秒查询一次订单，直到不再待支付或超时（超时回调 null）；返回停止函数，查询出错时继续重试
export function watchTopupOrder(tradeNo: string, timeoutMs: number, onSettle: (order: TopupOrder | null) => void) {
  const deadline = Date.now() + timeoutMs
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = async () => {
    try {
      const order = (await getTopupOrders(tradeNo)).find((item) => item.trade_no === tradeNo)
      if (stopped) return
      if (order && order.status !== 'pending') {
        stopped = true
        onSettle(order)
        return
      }
    } catch (err) {
      console.warn('查询充值订单失败', err)
    }
    if (stopped) return
    if (Date.now() >= deadline) {
      stopped = true
      onSettle(null)
      return
    }
    timer = setTimeout(check, TOPUP_POLL_MS)
  }
  void check()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
