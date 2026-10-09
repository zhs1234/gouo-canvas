import { describe, expect, it, vi } from 'vitest'
import { createLatestRequest } from './latestRequest'

describe('latest account request', () => {
  it.each(['success', 'failure'])('ignores an older %s including its loading completion', async (outcome) => {
    const latest = createLatestRequest()
    let resolve!: (value: string) => void
    let reject!: (err: Error) => void
    const first = new Promise<string>((ok, fail) => { resolve = ok; reject = fail })
    const success = vi.fn()
    const failure = vi.fn()
    const finish = vi.fn()
    const pending = latest.run(() => first, success, failure, finish)
    await latest.run(async () => 'model-B', success, failure, finish)
    if (outcome === 'success') resolve('model-A')
    else reject(new Error('older request failed'))
    await pending
    expect(success.mock.calls).toEqual([['model-B']])
    expect(failure).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('keeps independent errors and ignores work after closing a section', async () => {
    const logs = createLatestRequest()
    const user = createLatestRequest()
    const errors = vi.fn()
    await logs.run(async () => { throw new Error('logs unavailable') }, vi.fn(), errors, vi.fn())
    await user.run(async () => 'user', vi.fn(), vi.fn(), vi.fn())
    expect(errors).toHaveBeenCalledTimes(1)
    const commit = vi.fn()
    const pending = logs.run(async () => 'late logs', commit, commit, commit)
    logs.invalidate()
    await pending
    expect(commit).not.toHaveBeenCalled()
  })
})
