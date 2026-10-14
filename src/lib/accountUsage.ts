import type { GouoUsageLog } from './gouoBackend'

// 积分制：1 元 = 100 积分。服务端仍按人民币折算额度记账，界面统一换算成积分显示
const POINTS_PER_CNY = 100

export function toPoints(cny: number) {
  return Math.round(cny * POINTS_PER_CNY * 100) / 100
}

export function formatPoints(cny?: number | null) {
  if (typeof cny !== 'number' || !Number.isFinite(cny)) return '—'
  return `${cny < 0 ? '-' : ''}${toPoints(Math.abs(cny)).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 积分`
}

// 旧日志正文按美元或原始额度书写；金额已按积分单独显示，含旧单位的正文不再展示
export function getLogContent(log: GouoUsageLog) {
  return log.content && !/[＄$]|点额度|充值积分: \d/.test(log.content) ? log.content : ''
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
    label: refund ? '图片退款' : log.type === 1 ? '积分充值' : log.type === 2 ? image ? '图片生成' : '模型消费' : log.type === 3 ? '积分调整' : '账户记录',
    unit: image ? refund ? '次退款请求' : '次成功请求' : '积分折合',
    delta,
    amountText: delta === null ? '积分不可用' : `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${formatPoints(Math.abs(delta))}`,
  }
}
