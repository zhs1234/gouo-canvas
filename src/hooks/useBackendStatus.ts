import { useEffect, useState } from 'react'
import { getBackendStatus, isBackendAuthEnabled, type GouoBackendStatus } from '../lib/gouoBackend'

// 后台下发的客户端设置。各组件共用一次请求；切回页面时最多每分钟刷新一次，管理员修改后用户无需刷新页面
const REFRESH_MS = 60_000
let cached: GouoBackendStatus | null = null
let loadedAt = 0
let pending: Promise<void> | null = null
const listeners = new Set<(status: GouoBackendStatus) => void>()

function refresh() {
  if (pending || Date.now() - loadedAt < REFRESH_MS) return
  pending = getBackendStatus()
    .then((status) => {
      cached = status
      loadedAt = Date.now()
      listeners.forEach((listener) => listener(status))
    })
    .catch((err) => console.warn('读取后台设置失败', err))
    .finally(() => { pending = null })
}

export function useBackendStatus() {
  const [status, setStatus] = useState(cached)
  useEffect(() => {
    if (!isBackendAuthEnabled()) return
    listeners.add(setStatus)
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      listeners.delete(setStatus)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return status
}
