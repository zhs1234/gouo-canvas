import { useEffect, useState } from 'react'
import { getCachedBackendStatus, refreshBackendStatus, subscribeBackendStatus } from '../lib/gouoBackend'

// 订阅后台下发的客户端设置；切回页面时按需刷新
export function useBackendStatus() {
  const [status, setStatus] = useState(getCachedBackendStatus)
  useEffect(() => {
    const unsubscribe = subscribeBackendStatus(setStatus)
    const refresh = () => { void refreshBackendStatus() }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return status
}
