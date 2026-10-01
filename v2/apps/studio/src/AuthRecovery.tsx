import { useEffect, useState } from 'react'
import { ApiError } from './api'

export default function AuthRecovery({ error, loading, retry }: { error: Error | null; loading: boolean; retry: () => Promise<void> }) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    const seconds = error instanceof ApiError ? error.retryAfterSeconds ?? 0 : 0
    const until = Date.now() + seconds * 1000
    setRemaining(seconds)
    if (!seconds) return
    const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 1000)
    return () => window.clearInterval(timer)
  }, [error])
  return <section aria-label="会话恢复" role={error ? 'alert' : 'status'} style={{ padding: '32px', maxWidth: '640px', margin: '48px auto' }}>
    <h1>{error ? '会话暂时无法恢复' : '正在恢复账号会话…'}</h1>
    <p>{error?.message || '正在读取本人身份，请稍候。'}</p>
    {error && <>
      <p>{error instanceof ApiError && error.status === 403 ? '原生账号拒绝了身份访问，请在账号安全页面核对停用或权限状态。' : '工作区内容已暂时隐藏，未保存草稿仍保留在当前页面。请保持页面打开。'}</p>
      <p>此操作只重新读取身份，不会重新提交生成、付款偏好或其它业务操作。</p>
      <button type="button" disabled={loading || remaining > 0} onClick={() => { void retry() }}>{loading ? '正在恢复…' : remaining > 0 ? `等待 ${remaining} 秒后恢复` : '重新恢复会话'}</button>
      <p><a href="/security">前往原生账号安全页面</a></p>
    </>}
  </section>
}
