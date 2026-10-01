import { useEffect, useState } from 'react'
import { UserRound, Check, HardDrive } from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import { useToast } from './toast'
import { saveCanvas } from '../lib/server-api'
import { useWorkspaceAccount } from '../../workspace/WorkspaceAccountProvider'

export function AccountMenu({ owner, canvasId, api }: { owner: string; canvasId: string; api: any }) {
  const { user } = useAuth()
  const { openAccount } = useWorkspaceAccount()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  useEffect(() => {
    const fail = () => { setSaved(false); toast.error('本地保存失败，请导出画布备份') }
    const done = () => setSaved(true)
    window.addEventListener('gouo:draft-save-failed', fail); window.addEventListener('gouo:draft-saved', done)
    return () => { window.removeEventListener('gouo:draft-save-failed', fail); window.removeEventListener('gouo:draft-saved', done) }
  }, [toast])
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
  return <div className="flex items-center gap-2">
    <button type="button" onClick={save} disabled={!api || saving} title="保存到当前浏览器" className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 text-xs text-muted-foreground shadow-sm hover:bg-muted disabled:opacity-50">
      {saved ? <Check className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}{saving ? '正在保存…' : '本地保存'}
    </button>
    <button type="button" aria-label="打开账号设置" onClick={() => openAccount()} className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs shadow-sm hover:bg-muted"><UserRound className="h-4 w-4" />{user?.display_name || user?.username || '登录'}</button>
  </div>
}
