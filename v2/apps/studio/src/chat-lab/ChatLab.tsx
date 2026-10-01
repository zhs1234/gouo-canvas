import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../loomic/lib/auth-context'
import { fetchCatalog } from '../loomic/lib/gateway'
import { request } from '../api'
import { BalanceConsent, useBalanceConsent } from '../BalanceConsent'
import { useTrial } from '../trial'
import { restoreMessages, studioAdapter, type SavedThread } from './adapter'
import { Thread } from '../chat-starter/components/assistant-ui/elements/thread.aui'
import { WorkspaceShell as StudioShell } from '../workspace/WorkspaceShell'
import { useWorkspaceAccount } from '../workspace/WorkspaceAccountProvider'
import { SidebarMenuButton, useSidebar } from '../chat-starter/components/ui/sidebar'
import { Button } from '../chat-starter/components/ui/button'
import { Input } from '../chat-starter/components/ui/input'
import { PlusIcon, SearchIcon, MoonIcon, SunIcon } from 'lucide-react'
import '../chat-starter/theme.css'
import './chat-lab.css'
function StudioThreadList({ threads, id, create, select, loading, search, setSearch, searching }: { threads: SavedThread[]; id: string; create: () => void; select: (id: string) => void; loading: boolean; search: string; setSearch: (value: string) => void; searching: boolean }) {
  const sidebar = useSidebar()
  return <nav aria-label="会话列表" className="flex flex-col gap-0.5">
    <Button variant="ghost" className="h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal" disabled={loading} onClick={() => { create(); sidebar.setOpenMobile(false) }} aria-label="＋ 新会话"><PlusIcon />新会话</Button>
    <div className="relative px-0.5 py-1"><SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" /><Input aria-label="搜索会话" placeholder="搜索全部会话标题" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} className="h-8 ps-8 text-sm" /></div>
    <div className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs">会话</div>
    {searching ? <p role="status" className="px-2.5 text-sm">正在查询会话…</p> : threads.length === 0 && search.trim() ? <p role="status" className="px-2.5 text-sm">未找到匹配的会话标题</p> : threads.map(t => <SidebarMenuButton key={t.id} aria-current={t.id === id ? 'page' : undefined} isActive={t.id === id} onClick={() => { select(t.id); sidebar.setOpenMobile(false) }}><span>{t.title}</span></SidebarMenuButton>)}
  </nav>
}
function LabRuntime({ model, imageModel, thread, reload }: { model: string; imageModel?: string; thread: SavedThread; reload: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const consent = useBalanceConsent(String(user?.id) + ":" + thread.id)
  const lifetime = useRef(new AbortController())
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current.abort() }, [])
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const finish = useCallback((completed: boolean) => { if (completed) reload(); else { setNeedsRefresh(true); void queryClient.invalidateQueries({ queryKey: ['trial', user?.id] }) } }, [reload, queryClient, user?.id])
  const adapter = useMemo(() => studioAdapter(model, imageModel, thread.id, () => lifetime.current.signal, finish, consent.consume), [model, imageModel, thread.id, finish, consent.consume])
  const initialMessages = useMemo(() => restoreMessages(thread), [thread])
  const runtime = useLocalRuntime(adapter, { initialMessages })
  const [stopped, setStopped] = useState(false)
  const unknown = thread.runs.some(run => run.status === 'unknown')
  const unresolved = thread.runs.some(run => run.status === 'running' || run.status === 'unknown')
  return <AssistantRuntimeProvider runtime={runtime}><div className="flex h-full flex-col">
    <div className="flex-1 min-h-0"><Thread composerFooter={<BalanceConsent checked={consent.checked} change={consent.change} disabled={!model || unresolved || needsRefresh} />} disabled={!model || unresolved || needsRefresh} onSubmit={() => setStopped(false)} onStop={() => setStopped(true)} components={{ ToolFallback: ({ toolName, result }) => <details open className="rounded-lg border p-3 text-sm"><summary>{toolName === 'generate_image' ? '图片生成工具' : toolName}</summary>{result ? String(result) : '结果待确认'}</details> }} /></div>
    {stopped && <p role="status" className="studio-chat-notice">已停止接收，保留部分内容。供应商任务和费用可能继续，请查看账号记录。</p>}
    {(unresolved || needsRefresh) && <div className="studio-chat-notice"><p>{unknown ? '服务中断后任务结果未知，无法自动恢复。可新建会话继续；原任务费用仍需核对，刷新仅查询。' : '任务记录或费用待刷新确认；刷新仅查询，不会重新生成。'}</p><Button variant="outline" onClick={reload}>刷新任务记录</Button></div>}
  </div></AssistantRuntimeProvider>
}
function OwnedThreads({ model, imageModel, toolbar, notice }: { model: string; imageModel?: string; toolbar: ReactNode; notice?: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const id = params.get('thread') || ''
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])
  const [detail, setDetail] = useState<SavedThread | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, revise] = useState(0)
  const [offset, setOffset] = useState(0)
  const reload = useCallback(() => { revise(n => n + 1); void queryClient.invalidateQueries({ queryKey: ['trial', user?.id] }) }, [queryClient, user?.id])
  useEffect(() => setOffset(0), [id])
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const list = useInfiniteQuery({ queryKey: ['threads', user?.id, debouncedSearch, id, revision], initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => request<{items: SavedThread[]; nextOffset: number | null}>(`/api/studio/threads${pageParam || debouncedSearch ? '?' + new URLSearchParams({ ...(pageParam ? { offset: String(pageParam) } : {}), ...(debouncedSearch ? { search: debouncedSearch } : {}) }) : ''}`, { signal }),
    getNextPageParam: page => page.nextOffset ?? undefined, retry: false })
  const searching = search.trim() !== debouncedSearch || list.isPending
  const threads = list.data?.pages.flatMap(page => page.items).filter((thread, index, all) => all.findIndex(item => item.id === thread.id) === index) ?? []
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    setDetail(null)
    if (id) request<SavedThread>(`/api/studio/threads/${encodeURIComponent(id)}?offset=${offset}`, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setDetail(value) }).catch(e => { if (!abort.signal.aborted) setError(e.message) })
    return () => abort.abort()
  }, [id, revision, offset])
  async function create() {
    if (loading) return
    setLoading(true)
    try {
      const thread = await request<SavedThread>('/api/studio/threads', { method: 'POST', body: JSON.stringify({ title: '新会话' }) })
      if (active.current) setParams({ thread: thread.id })
    } catch (e) { if (active.current) setError((e as Error).message) }
    finally { if (active.current) setLoading(false) }
  }
  return <StudioShell toolbar={toolbar} notice={notice} list={<><StudioThreadList threads={threads} id={id} create={() => void create()} select={id => setParams({ thread: id })} loading={loading} search={search} setSearch={setSearch} searching={searching} />{list.error && <p role="alert">会话查询失败：{list.error.message}</p>}{list.hasNextPage && !searching && <Button variant="ghost" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>更多会话</Button>}</>}>
    {error ? <p role="alert" className="studio-chat-notice">{error}</p> : detail && detail.id === id ? <section className="flex h-full flex-col">
      {(offset > 0 || detail.nextOffset != null) && <div className="flex gap-2 px-4 py-2">{offset > 0 && <Button variant="ghost" onClick={() => setOffset(0)}>返回最新记录</Button>}{detail.nextOffset != null && <Button variant="ghost" onClick={() => setOffset(detail.nextOffset!)}>查看更早记录</Button>}</div>}
      <div className="flex-1 min-h-0"><LabRuntime key={`${id}:${revision}:${offset}`} thread={detail} model={offset ? '' : model} imageModel={imageModel} reload={reload} /></div>
    </section> : <div className="flex h-full items-center justify-center"><div className="w-full max-w-[44rem] px-6"><h1 className="mb-6 text-2xl font-medium tracking-tight">{id ? '加载会话…' : '今天有什么可以帮你？'}</h1>{!id && <Button onClick={() => void create()} disabled={loading}><PlusIcon />新会话</Button>}</div></div>}
  </StudioShell>
}
export default function ChatLab() {
  const { user, loading, blocked } = useAuth()
  useTrial(user?.id)
  const { openAccount } = useWorkspaceAccount()
  const catalog = useQuery({ queryKey: ['chat-lab-models', user?.id ?? 'guest'], queryFn: fetchCatalog, enabled: !loading && !blocked, retry: false })
  const availableModels = !catalog.error && catalog.data?.generationEnabled ? catalog.data.models.filter(m => m.accessible) : []
  const chats = availableModels.filter(m => m.kind === 'chat')
  const [selected, select] = useState('')
  const model = chats.find(m => m.id === selected)?.id || chats[0]?.id || ''
  const imageModel = availableModels.find(m => m.kind === 'image')?.id
  const unavailableMessage = catalog.error ? '聊天模型目录读取失败，请稍后刷新页面重新查询；不会自动发送。'
    : catalog.data && !catalog.data.generationEnabled ? '生成服务尚未开放，请联系管理员；当前不能发送模型请求。'
    : catalog.data && !chats.length ? catalog.data.models.some(m => m.kind === 'chat' && m.description === '当前账号分组没有此模型权限，请联系管理员')
      ? '当前账号没有可用聊天模型的使用权限，请联系管理员核对。'
      : '当前暂无已配置并验证的可用聊天模型，请联系管理员核对。' : ''
  const modelNotice = user && unavailableMessage ? <p role={catalog.error ? 'alert' : 'status'} className="studio-chat-notice">{unavailableMessage}</p> : undefined
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toolbar = <><span className="hidden text-sm text-muted-foreground md:block">Gouo Canvas</span><span className="hidden text-muted-foreground md:block">/</span><select className="min-w-0 max-w-48 bg-transparent text-sm outline-none" aria-label="聊天模型" value={model} onChange={e => select(e.target.value)}><option value="" disabled>选择聊天模型</option>{chats.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select><div className="ml-auto"><Button variant="ghost" size="icon" aria-label="切换主题" onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark) }}>{dark ? <SunIcon /> : <MoonIcon />}</Button></div></>
  return <>
    {user ? <OwnedThreads key={user.id} model={model} imageModel={imageModel} toolbar={toolbar} notice={modelNotice} /> : <StudioShell toolbar={toolbar}><div className="flex h-full items-center justify-center"><div className="px-6"><h1 className="mb-4 text-2xl font-medium">今天有什么可以帮你？</h1><p className="mb-6 text-sm text-muted-foreground">请连接 New API 账号。</p><Button onClick={() => openAccount()}>登录账号</Button></div></div></StudioShell>}
    {catalog.error && !user && <p role="alert" className="studio-chat-notice">模型目录加载失败</p>}
  </>
}
