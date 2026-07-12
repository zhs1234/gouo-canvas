import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCurrentUser, getUsageLogs, logout, redeemCode, updateCurrentUser, type GouoUsageLog, type GouoUser } from '../lib/gouoBackend'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, RefreshIcon, UserIcon } from './icons'

interface UserCenterModalProps {
  onClose: () => void
}

function formatQuota(value?: number) {
  return Math.max(0, value ?? 0).toLocaleString('zh-CN')
}

function formatCNY(value?: number) {
  return `¥${Math.max(0, value ?? 0).toFixed(2)}`
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

function getLogLabel(type: number) {
  if (type === 1) return '额度充值'
  if (type === 2) return '图片生成'
  if (type === 3) return '额度调整'
  return '账户记录'
}

export default function UserCenterModal({ onClose }: UserCenterModalProps) {
  const scrollBoundaryRef = useRef<HTMLDivElement>(null)
  const [user, setUser] = useState<GouoUser | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [activeSection, setActiveSection] = useState<'overview' | 'topup' | 'logs'>('overview')
  const [redemptionCode, setRedemptionCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMessage, setRedeemMessage] = useState('')
  const [logs, setLogs] = useState<GouoUsageLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [error, setError] = useState('')

  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, scrollBoundaryRef)

  const loadUser = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const currentUser = await getCurrentUser()
      setUser(currentUser)
      setDisplayName(currentUser.display_name ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUser()
  }, [loadUser])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    setError('')
    try {
      const result = await getUsageLogs()
      setLogs(result.data)
    } catch (logsError) {
      setError(logsError instanceof Error ? logsError.message : String(logsError))
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeSection === 'logs') void loadLogs()
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
      setRedeemMessage(`充值成功，已增加 ${formatCNY(quota * (user?.quota_cny_rate ?? 0))}`)
      await loadUser()
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : String(redeemError))
    } finally {
      setRedeeming(false)
    }
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
                  <p className="mt-2 text-xs text-gray-400">用户 ID {user.id} · 累计生成 {(user.request_count ?? 0).toLocaleString('zh-CN')} 次 · 加入于 {formatDate(user.created_time)}</p>
                </div>
                <button type="button" onClick={() => void loadUser()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
                  <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </section>

              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 p-5 text-white shadow-lg shadow-blue-500/15">
                  <p className="text-sm text-white/70">账户余额</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight">{formatCNY(user.balance_cny)}</p>
                  <p className="mt-1 text-xs text-white/55">人民币余额</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">累计消费</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{formatCNY(user.used_cny)}</p>
                  <p className="mt-1 text-xs text-gray-400">历史累计图片消费</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">图片单价</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{formatCNY(user.image_price_cny)}</p>
                  <p className="mt-1 text-xs text-gray-400">每次成功生成或编辑</p>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
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
              </section>

              {activeSection === 'topup' && (
                <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/60 p-5 dark:border-blue-500/15 dark:from-blue-500/[0.08] dark:to-blue-700/[0.04]">
                  <p className="font-semibold text-gray-900 dark:text-white">兑换码充值</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">输入从光构获得的兑换码，额度将立即充入当前账户。</p>
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
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">最近使用记录</p>
                      <p className="mt-1 text-xs text-gray-400">展示最近 10 条账户记录</p>
                    </div>
                    <button type="button" onClick={() => void loadLogs()} disabled={logsLoading} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-blue-500 disabled:cursor-wait dark:hover:bg-white/[0.06]" aria-label="刷新使用记录">
                      <RefreshIcon className={`h-4 w-4 ${logsLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  {logsLoading ? (
                    <div className="py-10 text-center text-sm text-gray-400">正在读取使用记录…</div>
                  ) : logs.length ? (
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      {logs.map((log, index) => (
                        <div key={`${log.created_at}-${index}`} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{getLogLabel(log.type)}</span>
                              {log.model_name && <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{log.model_name}</span>}
                            </div>
                            <p className="mt-1 truncate text-xs text-gray-400">{formatTime(log.created_at)}{log.content ? ` · ${log.content}` : ''}</p>
                          </div>
                          <div className="text-left sm:text-right">
                            <p className={`text-sm font-semibold ${log.type === 1 ? 'text-emerald-500' : 'text-gray-700 dark:text-gray-300'}`}>{log.type === 1 ? '+' : '-'}{formatCNY((log.quota ?? 0) * (user.quota_cny_rate ?? 0))}</p>
                            {log.request_time ? <p className="mt-1 text-xs text-gray-400">{log.request_time} ms</p> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-10 text-center text-sm text-gray-400">暂无使用记录</div>
                  )}
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
