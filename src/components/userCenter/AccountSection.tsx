import { type FormEvent, useState } from 'react'
import type { GouoUser } from '../../lib/gouoBackend'
import { bindEmail, createBackendSettings, logout, sendEmailVerification, updateCurrentUser, updatePassword } from '../../lib/gouoBackend'
import { deactivateUserStorage } from '../../lib/storageScope'
import { useStore } from '../../store'
import TurnstileChallenge from '../TurnstileChallenge'
import type { UserCenterServiceStatus } from '../UserCenterModal'

const INPUT_CLASS = 'w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.04]'

export default function AccountSection({ user, status, onUserChanged }: { user: GouoUser; status: UserCenterServiceStatus; onUserChanged: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [tokenRefreshError, setTokenRefreshError] = useState('')
  const [refreshingToken, setRefreshingToken] = useState(false)
  const [bindEmailValue, setBindEmailValue] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [bindingEmail, setBindingEmail] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const statusReady = !status.loading && !status.error

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setProfileError('')
    try {
      await updateCurrentUser(displayName)
      await onUserChanged()
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const refreshRelayToken = async () => {
    setRefreshingToken(true)
    setTokenRefreshError('')
    try {
      await createBackendSettings(true)
    } catch (err) {
      setTokenRefreshError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshingToken(false)
    }
  }

  const handlePasswordChange = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }
    setChangingPassword(true)
    setPasswordError('')
    try {
      await updatePassword(currentPassword, newPassword)
      useStore.getState().showToast('密码已修改', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await refreshRelayToken()
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : String(err))
    } finally {
      setChangingPassword(false)
    }
  }

  const handleSendEmail = async () => {
    if (!bindEmailValue.trim()) return
    setSendingEmail(true)
    setEmailError('')
    try {
      if (!statusReady) throw new Error('请先成功加载账号服务配置')
      if (status.turnstileEnabled && !turnstileToken) throw new Error('请先完成安全验证')
      await sendEmailVerification(bindEmailValue.trim(), turnstileToken)
      useStore.getState().showToast('验证码已发送，请检查邮箱', 'success')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err))
    } finally {
      setSendingEmail(false)
      setTurnstileToken('')
      setTurnstileReset((value) => value + 1)
    }
  }

  const handleBindEmail = async (event: FormEvent) => {
    event.preventDefault()
    setBindingEmail(true)
    setEmailError('')
    try {
      await bindEmail(bindEmailValue.trim(), emailCode.trim())
      await onUserChanged()
      setEmailCode('')
      useStore.getState().showToast('邮箱已绑定', 'success')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err))
    } finally {
      setBindingEmail(false)
    }
  }

  const handleLogout = async () => {
    setSigningOut(true)
    setLogoutError('')
    try {
      await logout()
      deactivateUserStorage()
      window.location.reload()
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : String(err))
      setSigningOut(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSave} className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]">
        <p className="font-semibold text-gray-900 dark:text-white">账户资料</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="min-w-0 flex-1 text-sm text-gray-500 dark:text-gray-400">
            显示名称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={20} placeholder={user.username} className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
          </label>
          <button type="submit" disabled={saving || displayName.trim() === (user.display_name ?? '')} className="self-end rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-white dark:text-gray-900 dark:hover:bg-blue-400">
            {saving ? '保存中…' : '保存资料'}
          </button>
        </div>
        {profileError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{profileError}</p>}
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handlePasswordChange} className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]">
          <p className="font-semibold text-gray-900 dark:text-white">修改密码</p>
          <p className="mt-1 text-xs text-gray-400">修改后会自动刷新当前设备的生图令牌。</p>
          <div className="mt-4 space-y-3">
            <input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="当前密码" required className={INPUT_CLASS} />
            <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="新密码（8–20 个字符）" minLength={8} maxLength={20} required className={INPUT_CLASS} />
            <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="再次输入新密码" minLength={8} maxLength={20} required className={INPUT_CLASS} />
            <button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">{changingPassword ? '修改中…' : '修改密码'}</button>
          </div>
          {passwordError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{passwordError}</p>}
          {tokenRefreshError && <div role="alert" className="mt-3 space-y-2 rounded-xl border border-amber-200 p-3 text-sm text-amber-700 dark:border-amber-500/20 dark:text-amber-300"><p>密码已修改，但创作凭据刷新失败：{tokenRefreshError}。请勿重复修改密码，可重新刷新凭据。</p><button type="button" onClick={() => void refreshRelayToken()} disabled={refreshingToken} className="underline">{refreshingToken ? '正在刷新…' : '重新刷新创作凭据'}</button></div>}
        </form>

        <form onSubmit={handleBindEmail} className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]">
          <p className="font-semibold text-gray-900 dark:text-white">绑定邮箱</p>
          <p className="mt-1 text-xs text-gray-400">{user.email ? `当前邮箱：${user.email}` : status.loading ? '正在读取邮件服务配置…' : status.error ? '邮件服务状态暂不可用。' : status.emailService ? '绑定后可使用邮箱找回密码。' : '管理员尚未配置邮件服务。'}</p>
          {status.error && <div role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">账号服务配置读取失败：{status.error} <button type="button" onClick={status.reload} disabled={status.loading} className="underline">重新加载</button></div>}
          <div className="mt-4 space-y-3">
            {statusReady && status.turnstileEnabled && <TurnstileChallenge siteKey={status.turnstileSiteKey} resetKey={turnstileReset} onToken={setTurnstileToken} />}
            <input value={bindEmailValue} onChange={(event) => { setBindEmailValue(event.target.value); setEmailCode('') }} type="email" autoComplete="email" placeholder="邮箱地址" disabled={!status.emailService || sendingEmail || bindingEmail} required className={INPUT_CLASS} />
            <div className="flex gap-2">
              <input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} inputMode="numeric" placeholder="邮箱验证码" disabled={!status.emailService} required className={`min-w-0 flex-1 ${INPUT_CLASS}`} />
              <button type="button" onClick={() => void handleSendEmail()} disabled={!status.emailService || !statusReady || sendingEmail || bindingEmail || !bindEmailValue.trim() || (status.turnstileEnabled && !turnstileToken)} className="rounded-xl border border-blue-200 px-3 text-xs font-medium text-blue-600 disabled:opacity-40 dark:border-blue-500/30 dark:text-blue-300">{sendingEmail ? '发送中…' : '发送验证码'}</button>
            </div>
            <button type="submit" disabled={!status.emailService || sendingEmail || bindingEmail || !emailCode.trim()} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{bindingEmail ? '绑定中…' : user.email ? '更换邮箱' : '绑定邮箱'}</button>
          </div>
          {emailError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{emailError}</p>}
        </form>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4 dark:border-white/[0.08]">
        {logoutError && <p role="alert" className="mr-auto text-sm text-red-600 dark:text-red-400">{logoutError}</p>}
        <button type="button" onClick={() => void handleLogout()} disabled={signingOut} className="rounded-xl border border-red-100 px-4 py-2.5 text-sm font-medium text-red-500 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:border-red-500/20 dark:hover:bg-red-500/10">
          {signingOut ? '正在退出…' : '退出登录'}
        </button>
      </div>
    </div>
  )
}
