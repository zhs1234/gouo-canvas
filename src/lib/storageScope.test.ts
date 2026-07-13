import { afterEach, describe, expect, it, vi } from 'vitest'

function createWindowMock(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('storageScope', () => {
  it('uses an isolated storage name for the active authenticated user', async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_ENABLED', 'true')
    vi.stubGlobal('window', createWindowMock({ 'gouo-canvas:active-user': '7' }))
    const scope = await import('./storageScope')

    expect(scope.getLoadedStorageName()).toBe('gouo-canvas:user:7')
    expect(scope.getLoadedStorageUserId()).toBe('7')
    expect(scope.isLoadedStorageForUser(7)).toBe(true)
    expect(scope.activateUserStorage(7)).toBe(false)
    expect(scope.activateUserStorage(8)).toBe(true)
    expect(scope.shouldReloadForStorageScopeChange({ key: scope.ACTIVE_STORAGE_USER_KEY } as StorageEvent)).toBe(true)
    scope.deactivateUserStorage()
    expect(window.localStorage.getItem(scope.ACTIVE_STORAGE_USER_KEY)).toBeNull()
  })

  it('keeps standalone mode on the legacy local storage name', async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_ENABLED', 'false')
    vi.stubGlobal('window', createWindowMock({ 'gouo-canvas:active-user': '7' }))
    const scope = await import('./storageScope')

    expect(scope.getLoadedStorageName()).toBe('gouo-canvas')
    expect(scope.getLoadedStorageUserId()).toBeNull()
  })

  it('rejects invalid user identifiers', async () => {
    vi.stubEnv('VITE_GOUO_BACKEND_ENABLED', 'true')
    vi.stubGlobal('window', createWindowMock())
    const scope = await import('./storageScope')

    expect(() => scope.getUserStorageName(0)).toThrow('用户标识无效')
    expect(() => scope.getUserStorageName('invalid')).toThrow('用户标识无效')
  })
})
