import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getBackendStatus, getCloudStorage, getCurrentUser, type GouoCloudStorage, type GouoUser } from '../lib/gouoBackend'
import type { UserCenterSection } from '../lib/userGuidance'
import { importLocalTasks } from '../lib/serverLibrary'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, RefreshIcon } from './icons'
import { formatPoints } from '../lib/accountUsage'
import { createLatestRequest } from '../lib/latestRequest'
import AccountSection from './userCenter/AccountSection'
import TopupSection from './userCenter/TopupSection'
import UsageLogsSection from './userCenter/UsageLogsSection'

// 充值页的客服信息和账户页的邮件、人机验证都来自后端状态，由弹窗统一读取
export interface UserCenterServiceStatus {
  emailService: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
  redemptionHelp: string
  supportContact: string
  loading: boolean
  error: string
  reload: () => void
}

interface UserCenterModalProps {
  initialSection?: UserCenterSection
  onClose: () => void
}

const SECTIONS: Array<{ id: UserCenterSection; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'topup', label: '充值' },
  { id: 'logs', label: '使用记录' },
  { id: 'security', label: '账户与安全' },
]

function formatDate(timestamp?: number) {
  if (!timestamp) return '暂无记录'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function UserCenterModal({ initialSection = 'overview', onClose }: UserCenterModalProps) {
  const scrollBoundaryRef = useRef<HTMLDivElement>(null)
  const userRequest = useRef(createLatestRequest())
  const statusRequest = useRef(createLatestRequest())
  const [user, setUser] = useState<GouoUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [userError, setUserError] = useState('')
  const [activeSection, setActiveSection] = useState<UserCenterSection>(initialSection)
  const [status, setStatus] = useState({ emailService: false, turnstileEnabled: false, turnstileSiteKey: '', redemptionHelp: '', supportContact: '' })
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState('')
  const [storage, setStorage] = useState<GouoCloudStorage | null>(null)
  const [importing, setImporting] = useState('')

  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, scrollBoundaryRef)

  const loadUser = useCallback(async () => {
    setLoading(true)
    setUserError('')
    await userRequest.current.run(getCurrentUser, setUser, (err) => setUserError(err instanceof Error ? err.message : String(err)), () => setLoading(false))
  }, [])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError('')
    await statusRequest.current.run(getBackendStatus, (value) => setStatus({
      emailService: Boolean(value.email_service),
      turnstileEnabled: Boolean(value.turnstile_check),
      turnstileSiteKey: value.turnstile_site_key ?? '',
      redemptionHelp: typeof value.gouo_redemption_help === 'string' ? value.gouo_redemption_help : '',
      supportContact: typeof value.gouo_support_contact === 'string' ? value.gouo_support_contact : '',
    }), (err) => setStatusError(err instanceof Error ? err.message : String(err)), () => setStatusLoading(false))
  }, [])

  useEffect(() => {
    void loadUser()
    void loadStatus()
    getCloudStorage().then(setStorage).catch(() => setStorage(null))
    const requests = [userRequest.current, statusRequest.current]
    return () => { for (const request of requests) request.invalidate() }
  }, [loadUser, loadStatus])

  const handleImportLocal = async () => {
    setImporting('正在检查本机作品…')
    try {
      const result = await importLocalTasks((done, total) => setImporting(`正在导入 ${done}/${total}`))
      const showToast = useStore.getState().showToast
      if (!result.total) showToast('本机没有需要导入的作品', 'info')
      else showToast(result.failed ? `已导入 ${result.total - result.failed} 个作品，${result.failed} 个失败，可稍后重试` : `已导入 ${result.total} 个作品`, result.failed ? 'error' : 'success')
      setStorage(await getCloudStorage())
    } catch (err) {
      useStore.getState().showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setImporting('')
    }
  }

  const serviceStatus: UserCenterServiceStatus = { ...status, loading: statusLoading, error: statusError, reload: () => void loadStatus() }
  const avatarText = (user?.display_name || user?.username || '光').trim().slice(0, 1).toUpperCase()

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-gray-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={scrollBoundaryRef} role="dialog" aria-modal="true" aria-label="用户中心" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-950 sm:h-[min(640px,88dvh)] sm:max-w-3xl sm:rounded-[28px]">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-6 pt-5 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95 sm:px-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">用户中心</h2>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200" aria-label="关闭用户中心">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <div role="tablist" aria-label="用户中心分区" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
            {SECTIONS.map((section) => (
              <button key={section.id} type="button" role="tab" aria-selected={activeSection === section.id} onClick={() => setActiveSection(section.id)} className={`shrink-0 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeSection === section.id ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
                {section.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 sm:p-8">
          {!user ? (
            userError ? (
              <div role="alert" className="space-y-2 rounded-xl border border-red-200 p-4 text-sm text-red-600 dark:border-red-500/20 dark:text-red-300"><p>账户信息读取失败：{userError}</p><button type="button" onClick={() => void loadUser()} disabled={loading} className="underline">重新读取账户</button></div>
            ) : (
              <div className="flex min-h-60 items-center justify-center text-sm text-gray-400">正在读取账户信息…</div>
            )
          ) : activeSection === 'topup' ? (
            <TopupSection user={user} status={serviceStatus} onRedeemed={loadUser} />
          ) : activeSection === 'logs' ? (
            <UsageLogsSection user={user} />
          ) : activeSection === 'security' ? (
            <AccountSection user={user} status={serviceStatus} onUserChanged={loadUser} />
          ) : (
            <div className="space-y-4">
              <section className="flex flex-col gap-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 dark:border-white/[0.08] dark:bg-white/[0.03] sm:flex-row sm:items-center">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-2xl font-bold text-white shadow-lg shadow-blue-500/20">
                  {user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : avatarText}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-xl font-semibold text-gray-900 dark:text-white">{user.display_name || user.username}</h3>
                  <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">@{user.username}{user.email ? ` · ${user.email}` : ''}</p>
                  <p className="mt-2 text-xs text-gray-400">用户 ID {user.id} · 累计请求 {user.request_count?.toLocaleString('zh-CN') ?? '—'} 次 · 加入于 {formatDate(user.created_time)}</p>
                </div>
                <button type="button" onClick={() => void loadUser()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
                  <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </section>
              {userError && <div role="alert" className="text-sm text-red-600 dark:text-red-400">刷新失败：{userError}</div>}

              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 p-5 text-white shadow-lg shadow-blue-500/15">
                  <p className="text-sm text-white/70">账户余额</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight">{formatPoints(user.balance_cny)}</p>
                  {typeof user.balance_cny === 'number' && Number.isFinite(user.balance_cny)
                    ? <button type="button" onClick={() => setActiveSection('topup')} className="mt-2 text-xs font-medium text-white/80 underline-offset-2 hover:text-white hover:underline">去充值 →</button>
                    : <p className="mt-1 text-xs text-white/55">余额暂不可用，请刷新账户</p>}
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">累计消费</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{formatPoints(user.used_cny)}</p>
                  <button type="button" onClick={() => setActiveSection('logs')} className="mt-2 text-xs font-medium text-blue-500 hover:text-blue-600">查看明细 →</button>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <p className="text-sm text-gray-500 dark:text-gray-400">云端空间</p>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{storage?.enabled === false ? '未开启' : storage?.enabled ? `${(storage.used_bytes / 1024 ** 2).toFixed(0)} MB` : '—'}</p>
                  <p className="mt-1 text-xs text-gray-400">{storage?.enabled === false ? '作品保存在当前浏览器' : storage?.enabled ? `共 ${(storage.quota_bytes / 1024 ** 3).toFixed(0)} GB` : '存储状态暂不可用'}</p>
                  {storage?.enabled && (
                    <button type="button" disabled={Boolean(importing)} onClick={() => void handleImportLocal()} className="mt-2 text-xs font-medium text-blue-500 hover:text-blue-600 disabled:opacity-60">
                      {importing || '导入本机旧作品'}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
