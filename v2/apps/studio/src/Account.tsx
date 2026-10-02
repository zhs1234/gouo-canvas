import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Notice, Panel } from '@gouo/ui'
import { currentUser, login, request, getIdentityEpoch, assertIdentityEpoch } from './api'
import { useAuth } from './loomic/lib/auth-context'
import AuthRecovery from './AuthRecovery'
import { useWorkspaceLeaveCheck } from './workspace/WorkspaceNavigationProvider'
type ProfileIntent = { owner: number; displayName: string; state: 'pending' | 'unknown' }
const intentKey = (owner: number) => `gouo:profile-intent:v1:${owner}`
function readIntent(owner: number): ProfileIntent | null {
  const raw = sessionStorage.getItem(intentKey(owner))
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    if (!value || Object.keys(value).sort().join(',') !== 'displayName,owner,state' || value.owner !== owner ||
      typeof value.displayName !== 'string' || value.displayName !== value.displayName.trim() || [...value.displayName].length < 1 || [...value.displayName].length > 20 ||
      !['pending','unknown'].includes(value.state)) throw new Error()
    return value
  } catch { throw new Error('本标签页的更新保护记录无法核对，已阻止新提交。') }
}
function writeIntent(intent: ProfileIntent) {
  sessionStorage.setItem(intentKey(intent.owner), JSON.stringify(intent))
  if (JSON.stringify(readIntent(intent.owner)) !== JSON.stringify(intent)) throw new Error('无法保存更新保护记录，未提交新的修改。')
}
function clearIntent(owner: number) {
  sessionStorage.removeItem(intentKey(owner))
  if (sessionStorage.getItem(intentKey(owner)) !== null) throw new Error('无法清除更新保护记录，请勿再次提交。')
}
export default function Account() {
  const client = useQueryClient()
  const auth = useAuth()
  const checkLeave = useWorkspaceLeaveCheck()
  const session = { data: auth.user, isPending: auth.loading, error: auth.error }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [profileResult, setProfileResult] = useState('')
  const [profileUncertain, setProfileUncertain] = useState(false)
  const [profileIntent, setProfileIntent] = useState<ProfileIntent | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const actionBusy = useRef(false)
  const currentOwner = useRef(session.data?.id)
  currentOwner.current = session.data?.id
  useEffect(() => {
    setDisplayName(''); setProfileResult(''); setProfileUncertain(false); setProfileIntent(null); setBusy(false)
    if (!session.data) return
    try {
      const intent = readIntent(session.data.id)
      if (intent) { setProfileIntent(intent); setProfileUncertain(true); setProfileResult('显示名称更新未确认，请勿再次提交。可显式读取本人资料核对；不会自动重试。') }
    } catch { setProfileUncertain(true); setProfileResult('更新保护记录不可用，已阻止新提交；请核对本人资料。') }
  }, [session.data?.id])
  function sameIdentity(owner: number, epoch: number) {
    if (!mounted.current || currentOwner.current !== owner) return false
    try { assertIdentityEpoch(epoch); return true } catch { return false }
  }
  async function confirmProfile() {
    if (actionBusy.current || !session.data || !profileIntent) return
    const owner = session.data.id, epoch = getIdentityEpoch()
    actionBusy.current = true; setBusy(true)
    try {
      const intent = readIntent(owner)
      if (!intent) throw new Error('没有可核对的更新记录')
      const user = await currentUser()
      if (!sameIdentity(owner, epoch)) return
      if (!user || user.id !== owner || user.display_name !== intent.displayName) throw new Error('本人显示名称尚未与这次修改一致，继续保留未确认状态。')
      clearIntent(owner)
      client.setQueryData(['session'], user)
      setProfileIntent(null); setProfileUncertain(false); setProfileResult('显示名称已核对'); setDisplayName('')
    } catch (e) { if (sameIdentity(owner, epoch)) setProfileResult(e instanceof Error ? e.message : '核对失败，仍保留未确认状态。') }
    finally { actionBusy.current = false; if (sameIdentity(owner, epoch)) setBusy(false) }
  }
  async function updateName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionBusy.current || busy || profileUncertain || !session.data) return
    const name = displayName.trim()
    if ([...name].length < 1 || [...name].length > 20) { setProfileResult('显示名称需为 1–20 个字符'); return }
    const owner = session.data.id, epoch = getIdentityEpoch()
    const intent: ProfileIntent = { owner, displayName: name, state: 'pending' }
    actionBusy.current = true; setBusy(true); setProfileResult('')
    try {
      if (readIntent(owner)) throw new Error('已有未确认修改，请先核对')
      writeIntent(intent)
      setProfileIntent(intent); setProfileUncertain(true)
      await request('/api/studio/profile', { method: 'PUT', body: JSON.stringify({ display_name: name }) })
      const user = await currentUser()
      if (!sameIdentity(owner, epoch)) return
      if (!user || user.id !== owner || user.display_name !== name) throw new Error('显示名称待核对')
      clearIntent(owner)
      client.setQueryData(['session'], user)
      setProfileIntent(null); setProfileUncertain(false); setDisplayName(''); setProfileResult('显示名称已更新')
    } catch {
      try { if (readIntent(owner)?.displayName === name) writeIntent({ ...intent, state: 'unknown' }) } catch { /* Keep damaged/unwritable records blocked. */ }
      if (sameIdentity(owner, epoch)) { setProfileUncertain(true); setProfileResult('显示名称更新未确认或保护记录不可用，请勿再次提交。可显式读取本人资料核对；不会自动重试。') }
    }
    finally { actionBusy.current = false; if (sameIdentity(owner, epoch)) setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionBusy.current || busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const initialOwner = currentOwner.current
    let completedEpoch: number | undefined
    actionBusy.current = true; setBusy(true); setError('')
    try {
      const user = await login(String(data.get('username') || '').trim(), String(data.get('password') || ''))
      completedEpoch = getIdentityEpoch()
      await client.cancelQueries()
      assertIdentityEpoch(completedEpoch)
      if (!mounted.current || currentOwner.current !== initialOwner) return
      // Preserve the live session observer used by the Loomic workspace.
      // Clearing it would leave the canvas scoped to the guest until reload.
      client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })
      client.setQueryData(['session'], user)
      form.reset()
    } catch (e) {
      if (mounted.current && currentOwner.current === initialOwner && (completedEpoch === undefined || completedEpoch === getIdentityEpoch())) setError(e instanceof Error ? e.message : '登录失败')
    } finally {
      actionBusy.current = false
      if (mounted.current && (completedEpoch === undefined || completedEpoch === getIdentityEpoch())) setBusy(false)
    }
  }
  async function signOut() {
    if (actionBusy.current || busy) return
    const epoch = getIdentityEpoch()
    actionBusy.current = true; setBusy(true); setError('')
    try {
      if (!await checkLeave()) { setError('画布尚未保存，已留在当前页面。请重试保存或导出备份后再退出。'); return }
      assertIdentityEpoch(epoch)
      await auth.signOut()
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '退出失败') }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  return <Panel title="New API 账号">
    {session.error ? <AuthRecovery error={session.error} loading={session.isPending} retry={auth.retryIdentity} /> : session.isPending ? <p>正在检查后端会话…</p> : session.data ? <>
      <p>当前账号：{session.data.display_name || session.data.username}</p>
      <form onSubmit={updateName} className="stack">
        <label>显示名称<input value={displayName} onChange={event => setDisplayName(event.target.value)} aria-describedby="profile-name-help" disabled={busy || profileUncertain} /></label>
        <p id="profile-name-help">1–20 个字符，仅修改本人显示名称。</p>
        <Button type="submit" disabled={busy || profileUncertain || !displayName.trim()}>更新显示名称</Button>
      </form>
      {profileResult && <p role={profileUncertain ? 'alert' : 'status'}>{profileResult}</p>}
      {profileUncertain && profileIntent && <Button onClick={confirmProfile} disabled={busy}>读取本人资料核对</Button>}
      <Button onClick={signOut} disabled={busy}>退出登录</Button>
    </> : <>
      <p>使用 New API 原生登录，支持验证码、密码加密、MFA 和通行密钥。登录完成后返回工作台即可恢复会话。</p>
      <a target="_blank" rel="noopener noreferrer" href="/sign-in?redirect=%2Fstudio%2F">前往 New API 登录</a>
      <p><a target="_blank" rel="noopener noreferrer" href="/sign-up">注册账号</a> · <a target="_blank" rel="noopener noreferrer" href="/forgot-password">忘记密码</a></p>
      <details open><summary>基础密码登录（未启用额外验证的实例）</summary>
      <form onSubmit={submit} className="stack">
        <label>用户名<input name="username" autoComplete="username" required maxLength={64} /></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required /></label>
        <Button type="submit" disabled={busy}>{busy ? '处理中…' : '登录'}</Button>
      </form>
      </details>
    </>}
    <nav aria-label="New API 账号服务" className="mt-4 flex flex-col gap-2">
      <a target="_blank" rel="noopener noreferrer" href="/profile">账号资料</a>
      <a target="_blank" rel="noopener noreferrer" href="/security">账号安全与登录会话</a>
      <a target="_blank" rel="noopener noreferrer" href="/keys">生成令牌与额度权限</a>
      <a target="_blank" rel="noopener noreferrer" href="/wallet">余额与充值</a>
      <a target="_blank" rel="noopener noreferrer" href="/usage-logs">用量记录</a>
      <p>生成权限由管理员配置，请前往原生页面核对已有令牌。请勿将密钥粘贴到聊天或画布。</p>
    </nav>
    {error && <Notice error>{error}</Notice>}
  </Panel>
}
