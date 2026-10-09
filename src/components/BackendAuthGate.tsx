import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { BRAND } from '../config/brand'
import {
  createBackendSettings,
  getBackendStatus,
  getCurrentUser,
  getDefaultBackendModel,
  isBackendAuthEnabled,
  login,
  register,
  resetPassword,
  sendEmailVerification,
  sendPasswordReset,
  type GouoUser,
} from '../lib/gouoBackend'
import { activateUserStorage, shouldReloadForStorageScopeChange } from '../lib/storageScope'
import { useStore } from '../store'
import TurnstileChallenge from './TurnstileChallenge'
import LandingPage from './landing/LandingPage'

type AuthMode = 'login' | 'register' | 'reset'

const AUTH_INTRO: Record<AuthMode, { lines: string[]; desc: string; panel: string }> = {
  login: { lines: ['欢迎回来'], desc: '登录后继续使用你的额度、作品与画布。', panel: '登录光构' },
  register: { lines: ['创建你的', '光构账户'], desc: '', panel: '注册账户' },
  reset: { lines: ['找回账号'], desc: '输入邮件中的验证码，并设置新的登录密码。', panel: '重置密码' },
}
const LABEL_CLASS = 'block text-xs font-bold text-[var(--ink)]'
const INPUT_CLASS = 'mt-2 min-h-[50px] w-full rounded-[14px] border border-[#171719]/[0.14] bg-white/[0.32] px-4 text-[13px] font-normal text-[var(--ink)] outline-none transition placeholder:text-[#171719]/35 hover:border-[#171719]/25 hover:bg-white/45 focus:border-[#171719]/60 focus:bg-white/55 focus:ring-[3px] focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON_CLASS = 'shrink-0 rounded-[10px] border border-[#171719]/[0.14] bg-white/35 px-3 text-xs font-bold text-[var(--ink)] transition hover:bg-white/55 disabled:cursor-not-allowed disabled:opacity-50'

async function initializeUser(user: GouoUser): Promise<GouoUser | null> {
  if (activateUserStorage(user.id)) {
    window.location.reload()
    return null
  }
  const settings = await createBackendSettings()
  useStore.getState().setSettings({ ...settings, ...(!useStore.getState().settings.gouoModelSelected ? { model: getDefaultBackendModel() } : {}) })
  return user
}

export default function BackendAuthGate({ children }: { children: ReactNode }) {
  const enabled = isBackendAuthEnabled()
  const [checking, setChecking] = useState(enabled)
  const [user, setUser] = useState<GouoUser | null>(null)
  const resetParams = new URLSearchParams(window.location.search)
  const [mode, setMode] = useState<AuthMode>(resetParams.get('token') && resetParams.get('email') ? 'reset' : 'login')
  // 未登录先看首页；邮件里的重置链接直接进入表单。
  const [view, setView] = useState<'home' | 'auth'>(resetParams.get('token') && resetParams.get('email') ? 'auth' : 'home')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState(resetParams.get('email') ?? '')
  const [verificationCode, setVerificationCode] = useState('')
  const [resetToken, setResetToken] = useState(resetParams.get('token') ?? '')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailService, setEmailService] = useState(false)
  const [emailVerification, setEmailVerification] = useState(false)
  const [backendStatusLoaded, setBackendStatusLoaded] = useState(!enabled)
  const [statusError, setStatusError] = useState('')
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [sendingVerification, setSendingVerification] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
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
        const message = checkError instanceof Error ? checkError.message : String(checkError)
        if (!/未登录|会话已失效|access token 无效|HTTP 401/.test(message)) setError(message)
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
    let active = true
    setBackendStatusLoaded(false)
    setStatusError('')
    void getBackendStatus()
      .then((status) => {
        if (!active) return
        setEmailService(Boolean(status.email_service))
        setEmailVerification(Boolean(status.email_verification))
        setTurnstileEnabled(Boolean(status.turnstile_check))
        setTurnstileSiteKey(status.turnstile_site_key ?? '')
        setBackendStatusLoaded(true)
      })
      .catch((err) => { if (active) setStatusError(err instanceof Error ? err.message : String(err)) })
    return () => { active = false }
  }, [enabled, statusAttempt])

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
        if (turnstileEnabled && !turnstileToken) throw new Error('请先完成安全验证')
        await register({ username, password, email, verificationCode, turnstileToken })
      }
      const currentUser = await login(username.trim(), password)
      const initializedUser = await initializeUser(currentUser)
      if (initializedUser) setUser(initializedUser)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
      if (mode === 'register') { setTurnstileToken(''); setTurnstileReset((value) => value + 1) }
    }
  }

  const handleSendReset = async () => {
    setError('')
    setSubmitting(true)
    try {
      if (turnstileEnabled && !turnstileToken) throw new Error('请先完成安全验证')
      await sendPasswordReset(email.trim(), turnstileToken)
      setResetEmailSent(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError))
    } finally {
      setSubmitting(false)
      setTurnstileToken('')
      setTurnstileReset((value) => value + 1)
    }
  }

  const handleSendVerification = async () => {
    if (!email.trim()) return
    setError('')
    setSendingVerification(true)
    try {
      if (turnstileEnabled && !turnstileToken) throw new Error('请先完成安全验证')
      await sendEmailVerification(email.trim(), turnstileToken)
      setVerificationSent(true)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError))
    } finally {
      setSendingVerification(false)
      setTurnstileToken('')
      setTurnstileReset((value) => value + 1)
    }
  }

  if (checking) {
    return (
      <main className="gouo-public gouo-grainient-light grid min-h-[100dvh] place-items-center">
        <img src={BRAND.logoUrl} alt="正在检查登录状态" className="h-14 w-14 animate-pulse rounded-2xl" />
      </main>
    )
  }

  if (view === 'home') {
    return (
      <LandingPage
        onLogin={() => { setMode('login'); setError(''); setView('auth') }}
        onRegister={() => { setMode('register'); setError(''); setView('auth') }}
      />
    )
  }

  const intro = AUTH_INTRO[mode]

  return (
    <main className="gouo-public gouo-grainient-light min-h-[100dvh]">
      <header className="mx-auto flex w-[min(1280px,calc(100%-40px))] items-center justify-between pt-6">
        <button type="button" onClick={() => setView('home')} className="flex items-center gap-2.5 font-semibold">
          <img src={BRAND.logoUrl} alt="" className="h-9 w-9 rounded-xl" />
          {BRAND.name}
        </button>
        <button type="button" onClick={() => setView('home')} className="gouo-glass rounded-xl px-4 py-2 text-[13px] font-semibold transition hover:bg-white/50">返回首页</button>
      </header>

      <div className="mx-auto grid w-[min(1280px,calc(100%-40px))] items-center gap-8 py-12 lg:min-h-[calc(100dvh-84px)] lg:grid-cols-[minmax(0,1fr)_minmax(380px,520px)] lg:gap-[clamp(56px,9vw,136px)]">
        <section key={mode}>
          <h1 className="text-[clamp(2.8rem,6.4vw,6rem)] font-semibold leading-[0.94] tracking-[-0.065em]">
            {intro.lines.map((line, index) => (
              <span key={line} className="gouo-line-mask"><span className="gouo-line-text whitespace-nowrap" style={{ '--delay': `${0.08 + index * 0.1}s` } as CSSProperties}>{line}</span></span>
            ))}
          </h1>
          <p className="gouo-fade-up mt-6 max-w-[34rem] text-[17px] font-medium leading-[1.65] tracking-[-0.02em] text-[var(--ink-soft)]" style={{ '--delay': '0.3s' } as CSSProperties}>
            {mode === 'register' ? `用户名最多 12 个字符，密码 8–20 位${emailVerification ? '，需验证邮箱' : ''}。注册后兑换额度即可开始创作。` : intro.desc}
          </p>
        </section>

        <section className="gouo-glass gouo-fade-up w-full rounded-[28px] p-6 sm:p-[34px]" style={{ '--delay': '0.15s' } as CSSProperties}>
          {/* 登录不依赖账号服务配置，仅注册/重置需要 Turnstile 与邮件选项 */}
          {statusError && mode !== 'login' ? (
            <div role="alert" className="space-y-4 text-sm text-red-700">
              <p>无法读取账号服务配置：{statusError}</p>
              <button type="button" onClick={() => setStatusAttempt((value) => value + 1)} className={SECONDARY_BUTTON_CLASS + ' min-h-10'}>重新加载</button>
            </div>
          ) : !backendStatusLoaded && !statusError ? (
            <div className="py-10 text-center text-sm text-[var(--ink-soft)]">正在读取账号服务配置…</div>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">{intro.panel}</h2>
              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                {turnstileEnabled && mode !== 'login' && <TurnstileChallenge key={mode} siteKey={turnstileSiteKey} resetKey={turnstileReset} onToken={setTurnstileToken} />}
                {mode !== 'reset' ? (
                  <label className={LABEL_CLASS}>
                    用户名
                    <input className={INPUT_CLASS} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={12} autoComplete="username" required />
                  </label>
                ) : (
                  <>
                    <label className={LABEL_CLASS}>
                      邮箱
                      <input className={INPUT_CLASS} value={email} onChange={(e) => { setEmail(e.target.value); setResetEmailSent(false); setResetToken('') }} disabled={submitting} type="email" autoComplete="email" required />
                    </label>
                    <div className="flex gap-2">
                      <input className={INPUT_CLASS + ' mt-0 min-w-0 flex-1'} value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="邮件验证码" required />
                      <button type="button" onClick={() => void handleSendReset()} disabled={submitting || !email.trim() || (turnstileEnabled && !turnstileToken)} className={SECONDARY_BUTTON_CLASS}>{resetEmailSent ? '重新发送' : '发送邮件'}</button>
                    </div>
                  </>
                )}
                <label className={LABEL_CLASS}>
                  {mode === 'reset' ? '新密码' : '密码'}
                  <input className={INPUT_CLASS} value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={mode === 'login' ? undefined : 8} maxLength={mode === 'login' ? undefined : 20} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
                </label>
                {mode === 'reset' && (
                  <label className={LABEL_CLASS}>
                    确认新密码
                    <input className={INPUT_CLASS} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" minLength={8} maxLength={20} autoComplete="new-password" required />
                  </label>
                )}
                {mode === 'register' && emailVerification && (
                  <>
                    <label className={LABEL_CLASS}>
                      邮箱
                      <input className={INPUT_CLASS} value={email} onChange={(e) => { setEmail(e.target.value); setVerificationCode(''); setVerificationSent(false) }} disabled={sendingVerification || submitting} type="email" autoComplete="email" required />
                    </label>
                    <div>
                      <label htmlFor="registration-verification-code" className={LABEL_CLASS}>邮箱验证码</label>
                      <div className="mt-2 flex gap-2">
                        <input id="registration-verification-code" className={INPUT_CLASS + ' mt-0 min-w-0 flex-1'} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
                        <button type="button" onClick={() => void handleSendVerification()} disabled={!emailService || sendingVerification || submitting || !email.trim() || (turnstileEnabled && !turnstileToken)} className={SECONDARY_BUTTON_CLASS}>
                          {sendingVerification ? '发送中…' : verificationSent ? '重新发送' : '发送验证码'}
                        </button>
                      </div>
                      {!emailService && <span className="mt-2 block text-xs text-amber-700">邮件服务暂不可用，请联系管理员检查 SMTP 配置。</span>}
                      {emailService && verificationSent && <span className="mt-2 block text-xs text-emerald-700">验证码已发送，请检查邮箱。</span>}
                    </div>
                  </>
                )}

                {error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-50/70 px-4 py-3 text-sm leading-5 text-red-700">{error}</div>}

                <button type="submit" disabled={submitting || sendingVerification || (mode === 'register' && turnstileEnabled && !turnstileToken)} className="min-h-12 w-full rounded-[13px] bg-[#101012] text-[13px] font-bold text-white shadow-[0_14px_30px_rgb(27_24_28/0.16)] transition hover:-translate-y-px hover:bg-black disabled:cursor-wait disabled:bg-[#6f6f73] disabled:shadow-none">
                  {submitting ? '请稍候…' : mode === 'login' ? '登录并进入' : mode === 'register' ? '注册并进入' : '确认重置密码'}
                </button>
              </form>

              <div className="mt-6 flex items-center justify-center gap-5 text-[13px] text-[var(--ink-soft)]">
                <button type="button" disabled={sendingVerification || submitting} className="underline-offset-4 hover:text-[var(--ink)] hover:underline disabled:opacity-40" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
                  {mode === 'login' ? '还没有账户？立即注册' : '返回登录'}
                </button>
                {mode === 'login' && emailService && <button type="button" disabled={submitting} className="underline-offset-4 hover:text-[var(--ink)] hover:underline disabled:opacity-40" onClick={() => { setMode('reset'); setError('') }}>忘记密码</button>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
