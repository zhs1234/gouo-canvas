import { useEffect, useState } from 'react'
import { downloadImageIds } from '../lib/downloadImages'
import { GUIDE_FLAGS, setGuideFlag } from '../lib/userGuidance'
import { editOutputs, useStore } from '../store'
import { CloseIcon, DownloadIcon, EditIcon, FavoriteIcon } from './icons'

export default function FirstGenerationGuide() {
  const [taskId, setTaskId] = useState<string | null>(null)
  const task = useStore((s) => s.tasks.find((item) => item.id === taskId) ?? null)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const showToast = useStore((s) => s.showToast)

  useEffect(() => {
    const handleComplete = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      setGuideFlag(GUIDE_FLAGS.firstGeneration)
      setTaskId(id)
    }
    window.addEventListener('gouo:first-generation-complete', handleComplete)
    return () => window.removeEventListener('gouo:first-generation-complete', handleComplete)
  }, [])

  if (!taskId || !task) return null

  const close = () => setTaskId(null)

  return (
    <div data-no-drag-select className="fixed bottom-[calc(var(--input-bar-clearance,7rem)+1rem)] left-1/2 z-[70] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-2xl shadow-blue-950/15 backdrop-blur-xl dark:border-blue-500/20 dark:bg-gray-950/95 sm:p-5">
      <button type="button" onClick={close} className="absolute right-3 top-3 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]" aria-label="关闭生成后引导"><CloseIcon className="h-4 w-4" /></button>
      <p className="text-xs font-bold tracking-[0.15em] text-blue-600">第一张作品已完成</p>
      <h3 className="mt-1 text-lg font-bold text-gray-950 dark:text-white">接下来想怎么处理？</h3>
      <p className="mt-1 text-xs text-gray-500">作品已经保存并开始同步，你可以下载、收藏，或把输出作为参考图继续编辑。</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => void downloadImageIds(task.outputImages, 'gouo-first-work').then((result) => { showToast(result.failCount ? '部分图片下载失败，请稍后重试' : '图片已下载', result.failCount ? 'error' : 'success'); if (!result.failCount) close() })} className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-2 py-2.5 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:text-gray-300"><DownloadIcon className="h-4 w-4" />下载</button>
        <button type="button" onClick={() => { openFavoritePicker([task.id]); close() }} className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-2 py-2.5 text-xs font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:text-gray-300"><FavoriteIcon className="h-4 w-4" />收藏</button>
        <button type="button" onClick={() => { void editOutputs(task); close() }} className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-2 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"><EditIcon className="h-4 w-4" />继续编辑</button>
      </div>
    </div>
  )
}
