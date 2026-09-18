import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Notice, Panel } from '@gouo/ui'
import { currentUser, login, logout } from './api'
export default function Account() {
  const client = useQueryClient()
  const session = useQuery({ queryKey: ['session'], queryFn: ({ signal }) => currentUser(signal) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError('')
    try {
      const user = await login(String(data.get('username') || '').trim(), String(data.get('password') || ''))
      client.clear()
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
  return <Panel title="现有账号连接">
    {session.isPending ? <p>正在检查后端会话…</p> : session.data ? <>
      <p>当前账号：{session.data.display_name || session.data.username}</p>
      <Button onClick={signOut} disabled={busy}>退出登录</Button>
    </> : <>
      <p>复用旧后端账号；仅在后端已经启动时可登录。本地编辑器不依赖登录。</p>
      <form onSubmit={submit} className="stack">
        <label>用户名<input name="username" autoComplete="username" required maxLength={64} /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
        <Button type="submit" disabled={busy}>{busy ? '处理中…' : '连接现有账号'}</Button>
      </form>
      {session.error && <Notice>{session.error.message}。请检查后端和 v2/.env。</Notice>}
    </>}
    {error && <Notice error>{error}</Notice>}
  </Panel>
}
