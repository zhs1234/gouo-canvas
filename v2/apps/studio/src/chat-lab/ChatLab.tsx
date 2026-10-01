import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../loomic/lib/auth-context'
import { fetchCatalog } from '../loomic/lib/gateway'
import { request } from '../api'
import Account from '../Account'
import { TrialPanel } from '../TrialPanel'
import { useTrial } from '../trial'
import { BillingPanel } from '../loomic/components/billing-panel'
import { fetchBilling } from '../loomic/lib/billing'
import { restoreMessages, studioAdapter, type SavedThread } from './adapter'
import { Thread } from '../chat-starter/components/assistant-ui/elements/thread.aui'
import { ThreadListSidebar } from '../chat-starter/components/assistant-ui/elements/threadlist-sidebar.aui'
import { SidebarInset, SidebarProvider, SidebarTrigger, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../chat-starter/components/ui/sidebar'
import { Button } from '../chat-starter/components/ui/button'
import { Input } from '../chat-starter/components/ui/input'
import { Separator } from '../chat-starter/components/ui/separator'
import { MessagesSquare, PlusIcon, SearchIcon, MoonIcon, SunIcon, FolderIcon, PanelsTopLeftIcon, UserIcon } from 'lucide-react'
import '../chat-starter/theme.css'
import './chat-lab.css'
function StudioThreadList({ threads, id, create, select, loading }: { threads: SavedThread[]; id: string; create: () => void; select: (id: string) => void; loading: boolean }) {
  const [search, setSearch] = useState('')
  const sidebar = useSidebar()
  return <nav aria-label="会话列表" className="flex flex-col gap-0.5">
    <Button variant="ghost" className="h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal" disabled={loading} onClick={() => { create(); sidebar.setOpenMobile(false) }} aria-label="＋ 新会话"><PlusIcon />新会话</Button>
    {threads.length > 0 && <div className="relative px-0.5 py-1"><SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" /><Input aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={e => setSearch(e.target.value)} className="h-8 ps-8 text-sm" /></div>}
    <div className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs">会话</div>
    {threads.filter(t => t.title.toLowerCase().includes(search.toLowerCase())).map(t => <SidebarMenuButton key={t.id} aria-current={t.id === id ? 'page' : undefined} isActive={t.id === id} onClick={() => { select(t.id); sidebar.setOpenMobile(false) }}><span>{t.title}</span></SidebarMenuButton>)}
  </nav>
}
function StudioShell({ list, toolbar, footer, children }: { list?: ReactNode; toolbar: ReactNode; footer: ReactNode; children: ReactNode }) {
  return <SidebarProvider className="chat-starter"><div className="flex h-dvh w-full pr-0.5"><ThreadListSidebar footer={footer}>{list}</ThreadListSidebar><SidebarInset className="min-w-0"><header className="flex h-16 shrink-0 items-center gap-2 border-b px-4"><SidebarTrigger aria-label="切换侧栏" /><Separator orientation="vertical" className="mr-2 h-4" />{toolbar}</header><div className="flex-1 min-h-0 overflow-hidden">{children}</div></SidebarInset></div></SidebarProvider>
}
function LabRuntime({ model, imageModel, thread, reload }: { model: string; imageModel?: string; thread: SavedThread; reload: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const lifetime = useRef(new AbortController())
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current.abort() }, [])
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const finish = useCallback((completed: boolean) => { if (completed) reload(); else { setNeedsRefresh(true); void queryClient.invalidateQueries({ queryKey: ['trial', user?.id] }) } }, [reload, queryClient, user?.id])
  const adapter = useMemo(() => studioAdapter(model, imageModel, thread.id, () => lifetime.current.signal, finish), [model, imageModel, thread.id, finish])
  const initialMessages = useMemo(() => restoreMessages(thread), [thread])
  const runtime = useLocalRuntime(adapter, { initialMessages })
  const [stopped, setStopped] = useState(false)
  const unknown = thread.runs.some(run => run.status === 'unknown')
  const unresolved = thread.runs.some(run => run.status === 'running' || run.status === 'unknown')
  return <AssistantRuntimeProvider runtime={runtime}><div className="flex h-full flex-col">
    <div className="flex-1 min-h-0"><Thread disabled={!model || unresolved || needsRefresh} onSubmit={() => setStopped(false)} onStop={() => setStopped(true)} components={{ ToolFallback: ({ toolName, result }) => <details open className="rounded-lg border p-3 text-sm"><summary>{toolName === 'generate_image' ? '图片生成工具' : toolName}</summary>{result ? String(result) : '结果待确认'}</details> }} /></div>
    {stopped && <p role="status" className="studio-chat-notice">已停止接收，保留部分内容。供应商任务和费用可能继续，请查看账号记录。</p>}
    {(unresolved || needsRefresh) && <div className="studio-chat-notice"><p>{unknown ? '服务中断后任务结果未知，无法自动恢复。可新建会话继续；原任务费用仍需核对，刷新仅查询。' : '任务记录或费用待刷新确认；刷新仅查询，不会重新生成。'}</p><Button variant="outline" onClick={reload}>刷新任务记录</Button></div>}
  </div></AssistantRuntimeProvider>
}
function OwnedThreads({ model, imageModel, toolbar, footer }: { model: string; imageModel?: string; toolbar: ReactNode; footer: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const id = params.get('thread') || ''
  const [threads, setThreads] = useState<SavedThread[]>([])
  const [detail, setDetail] = useState<SavedThread | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, revise] = useState(0)
  const [nextList, setNextList] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const reload = useCallback(() => { revise(n => n + 1); void queryClient.invalidateQueries({ queryKey: ['trial', user?.id] }) }, [queryClient, user?.id])
  useEffect(() => setOffset(0), [id])
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    request<{items: SavedThread[]; nextOffset: number | null}>('/api/studio/threads', { signal: abort.signal }).then(value => { if (!abort.signal.aborted) { setThreads(value.items); setNextList(value.nextOffset) } }).catch(e => { if (!abort.signal.aborted) setError(e.message) })
    return () => abort.abort()
  }, [id, revision])
  useEffect(() => {
    const abort = new AbortController()
    setDetail(null)
    if (id) request<SavedThread>(`/api/studio/threads/${encodeURIComponent(id)}?offset=${offset}`, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setDetail(value) }).catch(e => { if (!abort.signal.aborted) setError(e.message) })
    return () => abort.abort()
  }, [id, revision, offset])
  async function moreThreads() {
    if (nextList === null) return
    try {
      const page = await request<{items: SavedThread[]; nextOffset: number | null}>(`/api/studio/threads?offset=${nextList}`)
      if (active.current) { setThreads(old => [...old, ...page.items.filter(t => !old.some(x => x.id === t.id))]); setNextList(page.nextOffset) }
    } catch (e) { if (active.current) setError((e as Error).message) }
  }
  async function create() {
    if (loading) return
    setLoading(true)
    try {
      const thread = await request<SavedThread>('/api/studio/threads', { method: 'POST', body: JSON.stringify({ title: '新会话' }) })
      if (active.current) setParams({ thread: thread.id })
    } catch (e) { if (active.current) setError((e as Error).message) }
    finally { if (active.current) setLoading(false) }
  }
  return <StudioShell toolbar={toolbar} footer={footer} list={<><StudioThreadList threads={threads} id={id} create={() => void create()} select={id => setParams({ thread: id })} loading={loading} />{nextList !== null && <Button variant="ghost" onClick={moreThreads}>更多会话</Button>}</>}>
    {error ? <p role="alert" className="studio-chat-notice">{error}</p> : detail && detail.id === id ? <section className="flex h-full flex-col">
      {(offset > 0 || detail.nextOffset != null) && <div className="flex gap-2 px-4 py-2">{offset > 0 && <Button variant="ghost" onClick={() => setOffset(0)}>返回最新记录</Button>}{detail.nextOffset != null && <Button variant="ghost" onClick={() => setOffset(detail.nextOffset!)}>查看更早记录</Button>}</div>}
      <div className="flex-1 min-h-0"><LabRuntime key={`${id}:${revision}:${offset}`} thread={detail} model={offset ? '' : model} imageModel={imageModel} reload={reload} /></div>
    </section> : <div className="flex h-full items-center justify-center"><div className="w-full max-w-[44rem] px-6"><h1 className="mb-6 text-2xl font-medium tracking-tight">{id ? '加载会话…' : '今天有什么可以帮你？'}</h1>{!id && <Button onClick={() => void create()} disabled={loading}><PlusIcon />新会话</Button>}</div></div>}
  </StudioShell>
}
export default function ChatLab() {
  const { user } = useAuth()
  useTrial(user?.id)
  const [accountOpen, setAccountOpen] = useState(false)
  const billing = useQuery({ queryKey: ['billing', user?.id], queryFn: ({ signal }) => fetchBilling(signal), enabled: Boolean(user) && accountOpen, retry: false })
  const catalog = useQuery({ queryKey: ['chat-lab-models', user?.id ?? 'guest'], queryFn: fetchCatalog })
  const chats = catalog.data?.models.filter(m => m.kind === 'chat' && m.accessible) || []
  const [selected, select] = useState('')
  const model = chats.find(m => m.id === selected)?.id || chats[0]?.id || ''
  const imageModel = catalog.data?.models.find(m => m.kind === 'image' && m.accessible)?.id
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toolbar = <><span className="hidden text-sm text-muted-foreground md:block">Gouo Canvas</span><span className="hidden text-muted-foreground md:block">/</span><select className="min-w-0 max-w-48 bg-transparent text-sm outline-none" aria-label="聊天模型" value={model} onChange={e => select(e.target.value)}><option value="" disabled>选择聊天模型</option>{chats.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select><div className="ml-auto"><Button variant="ghost" size="icon" aria-label="切换主题" onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark) }}>{dark ? <SunIcon /> : <MoonIcon />}</Button></div></>
  const footer = <SidebarMenu><SidebarMenuItem><SidebarMenuButton render={<Link to="/projects" />}><FolderIcon /><span>项目库</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton render={<Link to="/canvas-lab" />}><PanelsTopLeftIcon /><span>官方画布</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton render={<Link to="/" />}><MessagesSquare /><span>Loomic 工作台</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton size="lg" onClick={() => setAccountOpen(v => !v)} aria-label="New API 账号"><div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 items-center justify-center rounded-lg"><UserIcon className="size-4" /></div><div className="flex flex-col text-left"><span className="font-semibold">{user?.display_name || user?.username || '登录账号'}</span><span className="text-xs text-muted-foreground">账号与费用</span></div></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
  return <>
    {user ? <OwnedThreads key={user.id} model={model} imageModel={imageModel} toolbar={toolbar} footer={footer} /> : <StudioShell toolbar={toolbar} footer={footer}><div className="flex h-full items-center justify-center"><div className="px-6"><h1 className="mb-4 text-2xl font-medium">今天有什么可以帮你？</h1><p className="mb-6 text-sm text-muted-foreground">请连接 New API 账号。</p><Button onClick={() => setAccountOpen(true)}>登录账号</Button></div></div></StudioShell>}
    {accountOpen && <div className="account-overlay" onClick={() => setAccountOpen(false)}><section className="account-dialog" aria-label="账号与费用" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}><button className="account-close" aria-label="关闭账号" onClick={() => setAccountOpen(false)}>✕</button><Account />{user && <><TrialPanel userId={user.id} /><BillingPanel data={billing.data} error={billing.error} loading={billing.isFetching} refresh={() => { void billing.refetch() }} /></>}</section></div>}
    {catalog.error && <p role="alert" className="studio-chat-notice">模型目录加载失败</p>}
  </>
}
