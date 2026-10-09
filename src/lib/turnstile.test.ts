import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })

describe('Turnstile script loading', () => {
  it('uses the official explicit script once for concurrent widgets', async () => {
    const script = { src: '', async: false, onload: null as (() => void) | null, remove: vi.fn() }
    const append = vi.fn()
    const host: { turnstile?: object } = {}
    vi.stubGlobal('window', host)
    vi.stubGlobal('document', { createElement: () => script, head: { appendChild: append } })
    const { loadTurnstile } = await import('./turnstile')
    const first = loadTurnstile()
    expect(loadTurnstile()).toBe(first)
    expect(script.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
    host.turnstile = { render: vi.fn(), remove: vi.fn() }
    script.onload!()
    await expect(first).resolves.toBe(host.turnstile)
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('reports script timeout and allows retry without sending a token', async () => {
    vi.useFakeTimers()
    const scripts: Array<{ remove: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', { createElement: () => { const script = { remove: vi.fn() }; scripts.push(script); return script }, head: { appendChild: vi.fn() } })
    const { loadTurnstile } = await import('./turnstile')
    const first = loadTurnstile().catch((err) => err)
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await first).message).toContain('安全验证加载失败')
    expect(scripts[0].remove).toHaveBeenCalled()
    const retry = loadTurnstile().catch((err) => err)
    expect(scripts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(15_000)
    await retry
  })
})
