import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import Account from '../Account'
import { TrialPanel } from '../TrialPanel'
import { GenerationAccessPanel } from '../GenerationAccessPanel'
import { BillingPanel } from '../loomic/components/billing-panel'
import { fetchBilling, type StudioUsage } from '../loomic/lib/billing'
import { useAuth } from '../loomic/lib/auth-context'
import './workspace-account.css'

export type WorkspaceAccountSection = 'profile' | 'billing' | 'trial' | 'access' | 'security'
const sections: { id: WorkspaceAccountSection; label: string }[] = [
  { id: 'profile', label: '账号资料' }, { id: 'billing', label: '余额与用量' },
  { id: 'trial', label: '新用户试用' }, { id: 'access', label: '生成权限' }, { id: 'security', label: '安全与会话' },
]
const Context = createContext<{ openAccount: (section?: WorkspaceAccountSection, returnFocus?: HTMLElement | null) => void } | null>(null)

// Lives outside Routes: closing the dialog and changing pages must not erase
// the existing profile/renewal components' uncertain-write barriers.
export function WorkspaceAccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [visited, setVisited] = useState(false)
  const [section, setSection] = useState<WorkspaceAccountSection>('profile')
  const [usage, setUsage] = useState<{ owner: number; value: StudioUsage }>()
  const client = useQueryClient()
  const previousOwner = useRef(user?.id)
  const returnFocus = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (previousOwner.current !== user?.id) {
      const signedInFromGuest = previousOwner.current === undefined && user !== null
      previousOwner.current = user?.id
      setSection('profile')
      if (!signedInFromGuest) setOpen(false)
    }
  }, [user?.id])
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!user || detail?.owner !== `local:${user.id}`) return
      setUsage({ owner: user.id, value: detail.usage })
      void client.invalidateQueries({ queryKey: ['billing', user.id] })
      void client.invalidateQueries({ queryKey: ['trial', user.id] })
    }
    window.addEventListener('gouo:billing-changed', refresh)
    return () => window.removeEventListener('gouo:billing-changed', refresh)
  }, [user?.id, client])
  const billing = useQuery({ queryKey: ['billing', user?.id], queryFn: ({ signal }) => fetchBilling(signal), enabled: Boolean(user) && open, retry: false, refetchOnWindowFocus: false })
  function openAccount(next: WorkspaceAccountSection = 'profile', focus?: HTMLElement | null) { returnFocus.current = focus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); setSection(next); setVisited(true); setOpen(true) }
  return <Context.Provider value={{ openAccount }}>{children}<Dialog.Root open={open} onOpenChange={setOpen}>
    {visited && <Dialog.Portal keepMounted><Dialog.Backdrop className="workspace-account-backdrop" /><Dialog.Popup className="workspace-account-dialog" finalFocus={() => returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('button[aria-label="切换侧栏"]')}>
      <header className="workspace-account-header"><Dialog.Title>账号与设置</Dialog.Title><Dialog.Close aria-label="关闭账号窗口"><XIcon size={18} /></Dialog.Close></header>
      <Dialog.Description className="workspace-account-description">账号、安全和资金由 New API 管理。画布与本机草稿请及时导出备份。</Dialog.Description>
      <div className="workspace-account-layout"><nav aria-label="账号设置分类">{sections.filter(item => user || item.id === 'profile' || item.id === 'security').map(item => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>
        <div className="workspace-account-body" key={user?.id ?? 'guest'}>
          <section hidden={section !== 'profile'} aria-label="账号资料"><Account /></section>
          {user && <>
            <section hidden={section !== 'billing'}><BillingPanel data={billing.data} error={billing.error} loading={billing.isFetching} refresh={() => { void billing.refetch() }} usage={usage?.owner === user.id ? usage.value : undefined} /></section>
            <section hidden={section !== 'trial'}><TrialPanel userId={user.id} /></section>
            <section hidden={section !== 'access'}><GenerationAccessPanel userId={user.id} /></section>
          </>}
          <section hidden={section !== 'security'} aria-label="安全与会话"><h2>安全与会话</h2><p>密码、额外验证与登录会话在 New API 原生页面管理。</p><p>生成令牌管理的是模型访问权限与有限额度，不代表钱包余额。请勿把令牌密钥粘贴到聊天或画布中。</p><div className="workspace-account-native-links"><a href="/security" target="_blank" rel="noopener noreferrer">账号安全与登录会话</a><a href="/keys" target="_blank" rel="noopener noreferrer">生成令牌与额度权限</a><a href="/profile" target="_blank" rel="noopener noreferrer">原生账号资料</a></div></section>
        </div>
      </div>
    </Dialog.Popup></Dialog.Portal>}
  </Dialog.Root></Context.Provider>
}

export function useWorkspaceAccount() {
  const value = useContext(Context)
  if (!value) throw new Error('WorkspaceAccountProvider missing')
  return value
}
