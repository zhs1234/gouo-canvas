import { triggerCloudSync, useCloudSyncSnapshot } from '../lib/cloudSync'

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function CloudSyncBanner() {
  const sync = useCloudSyncSnapshot()
  if (sync.status === 'idle' || sync.status === 'disabled') return null
  const usage = sync.storage && sync.storage.quota_bytes > 0
    ? sync.storage.used_bytes / sync.storage.quota_bytes
    : 0

  return (
    <div className="safe-area-x mx-auto mt-3 max-w-7xl px-4">
      <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-xs ${sync.status === 'error' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300' : usage >= 0.8 ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300' : 'border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'}`}>
        <span className={`h-2 w-2 rounded-full ${sync.status === 'syncing' ? 'animate-pulse bg-blue-500' : sync.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
        <span className="font-medium">{sync.phase}</span>
        {sync.total > 0 && <span>{sync.completed}/{sync.total}</span>}
        {sync.storage && <span className="opacity-75">云端空间 {formatBytes(sync.storage.used_bytes)} / {formatBytes(sync.storage.quota_bytes)}</span>}
        {sync.error && <span className="min-w-0 flex-1 truncate opacity-80">{sync.error}</span>}
        {sync.status === 'error' && (
          <button type="button" onClick={() => void triggerCloudSync()} className="ml-auto rounded-lg border border-current/20 px-2.5 py-1 font-medium hover:bg-white/40 dark:hover:bg-white/5">重试</button>
        )}
      </div>
    </div>
  )
}
