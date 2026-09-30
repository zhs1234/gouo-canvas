import { request } from '../../api'
export type StudioUsage = { state: 'settled' | 'pending'; requestCount: number; currency: 'CNY'; cost?: number }
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
