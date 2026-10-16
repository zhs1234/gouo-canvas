import { describe, expect, it } from 'vitest'
import { matchRestoredSkillIds, restoredSkillId } from './matchRestoredSkillIds'

describe('matchRestoredSkillIds', () => {
  it('本地同时有原件和恢复副本时，两种备份顺序都认回各自的 ID', () => {
    const local = new Set(['x', 'imported-x'])
    const expected = new Map([['x', 'x'], ['imported-x', 'imported-x']])
    expect(matchRestoredSkillIds(['x', 'imported-x'], local)).toEqual(expected)
    expect(matchRestoredSkillIds(['imported-x', 'x'], local)).toEqual(expected)
  })

  it('本地只有逐层恢复的副本时，两种备份顺序都把链条接上，不漏认', () => {
    const local = new Set(['imported-x', 'imported-imported-x'])
    const expected = new Map([['x', 'imported-x'], ['imported-x', 'imported-imported-x']])
    expect(matchRestoredSkillIds(['x', 'imported-x'], local)).toEqual(expected)
    expect(matchRestoredSkillIds(['imported-x', 'x'], local)).toEqual(expected)
  })

  it('前缀后不超过 128 字节时仍用固定 ID，超过就换 UUID', () => {
    expect(restoredSkillId('a'.repeat(119), new Set())).toBe(`imported-${'a'.repeat(119)}`)
    expect(restoredSkillId('a'.repeat(120), new Set())).toMatch(/^[0-9a-f-]{36}$/)
    expect(restoredSkillId('x', new Set(['imported-x']))).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('只有一个位置时优先原 ID', () => {
    expect(matchRestoredSkillIds(['x', 'imported-x'], new Set(['imported-x']))).toEqual(new Map([['imported-x', 'imported-x']]))
    expect(matchRestoredSkillIds(['imported-x', 'x'], new Set(['imported-x']))).toEqual(new Map([['imported-x', 'imported-x']]))
    expect(matchRestoredSkillIds(['x'], new Set(['imported-x']))).toEqual(new Map([['x', 'imported-x']]))
  })
})
