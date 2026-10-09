import { describe, expect, it } from 'vitest'
import { formatCNY, getUsageDisplay } from './accountUsage'

describe('account usage display', () => {
  it.each([[1_000_000, '+¥2.00'], [-1_000_000, '-¥2.00'], [0, '¥0.00']])('keeps the direction of quota adjustments: %s', (quota, amountText) => {
    expect(getUsageDisplay({ created_at: 1, type: 3, quota: Number(quota) }, 0.000002)).toMatchObject({ label: '额度调整', amountText })
  })

  it('separates text consumption, image consumption, and refunds with matching signed CSV values', () => {
    expect(getUsageDisplay({ created_at: 1, type: 2, quota: 500_000 }, 0.000002)).toMatchObject({ label: '模型消费', delta: -1, amountText: '-¥1.00' })
    expect(getUsageDisplay({ created_at: 1, type: 2, quota: 500_000, metadata: { billing_unit: 'successful_request', price_cny: 0.2 } })).toMatchObject({ label: '图片生成', delta: -0.2, amountText: '-¥0.20' })
    expect(getUsageDisplay({ created_at: 1, type: 4, quota: 500_000, metadata: { billing_unit: 'refunded_request', billing_status: 'refunded', price_cny: 0.2 } })).toMatchObject({ label: '图片退款', delta: 0.2, amountText: '+¥0.20' })
  })

  it('does not replace missing or invalid money with zero', () => {
    for (const value of [undefined, null, NaN, Infinity]) expect(formatCNY(value)).toBe('—')
    expect(formatCNY(0)).toBe('¥0.00')
    expect(formatCNY(-2)).toBe('-¥2.00')
    for (const rate of [undefined, 0, NaN, Infinity]) expect(getUsageDisplay({ created_at: 1, type: 2, quota: 5 }, rate)).toMatchObject({ delta: null, amountText: '金额不可用' })
    expect(getUsageDisplay({ created_at: 1, type: 2 }, 1).delta).toBeNull()
  })
})
