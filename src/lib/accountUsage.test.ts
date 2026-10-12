import { describe, expect, it } from 'vitest'
import { formatPoints, getUsageDisplay, toPoints } from './accountUsage'

describe('account usage display', () => {
  it.each([[1_000_000, '+200 积分'], [-1_000_000, '-200 积分'], [0, '0 积分']])('keeps the direction of quota adjustments: %s', (quota, amountText) => {
    expect(getUsageDisplay({ created_at: 1, type: 3, quota: Number(quota) }, 0.000002)).toMatchObject({ label: '额度调整', amountText })
  })

  it('separates text consumption, image consumption, and refunds with matching signed CSV values', () => {
    expect(getUsageDisplay({ created_at: 1, type: 2, quota: 500_000 }, 0.000002)).toMatchObject({ label: '模型消费', delta: -1, amountText: '-100 积分' })
    expect(getUsageDisplay({ created_at: 1, type: 2, quota: 500_000, metadata: { billing_unit: 'successful_request', price_cny: 0.2 } })).toMatchObject({ label: '图片生成', delta: -0.2, amountText: '-20 积分' })
    expect(getUsageDisplay({ created_at: 1, type: 4, quota: 500_000, metadata: { billing_unit: 'refunded_request', billing_status: 'refunded', price_cny: 0.2 } })).toMatchObject({ label: '图片退款', delta: 0.2, amountText: '+20 积分' })
  })

  it('shows amounts as points at 1 yuan = 100 points', () => {
    expect(formatPoints(0.1)).toBe('10 积分')
    expect(formatPoints(12.345)).toBe('1,234.5 积分')
    // 折算出的零头最多保留两位
    expect(formatPoints(0.123456)).toBe('12.35 积分')
    expect(toPoints(0.07)).toBe(7)
  })

  it('does not replace missing or invalid money with zero', () => {
    for (const value of [undefined, null, NaN, Infinity]) expect(formatPoints(value)).toBe('—')
    expect(formatPoints(0)).toBe('0 积分')
    expect(formatPoints(-2)).toBe('-200 积分')
    for (const rate of [undefined, 0, NaN, Infinity]) expect(getUsageDisplay({ created_at: 1, type: 2, quota: 5 }, rate)).toMatchObject({ delta: null, amountText: '积分不可用' })
    expect(getUsageDisplay({ created_at: 1, type: 2 }, 1).delta).toBeNull()
  })
})
