import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { INSPIRATION_CATEGORIES, INSPIRATION_PROMPTS, type InspirationCategory, type InspirationPrompt } from '../lib/inspirationPrompts'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useStore } from '../store'
import { CloseIcon, CopyIcon } from './icons'

interface InspirationLibraryModalProps {
  onClose: () => void
}

export default function InspirationLibraryModal({ onClose }: InspirationLibraryModalProps) {
  const [category, setCategory] = useState<'全部' | InspirationCategory>('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<InspirationPrompt | null>(null)
  const libraryRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const setPrompt = useStore((s) => s.setPrompt)
  const showToast = useStore((s) => s.showToast)

  useCloseOnEscape(true, selected ? () => setSelected(null) : onClose)
  usePreventBackgroundScroll(true, [libraryRef, detailRef])

  const prompts = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    return INSPIRATION_PROMPTS.filter((item) => {
      if (category !== '全部' && item.category !== category) return false
      if (!keyword) return true
      return [item.title, item.description, item.category, item.prompt, ...item.tags].some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword))
    })
  }, [category, query])

  const usePrompt = (item: InspirationPrompt) => {
    setPrompt(item.prompt)
    showToast(`已应用「${item.title}」`, 'success')
    onClose()
    window.setTimeout(() => document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(), 0)
  }

  const copyPrompt = async (item: InspirationPrompt) => {
    try {
      await copyTextToClipboard(item.prompt)
      showToast('提示词已复制', 'success')
    } catch (error) {
      showToast(getClipboardFailureMessage('复制提示词失败', error), 'error')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={libraryRef} role="dialog" aria-modal="true" aria-label="光构灵感库" className="flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#f7f8fb] shadow-2xl dark:bg-gray-950 sm:h-[88dvh] sm:max-w-6xl sm:rounded-[28px]">
        <header className="relative overflow-hidden border-b border-gray-200/80 bg-white px-5 pb-5 pt-5 dark:border-white/[0.08] dark:bg-gray-950 sm:px-7 sm:pt-6">
          <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="relative flex items-start justify-between gap-5">
            <div>
              <p className="text-[11px] font-bold tracking-[0.2em] text-blue-600">GOUO INSPIRATION</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-gray-950 dark:text-white">灵感库</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">精选可直接生成的中文提示词，也可以替换主体、色彩和场景后再创作。</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white" aria-label="关闭灵感库">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="relative mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" strokeWidth="2" />
                <path d="m20 20-3.5-3.5" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索风格、场景或用途…" className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:focus:bg-white/[0.06]" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:max-w-[66%] lg:pb-0">
              {INSPIRATION_CATEGORIES.map((item) => (
                <button key={item} type="button" onClick={() => setCategory(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition ${category === item ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.05] dark:text-gray-400 dark:hover:bg-white/[0.09]'}`}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{category === '全部' ? '全部灵感' : category}</p>
            <p className="text-xs text-gray-400">{prompts.length} 个模板</p>
          </div>
          {prompts.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {prompts.map((item) => (
                <article key={item.id} className="group overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-900/5 dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:border-blue-500/30">
                  <button type="button" onClick={() => setSelected(item)} className="block w-full text-left">
                    <div className="relative h-28 overflow-hidden" style={{ background: item.accent }}>
                      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 75% 20%, white 0, transparent 28%), linear-gradient(115deg, transparent 35%, rgba(255,255,255,.28) 50%, transparent 65%)' }} />
                      <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/20 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">{item.category}</span>
                      {item.featured && <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold text-blue-700 shadow-sm">精选</span>}
                      <div className="absolute bottom-3 left-4 h-7 w-7 rotate-12 rounded-lg border border-white/50 bg-white/20 shadow-lg backdrop-blur-sm transition group-hover:rotate-45" />
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{item.title}</h3>
                      <p className="mt-1.5 line-clamp-2 min-h-10 text-xs leading-5 text-gray-500 dark:text-gray-400">{item.description}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded-md bg-gray-100 px-2 py-1 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{tag}</span>)}
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-2 border-t border-gray-100 p-3 dark:border-white/[0.06]">
                    <button type="button" onClick={() => void copyPrompt(item)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition hover:border-blue-200 hover:text-blue-600 dark:border-white/10" aria-label={`复制${item.title}提示词`}><CopyIcon className="h-4 w-4" /></button>
                    <button type="button" onClick={() => usePrompt(item)} className="flex-1 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-600 dark:bg-white dark:text-gray-950 dark:hover:bg-blue-500 dark:hover:text-white">立即使用</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/60 text-center dark:border-white/10 dark:bg-white/[0.02]">
              <p className="text-sm font-medium text-gray-500">没有找到相关灵感</p>
              <button type="button" onClick={() => { setQuery(''); setCategory('全部') }} className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700">清除筛选</button>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-gray-200 bg-white px-5 py-3 text-[11px] text-gray-400 dark:border-white/[0.08] dark:bg-gray-950 sm:px-7">
          <span>提示词由光构重新编写，可按需自由修改</span>
          <a href="https://github.com/freestylefly/awesome-gpt-image-2" target="_blank" rel="noreferrer" className="shrink-0 transition hover:text-blue-600">开源灵感参考 ↗</a>
        </footer>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <div ref={detailRef} role="dialog" aria-modal="true" aria-label={`${selected.title}提示词详情`} className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[26px] border border-white/10 bg-white p-5 shadow-2xl dark:bg-gray-950 sm:max-w-2xl sm:rounded-[26px] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-blue-600">{selected.category}</span>
                <h3 className="mt-1 text-xl font-bold text-gray-950 dark:text-white">{selected.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{selected.description}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]" aria-label="关闭详情"><CloseIcon className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7 text-gray-700 dark:border-white/10 dark:bg-white/[0.035] dark:text-gray-300">{selected.prompt}</div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => void copyPrompt(selected)} className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:text-gray-300"><CopyIcon className="h-4 w-4" />复制</button>
              <button type="button" onClick={() => usePrompt(selected)} className="flex-1 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-700">使用这个灵感</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
