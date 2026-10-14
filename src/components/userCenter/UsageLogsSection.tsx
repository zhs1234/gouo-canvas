import { useCallback, useEffect, useRef, useState } from 'react'
import type { GouoUsageLog, GouoUser } from '../../lib/gouoBackend'
import { getUsageLogs } from '../../lib/gouoBackend'
import { formatPoints, getLogContent, getUsageDisplay, toPoints } from '../../lib/accountUsage'
import { createLatestRequest } from '../../lib/latestRequest'
import { RefreshIcon } from '../icons'

const PAGE_SIZE = 10

const LOG_TYPES = [
  { value: 0, label: '全部' },
  { value: 2, label: '消费' },
  { value: 1, label: '充值' },
  { value: 3, label: '调整' },
]

// 按天分组的标题：今天、昨天，其余显示日期和星期
function formatDay(date: Date) {
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return '今天'
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false })
}

export default function UsageLogsSection({ user }: { user: GouoUser }) {
  const request = useRef(createLatestRequest())
  const [logs, setLogs] = useState<GouoUsageLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [model, setModel] = useState('')
  const [type, setType] = useState(0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const rate = user.quota_cny_rate
  const activeFilters = [model.trim(), start, end].filter(Boolean).length

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError('')
    setLogs([])
    await request.current.run(() => getUsageLogs(page, PAGE_SIZE, {
      model: model.trim() || undefined,
      type: type || undefined,
      start: start ? Math.floor(new Date(`${start}T00:00:00`).getTime() / 1000) : undefined,
      end: end ? Math.floor(new Date(`${end}T23:59:59`).getTime() / 1000) : undefined,
    }), (result) => {
      setLogs(result.data)
      setTotal(result.total_count)
    }, (err) => setError(err instanceof Error ? err.message : String(err)), () => setLoading(false))
  }, [end, model, start, type, page])

  useEffect(() => {
    void loadLogs()
    const current = request.current
    return () => current.invalidate()
  }, [loadLogs])

  const exportLogs = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    // 原始额度按当前兑换率折合成积分，不让用户看到内部额度单位
    const points = (quota: unknown) => typeof quota === 'number' && typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? toPoints(quota * rate) : ''
    const rows = [
      ['时间', '类型', '模型', '积分', '计费单位', '单价（积分）', '实际扣费（积分）', '退款（积分）', '耗时', 'Request ID', '内容'],
      ...logs.map((log) => {
        const display = getUsageDisplay(log, rate)
        return [formatTime(log.created_at), display.label, log.model_name || '', display.delta === null ? '积分不可用' : toPoints(display.delta), display.unit, typeof log.metadata?.price_cny === 'number' ? toPoints(log.metadata.price_cny) : '', points(log.metadata?.charged_quota ?? (log.type === 2 ? log.quota : undefined)), log.metadata?.billing_status === 'refunded' ? points(log.quota) : '', log.request_time ?? '', log.metadata?.request_id || log.metadata?.requestId || '', getLogContent(log)]
      }),
    ]
    const blob = new Blob([`﻿${rows.map((row) => row.map(escape).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gouo-usage-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">积分明细</p>
          <p className="mt-1 text-xs text-gray-400">{loading ? '正在读取记录' : error ? '记录读取失败' : `共 ${total.toLocaleString('zh-CN')} 条记录，每页 ${PAGE_SIZE} 条`}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportLogs} disabled={loading || Boolean(error) || !logs.length} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-40 dark:border-white/10">导出本页 CSV</button>
          <button type="button" onClick={() => void loadLogs()} disabled={loading} className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-blue-500 disabled:cursor-wait dark:hover:bg-white/[0.06]" aria-label="刷新使用记录">
            <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08]">
        {LOG_TYPES.map((item) => (
          <button key={item.value} type="button" aria-pressed={type === item.value} onClick={() => { setType(item.value); setPage(1) }} className={`rounded-full px-3 py-1 text-xs transition ${type === item.value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'}`}>{item.label}</button>
        ))}
        <button type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)} className="ml-auto text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400">筛选{activeFilters ? ` · ${activeFilters}` : ''} {showFilters ? '▴' : '▾'}</button>
        {showFilters && <div className="grid w-full gap-2 pt-1 sm:grid-cols-3">
          <input value={model} onChange={(event) => { setModel(event.target.value); setPage(1) }} placeholder="按模型筛选" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-white/[0.04]" />
          <input type="date" value={start} max={end || undefined} onChange={(event) => { setStart(event.target.value); setPage(1) }} aria-label="开始日期" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-gray-900" />
          <input type="date" value={end} min={start || undefined} onChange={(event) => { setEnd(event.target.value); setPage(1) }} aria-label="结束日期" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/10 dark:bg-gray-900" />
        </div>}
      </div>
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-400">正在读取使用记录…</div>
      ) : error ? (
        <div role="alert" className="space-y-3 px-5 py-8 text-sm text-red-600 dark:text-red-400"><p>{error}</p><button type="button" onClick={() => void loadLogs()} className="underline">重新读取使用记录</button></div>
      ) : logs.length ? (
        <div>
          {logs.map((log, index) => {
            const display = getUsageDisplay(log, rate)
            const requestId = log.metadata?.request_id || log.metadata?.requestId
            const content = getLogContent(log)
            const date = new Date(log.created_at * 1000)
            const day = formatDay(date)
            const showDay = index === 0 || formatDay(new Date(logs[index - 1].created_at * 1000)) !== day
            const hasDetail = Boolean(content || requestId || log.metadata?.billing_unit === 'successful_request' || log.request_time)
            const summary = <>
              <span className="shrink-0 text-sm text-gray-800 dark:text-gray-200">{display.label}</span>
              {log.model_name && <span className="min-w-0 truncate text-xs text-gray-400">{log.model_name}</span>}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-gray-400">{date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`w-20 shrink-0 text-right text-sm font-semibold tabular-nums ${(display.delta ?? 0) > 0 ? 'text-emerald-500' : 'text-gray-700 dark:text-gray-300'}`}>{display.amountText}</span>
            </>
            return (
              <div key={`${log.created_at}-${index}`}>
                {showDay && <p className="bg-gray-50 px-5 py-1.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">{day}</p>}
                {hasDetail ? (
                  <details className="group border-b border-gray-50 last:border-0 dark:border-white/[0.04]">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.03] [&::-webkit-details-marker]:hidden">{summary}</summary>
                    <div className="space-y-1 px-5 pb-3 text-xs text-gray-500 dark:text-gray-400">
                      {content && <p className="break-words">{content}</p>}
                      {log.metadata?.billing_unit === 'successful_request' && <p>单价 {formatPoints(Number(log.metadata.price_cny))}/张</p>}
                      {Boolean(requestId) && <p className="break-all font-mono">Request ID: {String(requestId)}</p>}
                      {log.request_time ? <p>耗时 {(log.request_time / 1000).toFixed(1)} 秒</p> : null}
                    </div>
                  </details>
                ) : (
                  <div className="flex items-center gap-3 border-b border-gray-50 px-5 py-2.5 last:border-0 dark:border-white/[0.04]">{summary}</div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="py-10 text-center text-sm text-gray-400">暂无使用记录</div>
      )}
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-xs dark:border-white/[0.08]">
        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-35 dark:border-white/10">上一页</button>
        <span className="text-gray-400">{error ? '分页信息不可用' : `第 ${page} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))} 页`}</span>
        <button type="button" disabled={page * PAGE_SIZE >= total || loading || Boolean(error)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-35 dark:border-white/10">下一页</button>
      </div>
    </section>
  )
}
