import type { GouoUsageLog } from './gouoBackend'

export function formatCNY(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value < 0 ? '-' : ''}¥${Math.abs(value).toFixed(2)}` : '—'
}

export function getUsageDisplay(log: GouoUsageLog, rate?: number) {
  const refund = log.metadata?.billing_status === 'refunded'
  const image = log.metadata?.billing_unit === 'successful_request' || log.metadata?.billing_unit === 'refunded_request'
  const price = log.metadata?.price_cny
  const amount = image && typeof price === 'number' && Number.isFinite(price) && price >= 0
    ? price
    : typeof log.quota === 'number' && Number.isFinite(log.quota) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? log.quota * rate : null
  const delta = amount === null ? null : refund || log.type === 1 ? Math.abs(amount) : log.type === 2 ? -Math.abs(amount) : amount
  return {
    label: refund ? '图片退款' : log.type === 1 ? '额度充值' : log.type === 2 ? image ? '图片生成' : '模型消费' : log.type === 3 ? '额度调整' : '账户记录',
    unit: image ? refund ? '次退款请求' : '次成功请求' : '额度折合',
    delta,
    amountText: delta === null ? '金额不可用' : `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${formatCNY(Math.abs(delta))}`,
  }
}
