import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getActionableErrorMessage, GUIDE_FLAGS, hasGuideFlag, isBalanceError, notifyFirstGeneration, setGuideFlag } from './userGuidance'

describe('userGuidance', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    const windowMock = new EventTarget()
    Object.assign(windowMock, {
      localStorage: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
    vi.stubGlobal('window', windowMock)
  })

  it('stores guide flags once', () => {
    expect(hasGuideFlag(GUIDE_FLAGS.onboarding)).toBe(false)
    setGuideFlag(GUIDE_FLAGS.onboarding)
    expect(hasGuideFlag(GUIDE_FLAGS.onboarding)).toBe(true)
  })

  it('adds an actionable next step to common errors', () => {
    expect(getActionableErrorMessage('余额不足')).toContain('打开用户中心兑换额度')
    expect(getActionableErrorMessage('request rejected by safety system')).toContain('删除可能涉及敏感内容的描述')
    expect(getActionableErrorMessage('Failed to fetch')).toContain('检查网络连接')
    expect(getActionableErrorMessage('未知错误')).toContain('复制完整报错')
  })

  it('recognizes Chinese and English balance errors', () => {
    expect(isBalanceError('用户额度不足')).toBe(true)
    expect(isBalanceError('insufficient balance')).toBe(true)
    expect(isBalanceError('network timeout')).toBe(false)
  })

  it('only emits the first-generation event before the guide is completed', () => {
    const listener = vi.fn()
    window.addEventListener('gouo:first-generation-complete', listener)
    notifyFirstGeneration('task-1')
    expect(listener).toHaveBeenCalledTimes(1)
    setGuideFlag(GUIDE_FLAGS.firstGeneration)
    notifyFirstGeneration('task-2')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('gouo:first-generation-complete', listener)
  })
})
