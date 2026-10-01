import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Notice, Panel } from '@gouo/ui'
import { currentUser, login, logout, request } from './api'
export default function Account() {
  const client = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: ({ signal }) => currentUser(signal) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [profileResult, setProfileResult] = useState('')
  const [profileUncertain, setProfileUncertain] = useState(false)
  const currentOwner = useRef(session.data?.id)
  currentOwner.current = session.data?.id
  useEffect(() => { setDisplayName(''); setProfileResult(''); setProfileUncertain(false); setBusy(false) }, [session.data?.id])
  async function updateName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || profileUncertain || !session.data) return
    const name = displayName.trim()
    if ([...name].length < 1 || [...name].length > 20) { setProfileResult('显示名称需为 1–20 个字符'); return }
    const owner = session.data.id
    setBusy(true); setProfileResult('')
    try {
      await request('/api/user/self', { method: 'PUT', body: JSON.stringify({ display_name: name }) })
      const user = await currentUser()
      if (currentOwner.current !== owner) return
      if (!user || user.id !== owner || user.display_name !== name) throw new Error('显示名称待核对')
      client.setQueryData(['session'], user)
      setDisplayName(''); setProfileResult('显示名称已更新')
    } catch { if (currentOwner.current === owner) { setProfileUncertain(true); setProfileResult('显示名称更新未确认，请勿再次提交。请刷新页面核对；不会自动重试。') } }
    finally { if (currentOwner.current === owner) setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError('')
    try {
      const user = await login(String(data.get('username') || '').trim(), String(data.get('password') || ''))
      await client.cancelQueries()
      // Preserve the live session observer used by the Loomic workspace.
      // Clearing it would leave the canvas scoped to the guest until reload.
      client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })
      client.setQueryData(['session'], user)
      form.reset()
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败') } finally { setBusy(false) }
  }
  async function signOut() {
    setBusy(true); setError('')
    try { await logout(); client.clear(); window.location.reload() }
    catch (e) { setError(e instanceof Error ? e.message : '退出失败') }
    finally { setBusy(false) }
  }
  return <Panel title="New API 账号">
    {session.isPending ? <p>正在检查后端会话…</p> : session.data ? <>
      <p>当前账号：{session.data.display_name || session.data.username}</p>
      <form onSubmit={updateName} className="stack">
        <label>显示名称<input value={displayName} onChange={event => setDisplayName(event.target.value)} aria-describedby="profile-name-help" disabled={busy || profileUncertain} /></label>
        <p id="profile-name-help">1–20 个字符，仅修改本人显示名称。</p>
        <Button type="submit" disabled={busy || profileUncertain || !displayName.trim()}>更新显示名称</Button>
      </form>
      {profileResult && <p role={profileUncertain ? 'alert' : 'status'}>{profileResult}</p>}
      <Button onClick={signOut} disabled={busy}>退出登录</Button>
    </> : <>
      <p>使用 New API 原生登录，支持验证码、密码加密、MFA 和通行密钥。登录完成后返回工作台即可恢复会话。</p>
      <a href="/sign-in?redirect=%2Fstudio%2F">前往 New API 登录</a>
      <p><a href="/sign-up">注册账号</a> · <a href="/forgot-password">忘记密码</a></p>
      <details open><summary>基础密码登录（未启用额外验证的实例）</summary>
      <form onSubmit={submit} className="stack">
        <label>用户名<input name="username" autoComplete="username" required maxLength={64} /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
        <Button type="submit" disabled={busy}>{busy ? '处理中…' : '登录'}</Button>
      </form>
      </details>
      {session.error && <Notice>{session.error.message}。请检查后端和 v2/.env。</Notice>}
    </>}
    <nav aria-label="New API 账号服务" className="mt-4 flex flex-col gap-2">
      <a href="/profile">账号资料</a>
      <a href="/security">账号安全与登录会话</a>
      <a href="/keys">生成令牌与额度权限</a>
      <a href="/wallet">余额与充值</a>
      <a href="/usage-logs">用量记录</a>
      <a href="/users">管理后台（需要管理员权限）</a>
    </nav>
    {error && <Notice error>{error}</Notice>}
  </Panel>
}
