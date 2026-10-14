import { useCallback, useEffect, useRef, useState } from 'react'
import { getImageCharges, type GouoImageCharge } from '../lib/gouoBackend'
import { createLatestRequest } from '../lib/latestRequest'
import { formatPoints } from '../lib/accountUsage'
import { copyTextToClipboard } from '../lib/clipboard'

// 已结算、已退款的请求会出现在积分明细里，这里只列需要用户留意的
const PENDING_STATUSES = ['needs_review', 'dispatched', 'reserved'] as const
const labels = { reserved: '已预扣，尚未发送', dispatched: '生成中', needs_review: '结果待核对', settled: '已结算', refunded: '已退款' }

export default function ImageBillingRecords() {
  const request = useRef(createLatestRequest())
  const [rows, setRows] = useState<GouoImageCharge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setRows([])
    await request.current.run(
      () => Promise.all(PENDING_STATUSES.map((status) => getImageCharges(1, status))),
      (results) => setRows(results.flatMap((result) => result.data || []).sort((a, b) => b.created_at - a.created_at)),
      (err) => setError(err instanceof Error ? err.message : String(err)),
      () => setLoading(false),
    )
  }, [])
  useEffect(() => {
    void load()
    const current = request.current
    return () => current.invalidate()
  }, [load])

  if (!error && !rows.length) return null
  const reviewing = rows.some((row) => row.status === 'needs_review')

  return (
    <section className="border-b border-amber-100 bg-amber-50/60 px-5 py-4 dark:border-amber-500/15 dark:bg-amber-500/[0.06]" aria-label="待处理的图片请求">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{error ? '图片请求状态读取失败' : `${rows.length} 个图片请求待处理`}</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="text-xs text-amber-700 underline-offset-2 hover:underline disabled:opacity-40 dark:text-amber-300">{loading ? '读取中…' : '刷新'}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows.length > 0 && <div className="mt-2 divide-y divide-amber-100 dark:divide-amber-500/10">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
            <strong className={row.status === 'needs_review' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-gray-300'}>{labels[row.status] || row.status}</strong>
            <span className="text-gray-600 dark:text-gray-400">{row.model_name} · {formatPoints(row.price_cny)}/张</span>
            <span className="text-gray-400">{new Date(row.created_at * 1000).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <button type="button" title={`复制请求编号 ${row.id}`} onClick={() => void copyTextToClipboard(row.id).then(() => setCopiedId(row.id)).catch(() => {})} className="ml-auto max-w-[45%] truncate font-mono text-gray-500 hover:text-blue-600 dark:text-gray-400">{copiedId === row.id ? '已复制编号' : row.id}</button>
            {row.note && <p className="w-full text-gray-500 dark:text-gray-400">{row.note}</p>}
          </div>
        ))}
      </div>}
      {!error && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{reviewing ? '结果待核对：点请求编号复制后发给客服核对，确认前不要重复提交。' : ''}中断且尚未发送的预扣约 20 分钟后自动退回；重新提交会创建新的付费请求。</p>}
    </section>
  )
}
