import { useEffect, useState } from 'react'
import { getImageModels, type GouoImageModel } from '../lib/gouoBackend'
import { useStore } from '../store'

export default function BackendModelSelector({ onReady }: { onReady: (ready: boolean) => void }) {
  const settings = useStore((s) => s.settings)
  const params = useStore((s) => s.params)
  const inputCount = useStore((s) => s.inputImages.length)
  const hasMask = useStore((s) => Boolean(s.maskDraft))
  const [models, setModels] = useState<GouoImageModel[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      setLoading(true)
      try {
        const data = await getImageModels()
        if (cancelled) return
        setModels(data)
        setError('')
        const selected = data.find((entry) => entry.id === useStore.getState().settings.model)
        useStore.getState().setSettings({ gouoPriceVersion: selected?.price_version })
      } catch (err) {
        if (cancelled) return
        console.warn('读取图片模型目录失败', err)
        setError(err instanceof Error ? err.message : String(err))
        setModels([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void refresh()
    window.addEventListener('gouo-models-refresh', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('gouo-models-refresh', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const selected = models.find((entry) => entry.id === settings.model)
  const reason = loading ? '正在加载模型' : error || (!selected ? '所选模型不可用，请重新选择' : (inputCount > 0 && !selected.reference) || (hasMask && !selected.mask) ? '此模型不支持当前编辑操作' : params.n > selected.max_outputs ? `此模型最多支持 ${selected.max_outputs} 张图片` : '')
  useEffect(() => { onReady(!reason) }, [reason, onReady])

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-xs">
      <label className="flex min-w-0 items-center gap-2 text-gray-600 dark:text-gray-300">
        模型
        <select
          aria-label="图片模型"
          value={selected ? settings.model : ''}
          disabled={loading}
          onChange={(event) => {
            const model = models.find((entry) => entry.id === event.target.value)
            if (model) useStore.getState().setSettings({ model: model.id, gouoModelSelected: true, gouoPriceVersion: model.price_version })
          }}
          className="max-w-[260px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-400 dark:border-white/10 dark:bg-gray-800"
        >
          {!selected && <option value="">{loading ? '正在加载…' : '请选择模型'}</option>}
          {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · ¥{entry.price_cny}/次</option>)}
        </select>
      </label>
      {reason ? <span role="status" className="text-amber-600 dark:text-amber-400">{reason}</span> : selected && <span className="text-gray-400">预计扣费 ¥{selected.price_cny}/次 · 本次 {params.n} 张收一次 · 服务端确认失败退款，中断请核对账务</span>}
      <button type="button" disabled={loading} onClick={() => window.dispatchEvent(new Event('gouo-models-refresh'))} className="rounded px-1.5 py-1 text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-blue-400">刷新模型</button>
    </div>
  )
}
