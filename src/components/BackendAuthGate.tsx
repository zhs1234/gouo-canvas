import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { BRAND } from '../config/brand'
import {
  createBackendSettings,
  getBackendStatus,
  getCurrentUser,
  isBackendAuthEnabled,
  login,
  register,
  resetPassword,
  sendPasswordReset,
  type GouoUser,
} from '../lib/gouoBackend'
import { activateUserStorage, shouldReloadForStorageScopeChange } from '../lib/storageScope'
import { useStore } from '../store'

type AuthMode = 'login' | 'register' | 'reset'

async function initializeUser(user: GouoUser): Promise<GouoUser | null> {
  if (activateUserStorage(user.id)) {
    window.location.reload()
    return null
  }
  const settings = await createBackendSettings()
  useStore.getState().setSettings(settings)
  return user
}

export default function BackendAuthGate({ children }: { children: ReactNode }) {
  const enabled = isBackendAuthEnabled()
  const [checking, setChecking] = useState(enabled)
  const [user, setUser] = useState<GouoUser | null>(null)
  const resetParams = new URLSearchParams(window.location.search)
  const [mode, setMode] = useState<AuthMode>(resetParams.get('token') && resetParams.get('email') ? 'reset' : 'login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [resetToken, setResetToken] = useState(resetParams.get('token') ?? '')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailService, setEmailService] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    getCurrentUser()
      .then(initializeUser)
      .then((currentUser) => {
        if (!cancelled && currentUser) setUser(currentUser)
      })
      .catch((checkError) => {
        if (cancelled) return
        setUser(null)
        if (checkError instanceof Error && checkError.message.includes('本地存储')) setError(checkError.message)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => { cancelled = true }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    const handleStorage = (event: StorageEvent) => {
      if (shouldReloadForStorageScopeChange(event)) window.location.reload()
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void getBackendStatus().then((status) => setEmailService(Boolean(status.email_service))).catch(() => {})
  }, [enabled])

  if (!enabled || user) return <>{children}</>

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'reset') {
        if (password !== confirmPassword) throw new Error('两次输入的新密码不一致')
        await resetPassword(email.trim(), resetToken.trim(), password)
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setResetToken('')
        window.history.replaceState(null, '', window.location.pathname)
        setError('密码已重置，请使用新密码登录')
        return
      }
      if (mode === 'register') {
        await register({ username, password, email, verificationCode })
      }
      const currentUser = await login(username.trim(), password)
      const initializedUser = await initializeUser(currentUser)
      if (initializedUser) setUser(initializedUser)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSendReset = async () => {
    setError('')
    setSubmitting(true)
    try {
      await sendPasswordReset(email.trim())
      setResetEmailSent(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#05070d] text-white grid lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden border-r border-white/10 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-blue-400/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-blue-700/20 blur-[140px]" />
        <div className="relative flex items-center gap-3">
          <img src={BRAND.logoUrl} alt="" className="h-11 w-11 rounded-xl" />
          <div>
            <div className="text-lg font-semibold tracking-wide">{BRAND.name}</div>
            <div className="text-xs text-white/45">{BRAND.nameEn}</div>
          </div>
        </div>
        <div className="relative max-w-xl">
          <p className="mb-5 text-sm font-medium tracking-[0.25em] text-blue-300">AI VISUAL WORKSPACE</p>
          <h1 className="text-5xl font-semibold leading-tight tracking-tight">{BRAND.slogan}</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/55">统一的图片生成、编辑与多轮创作空间。你的凭据由平台后端托管，每次调用按账户额度安全结算。</p>
        </div>
        <p className="relative text-xs text-white/35">Built by {BRAND.team}</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <img src={BRAND.logoUrl} alt="" className="h-10 w-10 rounded-xl" />
            <div className="font-semibold">{BRAND.name} · {BRAND.nameEn}</div>
          </div>

          {checking ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center text-sm text-white/55">正在检查登录状态…</div>
          ) : (
            <>
              <p className="text-sm font-medium text-blue-300">{mode === 'login' ? '欢迎回来' : mode === 'register' ? '创建账户' : '账户恢复'}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{mode === 'login' ? '登录光构' : mode === 'register' ? '开始你的创作空间' : '重置密码'}</h2>
              <p className="mt-3 text-sm leading-6 text-white/45">{mode === 'login' ? '登录后使用你的专属额度与云端作品。' : mode === 'register' ? '用户名最多 12 个字符，密码为 8–20 个字符。' : '输入邮件中的验证码，并设置新的登录密码。'}</p>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                {mode !== 'reset' ? (
                  <label className="block text-sm text-white/70">
                    用户名
                    <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/10" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={12} autoComplete="username" required />
                  </label>
                ) : (
                  <>
                    <label className="block text-sm text-white/70">
                      邮箱
                      <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition focus:border-blue-400/60" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
                    </label>
                    <div className="flex gap-2">
                      <input className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition focus:border-blue-400/60" value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="邮件验证码" required />
                      <button type="button" onClick={() => void handleSendReset()} disabled={submitting || !email.trim()} className="rounded-xl border border-blue-400/30 px-3 text-sm text-blue-200 disabled:opacity-40">{resetEmailSent ? '重新发送' : '发送邮件'}</button>
                    </div>
                  </>
                )}
                <label className="block text-sm text-white/70">
                  {mode === 'reset' ? '新密码' : '密码'}
                  <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/10" value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={8} maxLength={20} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
                </label>
                {mode === 'reset' && (
                  <label className="block text-sm text-white/70">
                    确认新密码
                    <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition focus:border-blue-400/60" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" minLength={8} maxLength={20} autoComplete="new-password" required />
                  </label>
                )}
                {mode === 'register' && (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block text-sm text-white/70">
                      邮箱 <span className="text-white/30">（按后端配置）</span>
                      <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition focus:border-blue-400/60" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
                    </label>
                    <label className="block text-sm text-white/70">
                      邮箱验证码
                      <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-white outline-none transition focus:border-blue-400/60" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} inputMode="numeric" />
                    </label>
                  </div>
                )}

                {error && <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-5 text-red-200">{error}</div>}

                <button type="submit" disabled={submitting} className="w-full rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 px-4 py-3 font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
                  {submitting ? '请稍候…' : mode === 'login' ? '登录并进入' : mode === 'register' ? '注册并进入' : '确认重置密码'}
                </button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-4 text-sm text-white/45">
                <button type="button" className="hover:text-blue-300" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
                  {mode === 'login' ? '还没有账户？立即注册' : '返回登录'}
                </button>
                {mode === 'login' && emailService && <button type="button" className="hover:text-blue-300" onClick={() => { setMode('reset'); setError('') }}>忘记密码</button>}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
