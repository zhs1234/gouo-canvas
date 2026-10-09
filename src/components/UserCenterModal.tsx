import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bindEmail, createBackendSettings, getBackendStatus, getCurrentUser, getUsageLogs, logout, redeemCode, sendEmailVerification, updateCurrentUser, updatePassword, type GouoUsageLog, type GouoUser } from '../lib/gouoBackend'
import { useCloudSyncSnapshot } from '../lib/cloudSync'
import { deactivateUserStorage } from '../lib/storageScope'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, RefreshIcon, UserIcon } from './icons'
import ImageBillingRecords from './ImageBillingRecords'
import { copyTextToClipboard } from '../lib/clipboard'
import { formatCNY, getUsageDisplay } from '../lib/accountUsage'
import { createLatestRequest } from '../lib/latestRequest'
import TurnstileChallenge from './TurnstileChallenge'

interface UserCenterModalProps {
  initialSection?: 'overview' | 'topup' | 'logs' | 'security'
  onClose: () => void
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '暂无记录'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false })
}

export default function UserCenterModal({ initialSection = 'overview', onClose }: UserCenterModalProps) {
  const scrollBoundaryRef = useRef<HTMLDivElement>(null)
  const userRequest = useRef(createLatestRequest())
  const logsRequest = useRef(createLatestRequest())
  const statusRequest = useRef(createLatestRequest())
  const [user, setUser] = useState<GouoUser | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [activeSection, setActiveSection] = useState<'overview' | 'topup' | 'logs' | 'security'>(initialSection)
  const [redemptionCode, setRedemptionCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMessage, setRedeemMessage] = useState('')
  const [logs, setLogs] = useState<GouoUsageLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState('')
  const [userError, setUserError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [statusLoading, setStatusLoading] = useState(true)
  const [logsPage, setLogsPage] = useState(1)
  const [logsTotal, setLogsTotal] = useState(0)
  const [logModel, setLogModel] = useState('')
  const [logType, setLogType] = useState(0)
  const [logStart, setLogStart] = useState('')
  const [logEnd, setLogEnd] = useState('')
  const [emailService, setEmailService] = useState(false)
  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [redemptionHelp, setRedemptionHelp] = useState('')
  const [supportContact, setSupportContact] = useState('')
  const [supportCopied, setSupportCopied] = useState(false)
  const [bindEmailValue, setBindEmailValue] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [bindingEmail, setBindingEmail] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [tokenRefreshError, setTokenRefreshError] = useState('')
  const [refreshingToken, setRefreshingToken] = useState(false)
  const [error, setError] = useState('')
  const sync = useCloudSyncSnapshot()
  let supportUrl = ''
  try {
    const url = new URL(supportContact)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) supportUrl = url.href
  } catch { /* 非网址的邮箱、微信号按文字展示并提供复制。 */ }

  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, scrollBoundaryRef)

  const loadUser = useCallback(async () => {
    setLoading(true)
    setUserError('')
    await userRequest.current.run(getCurrentUser, (currentUser) => {
      setUser(currentUser)
      setDisplayName(currentUser.display_name ?? '')
    }, (err) => setUserError(err instanceof Error ? err.message : String(err)), () => setLoading(false))
  }, [])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError('')
    await statusRequest.current.run(getBackendStatus, (status) => {
      setEmailService(Boolean(status.email_service))
      setTurnstileEnabled(Boolean(status.turnstile_check))
      setTurnstileSiteKey(status.turnstile_site_key ?? '')
      setRedemptionHelp(typeof status.gouo_redemption_help === 'string' ? status.gouo_redemption_help : '')
      setSupportContact(typeof status.gouo_support_contact === 'string' ? status.gouo_support_contact : '')
    }, (err) => setStatusError(err instanceof Error ? err.message : String(err)), () => setStatusLoading(false))
  }, [])

  useEffect(() => {
    void loadUser()
    void loadStatus()
    const requests = [userRequest.current, logsRequest.current, statusRequest.current]
    return () => { for (const request of requests) request.invalidate() }
  }, [loadUser, loadStatus])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    setLogsError('')
    setLogs([])
    await logsRequest.current.run(() => getUsageLogs(logsPage, 20, {
        model: logModel.trim() || undefined,
        type: logType || undefined,
        start: logStart ? Math.floor(new Date(`${logStart}T00:00:00`).getTime() / 1000) : undefined,
        end: logEnd ? Math.floor(new Date(`${logEnd}T23:59:59`).getTime() / 1000) : undefined,
      }), (result) => {
      setLogs(result.data)
      setLogsTotal(result.total_count)
    }, (err) => setLogsError(err instanceof Error ? err.message : String(err)), () => setLogsLoading(false))
  }, [logEnd, logModel, logStart, logType, logsPage])

  useEffect(() => {
    if (activeSection === 'logs') void loadLogs()
    const request = logsRequest.current
    return () => request.invalidate()
  }, [activeSection, loadLogs])

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateCurrentUser(displayName)
      await loadUser()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    setSigningOut(true)
    setError('')
    try {
      await logout()
      deactivateUserStorage()
      window.location.reload()
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : String(logoutError))
      setSigningOut(false)
    }
  }

  const handleRedeem = async (event: FormEvent) => {
    event.preventDefault()
    if (!redemptionCode.trim()) return
    setRedeeming(true)
    setError('')
    setRedeemMessage('')
    try {
      const quota = await redeemCode(redemptionCode)
      setRedemptionCode('')
      const rate = user?.quota_cny_rate
      setRedeemMessage(typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? `充值成功，已增加 ${formatCNY(quota * rate)}` : `充值成功，已增加 ${quota.toLocaleString('zh-CN')} 额度，人民币折算暂不可用`)
      await loadUser()
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : String(redeemError))
    } finally {
      setRedeeming(false)
    }
  }

  const refreshRelayToken = async () => {
    setRefreshingToken(true)
    setTokenRefreshError('')
    try {
      const settings = await createBackendSettings(true)
      useStore.getState().setSettings(settings)
    } catch (refreshError) {
      setTokenRefreshError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setRefreshingToken(false)
    }
  }

  const handlePasswordChange = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }
    setChangingPassword(true)
    setError('')
    try {
      await updatePassword(currentPassword, newPassword)
      useStore.getState().showToast('密码已修改', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await refreshRelayToken()
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : String(passwordError))
    } finally {
      setChangingPassword(false)
    }
  }

  const handleSendEmail = async () => {
    if (!bindEmailValue.trim()) return
    setSendingEmail(true)
    setError('')
    try {
      if (statusLoading || statusError) throw new Error('请先成功加载账号服务配置')
      if (turnstileEnabled && !turnstileToken) throw new Error('请先完成安全验证')
      await sendEmailVerification(bindEmailValue.trim(), turnstileToken)
      useStore.getState().showToast('验证码已发送，请检查邮箱', 'success')
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : String(emailError))
    } finally {
      setSendingEmail(false)
      setTurnstileToken('')
      setTurnstileReset((value) => value + 1)
    }
  }

  const handleBindEmail = async (event: FormEvent) => {
    event.preventDefault()
    setBindingEmail(true)
    setError('')
    try {
      await bindEmail(bindEmailValue.trim(), emailCode.trim())
      await loadUser()
      setEmailCode('')
      useStore.getState().showToast('邮箱已绑定', 'success')
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : String(emailError))
    } finally {
      setBindingEmail(false)
    }
  }

  const exportLogs = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['时间', '类型', '模型', '金额', '计费单位', '单价', '实际扣费额度', '退款额度', '耗时', 'Request ID', '内容'],
      ...logs.map((log) => {
        const display = getUsageDisplay(log, user?.quota_cny_rate)
        return [formatTime(log.created_at), display.label, log.model_name || '', display.delta === null ? '金额不可用' : display.delta.toFixed(2), display.unit, log.metadata?.price_cny ?? '', log.metadata?.charged_quota ?? (log.type === 2 ? log.quota : ''), log.metadata?.billing_status === 'refunded' ? log.quota : '', log.request_time ?? '', log.metadata?.request_id || log.metadata?.requestId || '', log.content || '']
      }),
    ]
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gouo-usage-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const avatarText = (user?.display_name || user?.username || '光').trim().slice(0, 1).toUpperCase()

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-gray-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={scrollBoundaryRef} role="dialog" aria-modal="true" aria-label="光构用户中心" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-950 sm:max-w-3xl sm:rounded-[28px]">
        <div className="relative overflow-hidden border-b border-gray-100 px-6 pb-7 pt-6 dark:border-white/[0.08] sm:px-8 sm:pb-8 sm:pt-8">
          <div className="pointer-events-none absolute -right-16 -top-28 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="pointer-events-none absolute right-24 top-4 h-36 w-36 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-blue-500">GOUO ACCOUNT</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">光构用户中心</h2>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">管理账户资料、额度与使用记录</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200" aria-label="关闭用户中心">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          {loading && !user ? (
            <div className="flex min-h-60 items-center justify-center text-sm text-gray-400">正在读取账户信息…</div>
          ) : user ? (
            <>
              <section className="flex flex-col gap-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 dark:border-white/[0.08] dark:bg-white/[0.03] sm:flex-row sm:items-center">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-2xl font-bold text-white shadow-lg shadow-blue-500/20">
                  {user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : avatarText}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-xl font-semibold text-gray-900 dark:text-white">{user.display_name || user.username}</h3>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">光构用户</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">@{user.username}{user.email ? ` · ${user.email}` : ''}</p>
                  <p className="mt-2 text-xs text-gray-400">用户 ID {user.id} · 累计请求 {user.request_count?.toLocaleString('zh-CN') ?? '—'} 次 · 加入于 {formatDate(user.created_time)}</p>
                </div>
                <button type="button" onClick={() => void loadUser()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
                  <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </section>

              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 p-5 text-white shadow-lg shadow-blue-500/15">
                  <p className="text-sm text-white/70">账户余额</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight">{formatCNY(user.balance_cny)}</p>
                  <p className="mt-1 text-xs text-white/55">{typeof user.balance_cny === 'number' && Number.isFinite(user.balance_cny) ? '人民币余额' : '余额暂不可用，请刷新账户'}</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">累计消费</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{formatCNY(user.used_cny)}</p>
                  <p className="mt-1 text-xs text-gray-400">已消耗额度按当前兑换率折合</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">图片计费</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">按模型定价</p>
                  <p className="mt-1 text-xs text-gray-400">生成前确认价格，每次成功请求扣费</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">云端空间</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{sync.storage?.enabled === false ? '未开启' : sync.storage?.enabled ? `${(sync.storage.used_bytes / 1024 ** 2).toFixed(0)} MB` : '—'}</p>
                  <p className="mt-1 text-xs text-gray-400">{sync.storage?.enabled === false ? '作品保存在当前浏览器' : sync.storage?.enabled ? `共 ${(sync.storage.quota_bytes / 1024 ** 3).toFixed(0)} GB` : '存储状态暂不可用'}</p>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-3">
                <button type="button" onClick={() => setActiveSection(activeSection === 'topup' ? 'overview' : 'topup')} className={`group rounded-2xl border p-5 text-left transition ${activeSection === 'topup' ? 'border-blue-300 bg-blue-50 dark:border-blue-400/30 dark:bg-blue-500/10' : 'border-blue-100 bg-blue-50/70 hover:border-blue-200 hover:bg-blue-50 dark:border-blue-500/15 dark:bg-blue-500/[0.08]'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-blue-700 dark:text-blue-300">充值额度</p>
                      <p className="mt-1 text-sm text-blue-600/65 dark:text-blue-300/55">在光构内兑换新的创作额度</p>
                    </div>
                    <span className={`text-xl text-blue-500 transition-transform ${activeSection === 'topup' ? 'rotate-90' : 'group-hover:translate-x-1'}`}>→</span>
                  </div>
                </button>
                <button type="button" onClick={() => setActiveSection(activeSection === 'logs' ? 'overview' : 'logs')} className={`group rounded-2xl border p-5 text-left transition ${activeSection === 'logs' ? 'border-gray-300 bg-gray-100 dark:border-white/20 dark:bg-white/[0.06]' : 'border-gray-100 bg-gray-50/70 hover:border-gray-200 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03]'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">使用记录</p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">查看请求明细与额度消耗</p>
                    </div>
                    <span className={`text-xl text-gray-400 transition-transform ${activeSection === 'logs' ? 'rotate-90' : 'group-hover:translate-x-1'}`}>→</span>
                  </div>
                </button>
                <button type="button" onClick={() => setActiveSection(activeSection === 'security' ? 'overview' : 'security')} className={`group rounded-2xl border p-5 text-left transition ${activeSection === 'security' ? 'border-blue-300 bg-blue-50 dark:border-blue-400/30 dark:bg-blue-500/10' : 'border-gray-100 bg-gray-50/70 hover:border-blue-200 hover:bg-blue-50/50 dark:border-white/[0.08] dark:bg-white/[0.03]'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">账户安全</p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">修改密码与绑定邮箱</p>
                    </div>
                    <span className={`text-xl text-gray-400 transition-transform ${activeSection === 'security' ? 'rotate-90' : 'group-hover:translate-x-1'}`}>→</span>
                  </div>
                </button>
              </section>

              {activeSection === 'topup' && (
                <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/60 p-5 dark:border-blue-500/15 dark:from-blue-500/[0.08] dark:to-blue-700/[0.04]">
                  <p className="font-semibold text-gray-900 dark:text-white">兑换码充值</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">输入兑换码，额度将充入当前账户。每个兑换码只能使用一次。</p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-600 dark:text-gray-300">{redemptionHelp || '兑换码获取说明暂未配置。'}</p>
                  <form onSubmit={handleRedeem} className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <input value={redemptionCode} onChange={(event) => setRedemptionCode(event.target.value)} autoComplete="off" placeholder="请输入光构兑换码" className="min-w-0 flex-1 rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 dark:border-white/10 dark:bg-gray-950/60 dark:text-white" />
                    <button type="submit" disabled={redeeming || !redemptionCode.trim()} className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-800 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
                      {redeeming ? '兑换中…' : '立即兑换'}
                    </button>
                  </form>
                  {redeemMessage && <p className="mt-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">{redeemMessage}</p>}
                </section>
              )}

              {activeSection === 'logs' && (
                <section className="overflow-hidden rounded-2xl border border-gray-100 dark:border-white/[0.08]">
                  <ImageBillingRecords />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">使用记录</p>
                      <p className="mt-1 text-xs text-gray-400">{logsLoading ? '正在读取记录' : logsError ? '记录读取失败' : `共 ${logsTotal.toLocaleString('zh-CN')} 条记录，每页 20 条`}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={exportLogs} disabled={logsLoading || Boolean(logsError) || !logs.length} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-40 dark:border-white/10">导出本页 CSV</button>
                      <button type="button" onClick={() => void loadLogs()} disabled={logsLoading} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-blue-500 disabled:cursor-wait dark:hover:bg-white/[0.06]" aria-label="刷新使用记录">
                        <RefreshIcon className={`h-4 w-4 ${logsLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08] sm:grid-cols-2 lg:grid-cols-4">
                    <input value={logModel} onChange={(event) => { setLogModel(event.target.value); setLogsPage(1) }} placeholder="按模型筛选" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-white/[0.04]" />
                    <select value={logType} onChange={(event) => { setLogType(Number(event.target.value)); setLogsPage(1) }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-gray-900">
                      <option value={0}>全部类型</option>
                      <option value={1}>额度充值</option>
                      <option value={2}>模型消费</option>
                      <option value={3}>额度调整</option>
                    </select>
                    <input type="date" value={logStart} max={logEnd || undefined} onChange={(event) => { setLogStart(event.target.value); setLogsPage(1) }} aria-label="开始日期" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-gray-900" />
                    <input type="date" value={logEnd} min={logStart || undefined} onChange={(event) => { setLogEnd(event.target.value); setLogsPage(1) }} aria-label="结束日期" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-gray-900" />
                  </div>
                  {logsLoading ? (
                    <div className="py-10 text-center text-sm text-gray-400">正在读取使用记录…</div>
                  ) : logsError ? (
                    <div role="alert" className="space-y-3 px-5 py-8 text-sm text-red-600 dark:text-red-400"><p>{logsError}</p><button type="button" onClick={() => void loadLogs()} className="underline">重新读取使用记录</button></div>
                  ) : logs.length ? (
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      {logs.map((log, index) => (
                        <div key={`${log.created_at}-${index}`} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{getUsageDisplay(log, user.quota_cny_rate).label}</span>
                              {log.model_name && <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{log.model_name}</span>}
                            </div>
                            <p className="mt-1 truncate text-xs text-gray-400">{formatTime(log.created_at)}{log.content ? ` · ${log.content}` : ''}</p>
                            {Boolean(log.metadata?.request_id || log.metadata?.requestId) && <p className="mt-1 truncate font-mono text-[11px] text-gray-400">Request ID: {String(log.metadata?.request_id || log.metadata?.requestId)}</p>}
                            {log.metadata?.billing_unit === 'successful_request' && <p className="mt-1 text-xs text-gray-400">单价 ¥{String(log.metadata.price_cny)}/次成功请求</p>}
                          </div>
                          <div className="text-left sm:text-right">
                            <p className={`text-sm font-semibold ${(getUsageDisplay(log, user.quota_cny_rate).delta ?? 0) > 0 ? 'text-emerald-500' : 'text-gray-700 dark:text-gray-300'}`}>{getUsageDisplay(log, user.quota_cny_rate).amountText}</p>
                            {log.request_time ? <p className="mt-1 text-xs text-gray-400">{log.request_time} ms</p> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-10 text-center text-sm text-gray-400">暂无使用记录</div>
                  )}
                  <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-xs dark:border-white/[0.08]">
                    <button type="button" disabled={logsPage <= 1 || logsLoading} onClick={() => setLogsPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-35 dark:border-white/10">上一页</button>
                    <span className="text-gray-400">{logsError ? '分页信息不可用' : `第 ${logsPage} / ${Math.max(1, Math.ceil(logsTotal / 20))} 页`}</span>
                    <button type="button" disabled={logsPage * 20 >= logsTotal || logsLoading || Boolean(logsError)} onClick={() => setLogsPage((page) => page + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-35 dark:border-white/10">下一页</button>
                  </div>
                </section>
              )}

              {activeSection === 'security' && (
                <section className="grid gap-4 lg:grid-cols-2">
                  <form onSubmit={handlePasswordChange} className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]">
                    <p className="font-semibold text-gray-900 dark:text-white">修改密码</p>
                    <p className="mt-1 text-xs text-gray-400">修改后会自动刷新当前设备的生图令牌。</p>
                    <div className="mt-4 space-y-3">
                      <input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="当前密码" required className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-white/10 dark:bg-white/[0.04]" />
                      <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="新密码（8–20 个字符）" minLength={8} maxLength={20} required className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-white/10 dark:bg-white/[0.04]" />
                      <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="再次输入新密码" minLength={8} maxLength={20} required className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-white/10 dark:bg-white/[0.04]" />
                      <button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} className="w-full rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-gray-900">{changingPassword ? '修改中…' : '修改密码'}</button>
                    </div>
                  </form>

                  <form onSubmit={handleBindEmail} className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]">
                    <p className="font-semibold text-gray-900 dark:text-white">绑定邮箱</p>
                    <p className="mt-1 text-xs text-gray-400">{user.email ? `当前邮箱：${user.email}` : statusLoading ? '正在读取邮件服务配置…' : statusError ? '邮件服务状态暂不可用，请重新加载配置。' : emailService ? '绑定后可使用邮箱找回密码。' : '管理员尚未配置邮件服务。'}</p>
                    <div className="mt-4 space-y-3">
                      {!statusLoading && !statusError && turnstileEnabled && <TurnstileChallenge siteKey={turnstileSiteKey} resetKey={turnstileReset} onToken={setTurnstileToken} />}
                      <input value={bindEmailValue} onChange={(event) => { setBindEmailValue(event.target.value); setEmailCode('') }} type="email" autoComplete="email" placeholder="邮箱地址" disabled={!emailService || sendingEmail || bindingEmail} required className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.04]" />
                      <div className="flex gap-2">
                        <input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} inputMode="numeric" placeholder="邮箱验证码" disabled={!emailService} required className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.04]" />
                        <button type="button" onClick={() => void handleSendEmail()} disabled={!emailService || statusLoading || Boolean(statusError) || sendingEmail || bindingEmail || !bindEmailValue.trim() || (turnstileEnabled && !turnstileToken)} className="rounded-xl border border-blue-200 px-3 text-xs font-medium text-blue-600 disabled:opacity-40 dark:border-blue-500/30 dark:text-blue-300">{sendingEmail ? '发送中…' : '发送验证码'}</button>
                      </div>
                      <button type="submit" disabled={!emailService || sendingEmail || bindingEmail || !emailCode.trim()} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{bindingEmail ? '绑定中…' : user.email ? '更换邮箱' : '绑定邮箱'}</button>
                    </div>
                  </form>
                </section>
              )}

              <form onSubmit={handleSave} className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                  <UserIcon className="h-4 w-4 text-blue-500" />
                  账户资料
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <label className="min-w-0 flex-1 text-sm text-gray-500 dark:text-gray-400">
                    显示名称
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={20} placeholder={user.username} className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" />
                  </label>
                  <button type="submit" disabled={saving || displayName.trim() === (user.display_name ?? '')} className="self-end rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-white dark:text-gray-900 dark:hover:bg-blue-400">
                    {saving ? '保存中…' : '保存资料'}
                  </button>
                </div>
              </form>
            </>
          ) : null}

          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
          {tokenRefreshError && <div role="alert" className="space-y-2 rounded-xl border border-amber-200 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:text-amber-300"><p>密码已修改，但创作凭据刷新失败：{tokenRefreshError}。请勿重复修改密码，可重新刷新凭据。</p><button type="button" onClick={() => void refreshRelayToken()} disabled={refreshingToken} className="underline">{refreshingToken ? '正在刷新…' : '重新刷新创作凭据'}</button></div>}
          {userError && <div role="alert" className="space-y-2 rounded-xl border border-red-200 p-4 text-sm text-red-600 dark:border-red-500/20 dark:text-red-300"><p>账户信息读取失败：{userError}</p><button type="button" onClick={() => void loadUser()} disabled={loading} className="underline">重新读取账户</button></div>}
          {statusError && <div role="alert" className="space-y-2 rounded-xl border border-red-200 p-4 text-sm text-red-600 dark:border-red-500/20 dark:text-red-300"><p>账号服务配置读取失败：{statusError}</p><button type="button" onClick={() => void loadStatus()} disabled={statusLoading} className="underline">重新加载配置</button></div>}

          <section className="rounded-xl border border-gray-100 p-4 text-sm dark:border-white/10" aria-label="充值与账务帮助">
            <p className="font-medium text-gray-800 dark:text-gray-200">充值与账务帮助</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-gray-500 dark:text-gray-400">{statusLoading ? '正在读取客服信息…' : statusError ? '客服信息暂不可用，请重新加载账号服务配置。' : supportContact || '客服联系方式暂未配置。'}</p>
            {supportContact && <div className="mt-3 flex flex-wrap items-center gap-4">
              {supportUrl && <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">打开客服链接</a>}
              <button type="button" className="text-blue-600 underline dark:text-blue-400" onClick={async () => {
                try { await copyTextToClipboard(supportContact); setSupportCopied(true) }
                catch { setError('复制失败，请手动选中并复制上方联系方式') }
              }}>{supportCopied ? '已复制联系方式' : '复制联系方式'}</button>
            </div>}
            <p className="mt-2 text-xs text-gray-400">反馈时请附用户 ID、发生时间与图片请求编号。请勿发送密码、完整兑换码或 API 密钥。</p>
          </section>

          <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-gray-100 pt-5 dark:border-white/[0.08] sm:flex-row sm:items-center">
            <p className="text-xs text-gray-400">账户凭据由光构后端安全托管</p>
            <button type="button" onClick={() => void handleLogout()} disabled={signingOut} className="rounded-xl border border-red-100 px-4 py-2.5 text-sm font-medium text-red-500 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60 dark:border-red-500/20 dark:hover:bg-red-500/10">
              {signingOut ? '正在退出…' : '退出登录'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
