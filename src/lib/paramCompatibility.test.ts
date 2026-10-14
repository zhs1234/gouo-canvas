import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { normalizeTaskParams } from './paramCompatibility'

describe('parameter normalization', () => {
  it('applies the operator limits from the backend status', () => {
    const params = normalizeTaskParams({ ...DEFAULT_PARAMS, n: 12, moderation: 'low', output_compression: 80 })
    expect(params.n).toBe(10)
    expect(params.moderation).toBe('auto')
    expect(params.output_compression).toBeNull()
  })
})
