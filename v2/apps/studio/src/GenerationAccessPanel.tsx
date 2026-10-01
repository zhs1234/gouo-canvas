import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { renewGenerationAccess, useGenerationAccess } from './generation-access'

export function GenerationAccessPanel({ userId }: { userId: number }) {
  const access = useGenerationAccess(userId)
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const submitting = useRef(false)
  const owner = useRef(userId)
  owner.current = userId
  async function renew() {
    if (submitting.current || busy || uncertain || access.data?.canRenew !== true || !access.data.version) return
    submitting.current = true
    const requestedOwner = userId
    setBusy(true); setResult('')
    // Renewal never grants permission to a later model send.
    window.dispatchEvent(new CustomEvent('gouo:clear-balance-consent', { detail: { owner: `local:${userId}` } }))
    try {
      const next = await renewGenerationAccess(access.data.version)
      if (owner.current !== requestedOwner) return
      setResult(next.message)
      await Promise.all([client.invalidateQueries({ queryKey: ['generation-access', userId] }), client.invalidateQueries({ queryKey: ['billing', userId] })])
    } catch { if (owner.current === requestedOwner) { setUncertain(true); setResult('续用未确认，请勿再次提交。请刷新权限查询或前往原生令牌页面核对；不会自动重试或生成。') } }
    finally { submitting.current = false; if (owner.current === requestedOwner) setBusy(false) }
  }
  return <section className="gateway-status" aria-label="生成权限">
    <div className="flex items-center justify-between"><p>生成权限</p><button type="button" className="text-xs underline" disabled={busy || access.isFetching} onClick={() => { void access.refetch() }}>刷新生成权限</button></div>
    {access.error ? <p role="alert">生成权限暂时无法读取，请刷新查询。</p> : !access.data ? <p role="status">正在查询生成权限…</p> : <>
      <p>{access.data.message}</p>
      {access.data.canRenew && <button type="button" disabled={busy || uncertain || !access.data.version} onClick={() => { void renew() }}>{busy ? '正在续用…' : '续用有限生成权限'}</button>}
    </>}
    <p className="text-xs text-muted-foreground">生成权限到期或用完不会清除 New API 钱包余额。续用需核验本人原生资金与批准的有限权限，不会充值、重新领取试用或发送模型请求。后续余额生成仍需每次发送单独同意。</p>
    <a href="/keys">前往 New API 核对令牌</a>
    {result && <p role={uncertain ? 'alert' : 'status'}>{result}</p>}
  </section>
}
