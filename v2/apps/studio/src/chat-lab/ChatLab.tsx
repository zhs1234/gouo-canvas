import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { AssistantRuntimeProvider, useLocalRuntime, type AssistantRuntime, type ChatModelAdapter } from '@assistant-ui/react'
import { useSearchParams } from 'react-router-dom'
import { useTheme } from 'next-themes'
import { useAuth } from '../loomic/lib/auth-context'
import { fetchCatalog } from '../loomic/lib/gateway'
import { request } from '../api'
import { BalanceConsent, useBalanceConsent } from '../BalanceConsent'
import { useTrial } from '../trial'
import { restoreMessages, studioAdapter, type SavedThread, type ThreadMetadata } from './adapter'
import { Thread } from '../chat-starter/components/assistant-ui/elements/thread.aui'
import { WorkspaceShell as StudioShell } from '../workspace/WorkspaceShell'
import { useWorkspaceAccount } from '../workspace/WorkspaceAccountProvider'
import { SidebarMenuButton, useSidebar } from '../chat-starter/components/ui/sidebar'
import { Button } from '../chat-starter/components/ui/button'
import { Input } from '../chat-starter/components/ui/input'
import { PlusIcon, SearchIcon, MoonIcon, SunIcon, RefreshCwIcon } from 'lucide-react'
import '../chat-starter/theme.css'
import './chat-lab.css'
function StudioThreadList({ threads, id, create, select, loading, search, setSearch, searching }: { threads: ThreadMetadata[]; id: string; create: () => void; select: (id: string) => void; loading: boolean; search: string; setSearch: (value: string) => void; searching: boolean }) {
  const sidebar = useSidebar()
  return <nav aria-label="会话列表" className="flex flex-col gap-0.5">
    <Button variant="ghost" className="h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal" disabled={loading} onClick={() => { create(); sidebar.setOpenMobile(false) }} aria-label="＋ 新会话"><PlusIcon />新会话</Button>
    <div className="relative px-0.5 py-1"><SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" /><Input aria-label="搜索会话" placeholder="搜索全部会话标题" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} className="h-8 ps-8 text-sm" /></div>
    <div className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs">会话</div>
    {searching ? <p role="status" className="px-2.5 text-sm">正在查询会话…</p> : threads.length === 0 && search.trim() ? <p role="status" className="px-2.5 text-sm">未找到匹配的会话标题</p> : threads.map(t => <SidebarMenuButton key={t.id} aria-current={t.id === id ? 'page' : undefined} isActive={t.id === id} onClick={() => { select(t.id); sidebar.setOpenMobile(false) }}><span>{t.title}</span></SidebarMenuButton>)}
  </nav>
}
function ChatWelcome() {
  return <div className="aui-thread-welcome-root studio-chat-home-welcome mb-6 flex flex-col px-2"><h1 className="aui-thread-welcome-message-inner text-2xl font-medium tracking-tight">今天有什么可以帮你？</h1><p className="mt-3 text-sm text-muted-foreground">从商品图、海报文案或创作灵感开始。</p></div>
}
function GuestConversation({ login }: { login: () => void }) {
  const adapter = useMemo<ChatModelAdapter>(() => ({ async run() { throw new Error('请先登录账号后明确发送') } }), [])
  const runtime = useLocalRuntime(adapter)
  return <AssistantRuntimeProvider runtime={runtime}><div className="studio-chat-home h-full" onSubmitCapture={event => { event.preventDefault(); login() }} onClickCapture={event => {
    if ((event.target as Element).closest('button[aria-label="发送"]')) { event.preventDefault(); event.stopPropagation(); login() }
  }}><Thread components={{ Welcome: ChatWelcome }} composerFooter={<div className="studio-chat-home-signin px-2 py-1 text-sm text-muted-foreground">登录后即可保存会话并发送创作需求。<Button variant="link" onClick={login}>登录账号</Button></div>} /></div></AssistantRuntimeProvider>
}
function LabRuntime({ model, imageModel, selectionBlocked, thread, scope, reload, created, refreshing }: { model: string; imageModel?: string; selectionBlocked: boolean; thread: SavedThread; scope: string; reload: () => void; created: (thread: SavedThread) => void; refreshing: boolean }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const consent = useBalanceConsent(String(user?.id) + ":" + scope)
  const lifetime = useRef(new AbortController())
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current.abort() }, [])
  const runtimeRef = useRef<AssistantRuntime | null>(null)
  const runInFlight = useRef(false)
  const destination = useRef(thread.id)
  const createAttempted = useRef(false)
  const [creationUnconfirmed, setCreationUnconfirmed] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const finish = useCallback((completed: boolean) => { setNeedsRefresh(true); if (completed) reload(); else void queryClient.invalidateQueries({ queryKey: ['trial', user?.id] }) }, [reload, queryClient, user?.id])
  const adapter = useMemo<ChatModelAdapter>(() => ({ async *run(options) {
    runInFlight.current = true
    const prompt = options.messages.at(-1)?.content.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
    const payWithBalance = consent.consume()
    let delegated = false
    try {
      if (!model || selectionBlocked) throw new Error('请先选择可用模型后明确发送')
      if (!destination.current) {
        if (createAttempted.current) throw new Error('会话创建结果仍待核对，请先刷新会话列表')
        createAttempted.current = true
        const value = await request<ThreadMetadata>('/api/studio/threads', { method: 'POST', signal: AbortSignal.any([options.abortSignal, lifetime.current.signal]), body: JSON.stringify({ title: '新会话' }) })
        lifetime.current.signal.throwIfAborted()
        options.abortSignal.throwIfAborted()
        if (typeof value?.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) throw new Error('会话创建响应缺少有效编号，请先刷新会话列表核对')
        destination.current = value.id
        // POST creates an empty thread and returns metadata, not saved history.
        created({ ...value, runs: [] })
        // Creation can take time. Check the chosen IDs again before the first
        // model request, preserving the user's intent instead of picking A.
        const fresh = await queryClient.fetchQuery({ queryKey: ['chat-lab-models', user?.id], queryFn: fetchCatalog, staleTime: 0 })
        if (!fresh.generationEnabled || !fresh.models.some(item => item.id === model && item.kind === 'chat' && item.accessible)
          || imageModel && !fresh.models.some(item => item.id === imageModel && item.kind === 'image' && item.accessible)) throw new Error('所选模型当前不可用，请刷新并重新选择后发送；不会自动切换或发送。')
      }
      lifetime.current.signal.throwIfAborted()
      options.abortSignal.throwIfAborted()
      delegated = true
      const result = studioAdapter(model, imageModel, destination.current, () => lifetime.current.signal, finish, () => payWithBalance).run(options)
      if (Symbol.asyncIterator in result) { for await (const chunk of result) yield chunk }
      else yield await result
    } catch (error) {
      if (!lifetime.current.signal.aborted) {
        const composer = runtimeRef.current?.thread.composer
        if (composer && !composer.getState().text.trim()) composer.setText(prompt)
        if (!delegated) {
          const unconfirmed = createAttempted.current && !destination.current
          setCreationUnconfirmed(unconfirmed)
          yield { content: [], metadata: { custom: { publicFailure: { message: unconfirmed ? '会话创建未确认，已保留输入。请刷新会话列表核对；不会自动创建或发送。' : '本次尚未发送模型请求，已保留输入。请核对模型或连接后明确发送。', walletSuggested: false } } } }
        }
      }
      throw error
    } finally { runInFlight.current = false }
  } }), [model, imageModel, selectionBlocked, created, queryClient, user?.id, consent.consume, finish])
  const initialMessages = useMemo(() => restoreMessages(thread), [thread])
  const runtime = useLocalRuntime(adapter, { initialMessages })
  runtimeRef.current = runtime
  const snapshot = useRef(thread)
  useEffect(() => {
    if (snapshot.current === thread) return
    snapshot.current = thread
    // A successful read may replace history, but must not interrupt the live
    // stream. Its terminal callback requests a new authoritative snapshot.
    if (runInFlight.current || runtime.thread.getState().isRunning) return
    runtime.thread.reset(restoreMessages(thread))
    setNeedsRefresh(false)
  }, [thread, runtime])
  const [stopped, setStopped] = useState(false)
  const unknown = thread.runs.some(run => run.status === 'unknown')
  const unresolved = thread.runs.some(run => run.status === 'running' || run.status === 'unknown')
  const disabled = !model || selectionBlocked || unresolved || needsRefresh || creationUnconfirmed
  return <AssistantRuntimeProvider runtime={runtime}><div className={`flex h-full flex-col ${!thread.id ? 'studio-chat-home' : ''}`}>
    <div className="flex-1 min-h-0"><Thread composerFooter={<BalanceConsent checked={consent.checked} change={consent.change} disabled={disabled} />} disabled={disabled} onSubmit={() => setStopped(false)} onStop={() => setStopped(true)} components={{ Welcome: ChatWelcome, ToolFallback: ({ toolName, result }) => <details open className="rounded-lg border p-3 text-sm"><summary>{toolName === 'generate_image' ? '图片生成工具' : toolName}</summary>{result ? String(result) : '结果待确认'}</details> }} /></div>
    {stopped && <p role="status" className="studio-chat-notice">已停止接收，保留部分内容。供应商任务和费用可能继续，请查看账号记录。</p>}
    {creationUnconfirmed && <div className="studio-chat-notice"><Button variant="outline" disabled={refreshing} onClick={reload}>刷新会话列表</Button></div>}
    {(unresolved || needsRefresh) && <div className="studio-chat-notice"><p>{unknown ? '服务中断后任务结果未知，无法自动恢复。可新建会话继续；原任务费用仍需核对，刷新仅查询。' : '任务记录或费用待刷新确认；刷新仅查询，不会重新生成。'}</p><Button variant="outline" disabled={refreshing} onClick={reload}>刷新任务记录</Button></div>}
  </div></AssistantRuntimeProvider>
}
function OwnedThreads({ model, imageModel, selectionBlocked, toolbar, notice }: { model: string; imageModel?: string; selectionBlocked: boolean; toolbar: ReactNode; notice?: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const id = params.get('thread') || ''
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])
  const [view, setView] = useState<{ thread: SavedThread; offset: number; key: string }>(() => ({ thread: { id: '', title: '新会话', updatedAt: '', runs: [] }, offset: 0, key: crypto.randomUUID() }))
  const pendingCreated = useRef('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [revision, revise] = useState(0)
  const [offset, setOffset] = useState(0)
  const reload = useCallback(() => { revise(n => n + 1); void queryClient.invalidateQueries({ queryKey: ['trial', user?.id] }) }, [queryClient, user?.id])
  useEffect(() => setOffset(0), [id])
  const list = useInfiniteQuery({ queryKey: ['threads', user?.id, debouncedSearch, id, revision], initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => request<{items: ThreadMetadata[]; nextOffset: number | null}>(`/api/studio/threads${pageParam || debouncedSearch ? '?' + new URLSearchParams({ ...(pageParam ? { offset: String(pageParam) } : {}), ...(debouncedSearch ? { search: debouncedSearch } : {}) }) : ''}`, { signal }),
    getNextPageParam: page => page.nextOffset ?? undefined, retry: false })
  const searching = search.trim() !== debouncedSearch || list.isPending
  const threads = list.data?.pages.flatMap(page => page.items).filter((thread, index, all) => all.findIndex(item => item.id === thread.id) === index) ?? []
  useEffect(() => {
    const abort = new AbortController()
    setError('')
    setReading(Boolean(id))
    if (pendingCreated.current === id && id) {
      pendingCreated.current = ''
      setReading(false)
      // A confirmed new thread starts with an empty history snapshot. An
      // immediate read could return that old snapshot after the live run ends.
      // Read again on its terminal callback or an explicit recovery gesture.
      return () => abort.abort()
    }
    if (!id && !pendingCreated.current) setView(previous => previous.thread.id ? { thread: { id: '', title: '新会话', updatedAt: '', runs: [] }, offset: 0, key: crypto.randomUUID() } : previous)
    if (id) request<SavedThread>(`/api/studio/threads/${encodeURIComponent(id)}?offset=${offset}`, { signal: abort.signal }).then(thread => {
      if (!abort.signal.aborted) setView(previous => ({ thread, offset, key: previous.thread.id === id && previous.offset === offset ? previous.key : `${id}:${offset}` }))
    }).catch(e => { if (!abort.signal.aborted) setError(e.message) }).finally(() => { if (!abort.signal.aborted) setReading(false) })
    return () => abort.abort()
  }, [id, revision, offset])
  function create() {
    pendingCreated.current = ''
    setError('')
    setOffset(0)
    setView({ thread: { id: '', title: '新会话', updatedAt: '', runs: [] }, offset: 0, key: crypto.randomUUID() })
    setParams({})
  }
  const created = useCallback((thread: SavedThread) => {
    // The navigation guard may commit the new URL after this state update.
    // Keep the draft runtime alive across that specific creation handoff.
    pendingCreated.current = thread.id
    setView(previous => ({ ...previous, thread }))
    setParams({ thread: thread.id })
  }, [setParams])
  const detail = view.thread
  const visible = (detail.id === id || !id && pendingCreated.current === detail.id) && view.offset === offset
  return <StudioShell toolbar={toolbar} notice={notice} list={<><StudioThreadList threads={threads} id={id} create={create} select={id => setParams({ thread: id })} loading={false} search={search} setSearch={setSearch} searching={searching} />{list.error && <p role="alert">会话查询失败：{list.error.message}</p>}{list.hasNextPage && !searching && <Button variant="ghost" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>更多会话</Button>}</>}>
    <section className="flex h-full flex-col">
      {error && <div role="alert" className="studio-chat-notice"><p>{error}</p><Button variant="outline" disabled={reading} onClick={reload}>重新读取会话</Button></div>}
      {visible ? <>
        {(offset > 0 || detail.nextOffset != null) && <div className="flex gap-2 px-4 py-2">{offset > 0 && <Button variant="ghost" onClick={() => setOffset(0)}>返回最新记录</Button>}{detail.nextOffset != null && <Button variant="ghost" onClick={() => setOffset(detail.nextOffset!)}>查看更早记录</Button>}</div>}
        <div className="flex-1 min-h-0"><LabRuntime key={view.key} scope={view.key} thread={detail} model={offset ? '' : model} imageModel={imageModel} selectionBlocked={selectionBlocked} reload={reload} created={created} refreshing={reading || list.isFetching} /></div>
      </> : !error && <div role="status" className="flex h-full items-center justify-center text-muted-foreground">加载会话…</div>}
    </section>
  </StudioShell>
}
export default function ChatLab() {
  const { user, loading, blocked } = useAuth()
  useTrial(user?.id)
  const { openAccount } = useWorkspaceAccount()
  const catalog = useQuery({ queryKey: ['chat-lab-models', user?.id ?? 'guest'], queryFn: fetchCatalog, enabled: !loading && !blocked, retry: false })
  const availableModels = !catalog.isFetching && !catalog.error && catalog.data?.generationEnabled ? catalog.data.models.filter(m => m.accessible) : []
  const chats = availableModels.filter(m => m.kind === 'chat')
  const images = availableModels.filter(m => m.kind === 'image')
  const queryClient = useQueryClient()
  const owner: number | 'guest' = user?.id ?? 'guest'
  type Selection = { owner: number | 'guest'; chat?: string; image?: string }
  const selectionKey = ['chat-lab-selection', owner]
  const [selection, setSelection] = useState<Selection>(() => queryClient.getQueryData<Selection>(selectionKey) ?? { owner })
  const currentSelection = selection.owner === owner ? selection : queryClient.getQueryData<Selection>(selectionKey) ?? { owner }
  const chosenChat = currentSelection.chat ?? chats[0]?.id
  const chosenImage = currentSelection.image ?? images[0]?.id
  const model = chats.find(m => m.id === chosenChat)?.id || ''
  const imageModel = images.find(m => m.id === chosenImage)?.id
  const chatLost = Boolean(chosenChat && !model && !catalog.isFetching && !catalog.error && catalog.data?.generationEnabled)
  const imageLost = Boolean(chosenImage && !imageModel && !catalog.isFetching && !catalog.error && catalog.data?.generationEnabled)
  const selectionBlocked = chatLost || imageLost
  useEffect(() => {
    const next: Selection = { owner, ...(chosenChat ? { chat: chosenChat } : {}), ...(chosenImage ? { image: chosenImage } : {}) }
    queryClient.setQueryData(['chat-lab-selection', owner], next)
    setSelection(previous => previous.owner === owner && previous.chat === chosenChat && previous.image === chosenImage ? previous : next)
  }, [owner, chosenChat, chosenImage, queryClient])
  useEffect(() => {
    if (selectionBlocked && user) window.dispatchEvent(new CustomEvent('gouo:clear-balance-consent', { detail: { owner: `local:${user.id}` } }))
  }, [selectionBlocked, user?.id])
  function choose(kind: 'chat' | 'image', id: string) {
    const next = { ...currentSelection, owner, [kind]: id }
    queryClient.setQueryData(['chat-lab-selection', owner], next)
    setSelection(next)
  }
  const unavailableMessage = catalog.isFetching ? '正在核对可用模型，完成前不能发送。'
    : catalog.error ? '聊天模型目录读取失败，请稍后刷新页面重新查询；不会自动发送。'
    : catalog.data && !catalog.data.generationEnabled ? '生成服务尚未开放，请联系管理员；当前不能发送模型请求。'
    : catalog.data && !chats.length ? catalog.data.models.some(m => m.kind === 'chat' && m.description === '当前账号分组没有此模型权限，请联系管理员')
      ? '当前账号没有可用聊天模型的使用权限，请联系管理员核对。'
      : '当前暂无已配置并验证的可用聊天模型，请联系管理员核对。'
    : chatLost ? '此前选择的聊天模型当前不可用，请重新选择聊天模型；不会自动切换或发送。'
    : imageLost ? '此前选择的图片模型当前不可用，请重新选择图片模型后发送；不会自动切换或发送。' : ''
  const modelNotice = user && unavailableMessage ? <p role={catalog.error ? 'alert' : 'status'} className="studio-chat-notice">{unavailableMessage}</p> : undefined
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  const toolbar = <><select className="min-w-0 max-w-48 bg-transparent text-sm outline-none" aria-label="聊天模型" value={model} onChange={e => choose('chat', e.target.value)}><option value="" disabled>选择聊天模型</option>{chats.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select>{(images.length > 1 || imageLost) && <select className="min-w-0 max-w-40 bg-transparent text-sm outline-none" aria-label="图片模型" value={imageModel ?? ''} onChange={e => choose('image', e.target.value)}><option value="" disabled>选择图片模型</option>{images.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select>}<Button variant="ghost" size="icon" className="shrink-0" aria-label="刷新可用模型" disabled={catalog.isFetching || loading || blocked} onClick={() => { void catalog.refetch() }}><RefreshCwIcon aria-hidden="true" /></Button><div className="ml-auto"><Button variant="ghost" size="icon" aria-label="切换主题" onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <SunIcon /> : <MoonIcon />}</Button></div></>
  return <>
    {user ? <OwnedThreads key={user.id} model={model} imageModel={imageModel} selectionBlocked={selectionBlocked} toolbar={toolbar} notice={modelNotice} /> : <StudioShell toolbar={toolbar}><GuestConversation login={() => openAccount()} /></StudioShell>}
    {catalog.error && !user && <p role="alert" className="studio-chat-notice">模型目录加载失败</p>}
  </>
}
