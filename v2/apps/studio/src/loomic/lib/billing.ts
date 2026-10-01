import { request } from '../../api'
export type StudioUsage = { state: 'recorded' | 'settled' | 'pending'; settlementState?: 'unconfirmed'; requestCount: number; currency: 'CNY'; cost?: number }
export type StudioBilling = {
  currency: 'CNY'; balance: number; spent: number; requestCount: number; groupRatio: number; usdExchangeRate: number
  prices: Array<{ id: string; displayName: string; kind: string; mode: string; price?: number; longContextAfter?: number; tiers: Array<{ name: string; rates: Record<string, number> }> }>
  recentCalls: Array<{ id: number; model: string; createdAt: number; cost: number; inputTokens: number; outputTokens: number }>
}
export function fetchBilling(signal?: AbortSignal) { return request<StudioBilling>('/api/studio/billing', { signal }) }
export function money(value: number, precise = false) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: precise ? 5 : 2 }).format(value)
}
export function billingChanged(owner: string, usage?: StudioUsage) { window.dispatchEvent(new CustomEvent('gouo:billing-changed', { detail: { owner, usage } })) }

// Legacy settled records also prove matching logs only, never final wallet settlement.
export function usageEvidence(usage: unknown): string | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const value = usage as Partial<StudioUsage>
  if (value.state === 'pending') return '调用记录尚不完整；金额与实扣待核对，不会自动重发。'
  if (value.state !== 'recorded' && value.state !== 'settled') return undefined
  const amount = typeof value.cost === 'number' && Number.isFinite(value.cost) ? money(value.cost, true) : '金额待核对'
  const count = typeof value.requestCount === 'number' ? `（${value.requestCount} 次模型调用）` : ''
  return `调用记录折算：${amount}${count}；实扣待核对。`
}
