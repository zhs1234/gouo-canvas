import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { UserRound, X, Check, HardDrive } from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import Account from '../../Account'
import { useToast } from './toast'
import { saveCanvas } from '../lib/server-api'
import { fetchCatalog, type GatewayCatalog } from '../lib/gateway'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBilling, money, type StudioUsage } from '../lib/billing'
import { BillingPanel } from './billing-panel'
export function AccountMenu({ owner, canvasId, api }: { owner: string; canvasId: string; api: any }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<GatewayCatalog | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()
  const queryClient = useQueryClient()
  const billing = useQuery({ queryKey: ['billing', user?.id], queryFn: ({ signal }) => fetchBilling(signal), enabled: Boolean(user), staleTime: 30_000, retry: false, refetchOnWindowFocus: false })
  const [usage, setUsage] = useState<StudioUsage>()
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.owner !== `local:${user?.id}`) return
      setUsage(detail.usage)
      void queryClient.invalidateQueries({ queryKey: ['billing', user?.id] })
    }
    window.addEventListener('gouo:billing-changed', refresh)
    return () => window.removeEventListener('gouo:billing-changed', refresh)
  }, [user?.id, queryClient])
  useEffect(() => {
    const fail = () => { setSaved(false); toast.error('本地保存失败，请导出画布备份') }
    const done = () => setSaved(true)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('gouo:draft-save-failed', fail); window.addEventListener('gouo:draft-saved', done); window.addEventListener('keydown', key)
    return () => { window.removeEventListener('gouo:draft-save-failed', fail); window.removeEventListener('gouo:draft-saved', done); window.removeEventListener('keydown', key) }
  }, [toast])
  useEffect(() => { if (open) fetchCatalog().then(setCatalog).catch(e => setError(e.message)) }, [open])
  async function save() {
    if (!api || saving) return
    setSaving(true)
    try {
      const state = api.getAppState()
      await saveCanvas(owner, canvasId, { elements: api.getSceneElements().filter((e: any) => !e.isDeleted), appState: { viewBackgroundColor: state.viewBackgroundColor, gridModeEnabled: state.gridModeEnabled, scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom }, files: api.getFiles() })
      toast.success('已保存在当前浏览器')
    } catch { setSaved(false); toast.error('保存失败，请导出画布备份') }
    finally { setSaving(false) }
  }
  return <>
    <div className="flex items-center gap-2">
      <button type="button" onClick={save} disabled={!api || saving} title="保存到当前浏览器" className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 text-xs text-muted-foreground shadow-sm hover:bg-muted disabled:opacity-50">
        {saved ? <Check className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}{saving ? '正在保存…' : '本地保存'}
      </button>
      <button type="button" aria-label="New API 账号" onClick={() => setOpen(true)} className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs shadow-sm hover:bg-muted"><UserRound className="h-4 w-4" />{user?.display_name || user?.username || '登录'}{billing.data && <span className="text-muted-foreground" aria-label="账户余额">{money(billing.data.balance)}</span>}</button>
    </div>
    {open && createPortal(<div className="account-overlay" role="presentation" onClick={() => setOpen(false)}><div className="account-dialog" role="dialog" aria-modal="true" aria-label="New API 账号" onClick={e => e.stopPropagation()}>
      <button className="account-close" type="button" aria-label="关闭账号窗口" onClick={() => setOpen(false)}><X size={18} /></button>
      <Account />
      {user && <BillingPanel data={billing.data} error={billing.error} loading={billing.isFetching} refresh={() => { void billing.refetch() }} usage={usage} />}
      <div className="gateway-status"><p>模型连接</p>{error ? <p role="alert">{error}</p> : catalog ? <p>{catalog.models.filter(m => m.accessible).length ? `可用模型：${catalog.models.filter(m => m.accessible).map(m => m.displayName).join('、')}` : '尚未配置可用的生成模型'}</p> : <p>正在检查连接…</p>}<p>画布和对话保存在当前浏览器，请及时导出备份。</p></div>
    </div></div>, document.body)}
  </>
}
