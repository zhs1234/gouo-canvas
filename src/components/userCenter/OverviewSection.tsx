import { useEffect, useState } from 'react'
import { getCachedImageModels, getCloudStorage, getImageModels, getImagePrice, getUsageLogs, getUsageStat, type GouoCloudStorage, type GouoImageModel, type GouoUsageLog, type GouoUser } from '../../lib/gouoBackend'
import type { UserCenterSection } from '../../lib/userGuidance'
import { formatPoints, getUsageDisplay } from '../../lib/accountUsage'
import { formatBytes } from '../../lib/canvas/imageStorage'
import { importLocalTasks } from '../../lib/serverLibrary'
import { useStore } from '../../store'
import { RefreshIcon } from '../icons'

function formatDate(timestamp?: number) {
  if (!timestamp) return '暂无记录'
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function OverviewSection({ user, loading, error, onRefresh, onNavigate, onClose }: { user: GouoUser; loading: boolean; error: string; onRefresh: () => void; onNavigate: (section: UserCenterSection) => void; onClose: () => void }) {
  const selectedModel = useStore((state) => state.settings.model)
  const [storage, setStorage] = useState<GouoCloudStorage | null>(null)
  const [importing, setImporting] = useState('')
  const [monthQuota, setMonthQuota] = useState<number | null>(null)
  const [recent, setRecent] = useState<GouoUsageLog[] | null>(null)
  const [models, setModels] = useState<GouoImageModel[]>(getCachedImageModels)

  useEffect(() => {
    const now = new Date()
    getCloudStorage().then(setStorage).catch(() => setStorage(null))
    getUsageStat(Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)).then((stat) => setMonthQuota(stat.quota)).catch(() => setMonthQuota(null))
    getUsageLogs(1, 5).then((page) => setRecent(page.data)).catch(() => setRecent([]))
    if (!getCachedImageModels().length) getImageModels().then(setModels).catch(() => {})
  }, [])

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

  const rate = user.quota_cny_rate
  const balanceKnown = typeof user.balance_cny === 'number' && Number.isFinite(user.balance_cny)
  // 按当前选择的图片模型在自动尺寸、自动画质下的单张价估算还能生成几张；尺寸和画质不同价格不同，只作参考
  const model = models.find((item) => item.id === selectedModel) ?? models.find((item) => item.default) ?? models[0]
  const unitPrice = model ? getImagePrice(model, {}) : 0
  const affordable = balanceKnown && unitPrice ? Math.floor(user.balance_cny! / unitPrice) : null
  const usedPercent = storage?.enabled && storage.quota_bytes > 0 ? Math.min(100, (storage.used_bytes / storage.quota_bytes) * 100) : 0
  const avatarText = (user.display_name || user.username || '光').trim().slice(0, 1).toUpperCase()

  return <div className="space-y-4">
    <section className="flex items-center gap-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-xl font-bold text-white">
        {user.avatar_url ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" /> : avatarText}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{user.display_name || user.username}</h3>
        <p className="mt-0.5 truncate text-sm text-gray-500 dark:text-gray-400">@{user.username}{user.email ? ` · ${user.email}` : ''}</p>
        <p className="mt-1 text-xs text-gray-400">用户 ID {user.id} · 加入于 {formatDate(user.created_time)}</p>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading} aria-label="刷新账户" className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300">
        <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </section>
    {error && <div role="alert" className="text-sm text-red-600 dark:text-red-400">刷新失败：{error}</div>}

    <section className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 p-5 text-white shadow-lg shadow-blue-500/15">
        <p className="text-sm text-white/70">账户余额</p>
        <p className="mt-3 text-2xl font-bold tracking-tight">{formatPoints(user.balance_cny)}</p>
        <p className="mt-1 text-xs text-white/70">{!balanceKnown ? '余额暂不可用，请刷新账户' : affordable !== null && model ? `约可生成 ${affordable.toLocaleString('zh-CN')} 张 ${model.name}` : ' '}</p>
        {balanceKnown && <button type="button" onClick={() => onNavigate('topup')} className="mt-2 text-xs font-medium text-white/85 underline-offset-2 hover:text-white hover:underline">去充值 →</button>}
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">本月消费</p>
        <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{monthQuota !== null && typeof rate === 'number' ? formatPoints(monthQuota * rate) : '—'}</p>
        <p className="mt-1 text-xs text-gray-400">累计 {formatPoints(user.used_cny)}</p>
        <button type="button" onClick={() => onNavigate('logs')} className="mt-2 text-xs font-medium text-blue-500 hover:text-blue-600">查看明细 →</button>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/[0.08] dark:bg-white/[0.03]">
        <p className="text-sm text-gray-500 dark:text-gray-400">云端空间</p>
        {storage?.enabled ? <>
          <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{formatBytes(storage.used_bytes) || '0 B'}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10" role="progressbar" aria-label="云端空间用量" aria-valuenow={Math.round(usedPercent)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${usedPercent >= 90 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${usedPercent}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-400">共 {formatBytes(storage.quota_bytes)} · 回收站内容也占空间</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
            <button type="button" onClick={() => { onClose(); window.dispatchEvent(new Event('gouo:open-trash')) }} className="text-blue-500 hover:text-blue-600">回收站 →</button>
            <button type="button" disabled={Boolean(importing)} onClick={() => void handleImportLocal()} className="text-blue-500 hover:text-blue-600 disabled:opacity-60">{importing || '导入本机旧作品'}</button>
          </div>
        </> : <>
          <p className="mt-3 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{storage?.enabled === false ? '未开启' : '—'}</p>
          <p className="mt-1 text-xs text-gray-400">{storage?.enabled === false ? '作品保存在当前浏览器' : '存储状态暂不可用'}</p>
        </>}
      </div>
    </section>

    <section className="rounded-2xl border border-gray-100 dark:border-white/[0.08]">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">最近记录</h4>
        <button type="button" onClick={() => onNavigate('logs')} className="text-xs font-medium text-blue-500 hover:text-blue-600">查看全部 →</button>
      </div>
      {recent === null ? <p className="px-5 pb-4 text-sm text-gray-400">正在读取…</p> : !recent.length ? <p className="px-5 pb-4 text-sm text-gray-400">暂无记录</p> : recent.map((log, index) => {
        const display = getUsageDisplay(log, rate)
        return <div key={`${log.created_at}-${index}`} className="flex items-center gap-3 border-t border-gray-50 px-5 py-2.5 dark:border-white/[0.04]">
          <span className="shrink-0 text-sm text-gray-800 dark:text-gray-200">{display.label}</span>
          {log.model_name && <span className="min-w-0 truncate text-xs text-gray-400">{log.model_name}</span>}
          <span className="ml-auto shrink-0 text-xs tabular-nums text-gray-400">{new Date(log.created_at * 1000).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span className={`w-24 shrink-0 text-right text-sm font-semibold tabular-nums ${(display.delta ?? 0) > 0 ? 'text-emerald-500' : 'text-gray-700 dark:text-gray-300'}`}>{display.amountText}</span>
        </div>
      })}
    </section>
  </div>
}
