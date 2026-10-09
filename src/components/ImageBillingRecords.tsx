import { useCallback, useEffect, useRef, useState } from 'react'
import { getImageCharges, type GouoImageCharge } from '../lib/gouoBackend'
import { createLatestRequest } from '../lib/latestRequest'

const labels = { reserved: '已预扣，尚未发送', dispatched: '生成中，已预扣', needs_review: '结果待核对', settled: '已结算', refunded: '已退款' }

export default function ImageBillingRecords() {
  const request = useRef(createLatestRequest())
  const [rows, setRows] = useState<GouoImageCharge[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setRows([])
    await request.current.run(() => getImageCharges(page), (result) => {
      setRows(result.data || [])
      setTotal(result.total_count)
    }, (err) => setError(err instanceof Error ? err.message : String(err)), () => setLoading(false))
  }, [page])
  useEffect(() => {
    void load()
    const current = request.current
    return () => current.invalidate()
  }, [load])

  return (
    <details className="border-b border-gray-100 px-5 py-4 dark:border-white/10" open>
      <summary className="cursor-pointer text-sm font-semibold">图片请求状态</summary>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">中断且尚未发送的预扣会在约 20 分钟后自动恢复。结果待核对时，请将请求编号交给管理员核对渠道记录，确认后再重试。每次重新提交都会创建新的付费请求。</p>
      <div className="mt-3 flex justify-end"><button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 dark:border-white/10">{loading ? '读取中…' : '刷新请求状态'}</button></div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows.map((row) => (
        <div key={row.id} className="mt-3 rounded-xl bg-gray-50 p-3 text-xs dark:bg-white/[0.04]">
          <div className="flex flex-wrap justify-between gap-2"><span>{row.model_name} · ¥{row.price_cny}</span><strong className={row.status === 'needs_review' ? 'text-amber-700 dark:text-amber-400' : ''}>{labels[row.status] || row.status}</strong></div>
          <p className="mt-1 break-all font-mono">请求编号：{row.id}</p>
          <p className="mt-1 text-gray-500 dark:text-gray-400">{new Date(row.created_at * 1000).toLocaleString('zh-CN')}{row.note ? ` · ${row.note}` : ''}</p>
        </div>
      ))}
      {!loading && !error && !rows.length && <p className="mt-3 text-xs text-gray-500">暂无图片请求记录</p>}
      <div className="mt-3 flex items-center justify-between text-xs">
        <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="disabled:opacity-35">上一页请求</button>
        <span>{error ? '分页信息不可用' : `${page} / ${Math.max(1, Math.ceil(total / 20))}`}</span>
        <button type="button" disabled={page * 20 >= total || loading || Boolean(error)} onClick={() => setPage(page + 1)} className="disabled:opacity-35">下一页请求</button>
      </div>
    </details>
  )
}
