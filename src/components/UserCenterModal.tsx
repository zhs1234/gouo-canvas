import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getBackendStatus, getCurrentUser, type GouoUser } from '../lib/gouoBackend'
import type { UserCenterSection } from '../lib/userGuidance'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon } from './icons'
import { createLatestRequest } from '../lib/latestRequest'
import AccountSection from './userCenter/AccountSection'
import OverviewSection from './userCenter/OverviewSection'
import TopupSection from './userCenter/TopupSection'
import UsageLogsSection from './userCenter/UsageLogsSection'

// 充值页的客服信息和账户页的邮件、人机验证都来自后端状态，由弹窗统一读取
export interface UserCenterServiceStatus {
  emailService: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
  redemptionHelp: string
  supportContact: string
  topupUrl: string
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
  { id: 'topup', label: '充值/定价' },
  { id: 'logs', label: '使用记录' },
  { id: 'security', label: '账户与安全' },
]

export default function UserCenterModal({ initialSection = 'overview', onClose }: UserCenterModalProps) {
  const scrollBoundaryRef = useRef<HTMLDivElement>(null)
  const userRequest = useRef(createLatestRequest())
  const statusRequest = useRef(createLatestRequest())
  const [user, setUser] = useState<GouoUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [userError, setUserError] = useState('')
  const [activeSection, setActiveSection] = useState<UserCenterSection>(initialSection)
  const [status, setStatus] = useState({ emailService: false, turnstileEnabled: false, turnstileSiteKey: '', redemptionHelp: '', supportContact: '', topupUrl: '' })
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState('')

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
      topupUrl: typeof value.gouo_topup_url === 'string' ? value.gouo_topup_url : '',
    }), (err) => setStatusError(err instanceof Error ? err.message : String(err)), () => setStatusLoading(false))
  }, [])

  useEffect(() => {
    void loadUser()
    void loadStatus()
    const requests = [userRequest.current, statusRequest.current]
    return () => { for (const request of requests) request.invalidate() }
  }, [loadUser, loadStatus])

  const serviceStatus: UserCenterServiceStatus = { ...status, loading: statusLoading, error: statusError, reload: () => void loadStatus() }

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
            <OverviewSection user={user} loading={loading} error={userError} onRefresh={() => void loadUser()} onNavigate={setActiveSection} onClose={onClose} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
