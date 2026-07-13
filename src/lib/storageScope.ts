// 认证模式不自动认领旧共享数据，避免把已经混杂的本地内容归给错误账号。
const BASE_STORAGE_NAME = 'gouo-canvas'
export const ACTIVE_STORAGE_USER_KEY = 'gouo-canvas:active-user'

function normalizeUserId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? String(id) : null
}

function readActiveUserId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return normalizeUserId(window.localStorage.getItem(ACTIVE_STORAGE_USER_KEY))
  } catch {
    return null
  }
}

export function getUserStorageName(userId: number | string): string {
  const normalized = normalizeUserId(userId)
  if (!normalized) throw new Error('用户标识无效，无法建立本地数据隔离')
  return `${BASE_STORAGE_NAME}:user:${normalized}`
}

const backendAuthEnabled = import.meta.env.VITE_GOUO_BACKEND_ENABLED === 'true'
const loadedUserId = backendAuthEnabled ? readActiveUserId() : null
const loadedStorageName = loadedUserId ? getUserStorageName(loadedUserId) : BASE_STORAGE_NAME

export function getLoadedStorageName(): string {
  return loadedStorageName
}

export function getLoadedStorageUserId(): string | null {
  return loadedUserId
}

export function isLoadedStorageForUser(userId: number): boolean {
  return normalizeUserId(userId) === loadedUserId
}

export function activateUserStorage(userId: number): boolean {
  const normalized = normalizeUserId(userId)
  if (!normalized) throw new Error('用户标识无效，无法建立本地数据隔离')
  try {
    window.localStorage.setItem(ACTIVE_STORAGE_USER_KEY, normalized)
    if (readActiveUserId() !== normalized) throw new Error('本地存储不可用')
  } catch {
    throw new Error('浏览器本地存储不可用，无法安全隔离账号数据')
  }
  return loadedStorageName !== getUserStorageName(normalized)
}

export function deactivateUserStorage() {
  try {
    window.localStorage.removeItem(ACTIVE_STORAGE_USER_KEY)
  } catch {
    // 后端会话已经退出，本地标记清理失败时仍由登录校验阻止旧数据挂载。
  }
}

export function shouldReloadForStorageScopeChange(event: StorageEvent): boolean {
  if (event.key !== ACTIVE_STORAGE_USER_KEY) return false
  if (!backendAuthEnabled) return false
  return readActiveUserId() !== loadedUserId
}
