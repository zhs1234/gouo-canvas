import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, MessagePrimitive, ComposerPrimitive } from '@assistant-ui/react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../loomic/lib/auth-context'
import { fetchCatalog } from '../loomic/lib/gateway'
import { request } from '../api'
import Account from '../Account'
import { BillingPanel } from '../loomic/components/billing-panel'
import { fetchBilling } from '../loomic/lib/billing'
import { restoreMessages, studioAdapter, type SavedThread } from './adapter'
import { GeneratedImage } from './GeneratedImage'
import './chat-lab.css'
function Message() {
  return <MessagePrimitive.Root className="lab-message"><MessagePrimitive.Parts components={{ Image: GeneratedImage, tools: { Fallback: ({ toolName, result }) => <details open><summary>{toolName === 'generate_image' ? '图片生成工具' : toolName}</summary>{result ? String(result) : '结果待确认'}</details> } }} /><MessagePrimitive.Error><p role="alert">请求失败或中断；请检查任务结果与账号费用，不会自动重试。</p></MessagePrimitive.Error></MessagePrimitive.Root>
}
function LabRuntime({ model, imageModel, thread, reload }: { model: string; imageModel?: string; thread: SavedThread; reload: () => void }) {
  const lifetime = useRef(new AbortController())
  useEffect(() => { lifetime.current = new AbortController(); return () => lifetime.current.abort() }, [])
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const finish = useCallback((completed: boolean) => { if (completed) reload(); else setNeedsRefresh(true) }, [reload])
  const adapter = useMemo(() => studioAdapter(model, imageModel, thread.id, () => lifetime.current.signal, finish), [model, imageModel, thread.id, finish])
  const initialMessages = useMemo(() => restoreMessages(thread), [thread])
  const runtime = useLocalRuntime(adapter, { initialMessages })
  const [stopped, setStopped] = useState(false)
  const unknown = thread.runs.some(run => run.status === 'unknown')
  const unresolved = thread.runs.some(run => run.status === 'running' || run.status === 'unknown')
  return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root className="lab-thread"><ThreadPrimitive.Viewport><ThreadPrimitive.Empty>开始聊天，可通过智能体生成图片。</ThreadPrimitive.Empty><ThreadPrimitive.Messages components={{ Message }} /></ThreadPrimitive.Viewport>
    <ComposerPrimitive.Root onSubmit={() => setStopped(false)}><ComposerPrimitive.Input aria-label="消息" placeholder="发送消息…" disabled={unresolved || needsRefresh} /><ComposerPrimitive.Send disabled={!model || unresolved || needsRefresh}>发送</ComposerPrimitive.Send><ComposerPrimitive.Cancel onClick={() => setStopped(true)}>停止接收</ComposerPrimitive.Cancel></ComposerPrimitive.Root>
    {stopped && <p role="status">已停止接收，保留部分内容。供应商任务和费用可能继续，请查看账号记录。</p>}
    {(unresolved || needsRefresh) && <div><p>{unknown ? '服务中断后任务结果未知，无法自动恢复。可新建会话继续；原任务费用仍需核对，刷新仅查询。' : '任务记录或费用待刷新确认；刷新仅查询，不会重新生成。'}</p><button onClick={reload}>刷新任务记录</button></div>}
    <p>历史按 New API 账号保存。费用以账号账单为准。<Link to="/">查看账号</Link></p>
  </ThreadPrimitive.Root></AssistantRuntimeProvider>
}
function OwnedThreads({ model, imageModel }: { model: string; imageModel?: string }) {
  const [params, setParams] = useSearchParams()
  const id = params.get('thread') || ''
  const [threads, setThreads] = useState<SavedThread[]>([])
  const [detail, setDetail] = useState<SavedThread | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, revise] = useState(0)
  const [nextList, setNextList] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const reload = useCallback(() => revise(n => n + 1), [])
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
  return <div className="lab-layout"><aside><button onClick={create} disabled={loading}>＋ 新会话</button><nav aria-label="会话列表">{threads.map(t => <button key={t.id} aria-current={t.id === id ? 'page' : undefined} onClick={() => setParams({ thread: t.id })}>{t.title}</button>)}</nav>{nextList !== null && <button onClick={moreThreads}>更多会话</button>}<p>服务端账号会话，与本机画布草稿分开保存。</p></aside>
    {error ? <p role="alert">{error}</p> : detail && detail.id === id ? <section className="lab-history"><p>上下文仅使用最近 6 次成功任务；当前最多显示 50 条任务。</p>{offset > 0 && <button onClick={() => setOffset(0)}>返回最新记录</button>}{detail.nextOffset != null && <button onClick={() => setOffset(detail.nextOffset!)}>查看更早记录</button>}<LabRuntime key={`${id}:${revision}:${offset}`} thread={detail} model={offset ? '' : model} imageModel={imageModel} reload={reload} /></section> : <p>{id ? '加载会话…' : '选择会话，或新建会话开始聊天。'}</p>}
  </div>
}
export default function ChatLab() {
  const { user } = useAuth()
  const [accountOpen, setAccountOpen] = useState(false)
  const billing = useQuery({ queryKey: ['billing', user?.id], queryFn: ({ signal }) => fetchBilling(signal), enabled: Boolean(user) && accountOpen, retry: false })
  const catalog = useQuery({ queryKey: ['chat-lab-models', user?.id ?? 'guest'], queryFn: fetchCatalog })
  const chats = catalog.data?.models.filter(m => m.kind === 'chat' && m.accessible) || []
  const [selected, select] = useState('')
  const model = chats.find(m => m.id === selected)?.id || chats[0]?.id || ''
  const imageModel = catalog.data?.models.find(m => m.kind === 'image' && m.accessible)?.id
  return <main className="chat-lab"><header><Link to="/">← 返回画布与账号</Link><h1>聊天</h1><button onClick={() => setAccountOpen(v => !v)}>New API 账号</button><span>assistant-ui · Studio · New API</span><select aria-label="聊天模型" value={model} onChange={e => select(e.target.value)}><option value="" disabled>选择聊天模型</option>{chats.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></header>
    {accountOpen && <section aria-label="账号与费用"><Account />{user && <BillingPanel data={billing.data} error={billing.error} loading={billing.isFetching} refresh={() => { void billing.refetch() }} />}</section>}
    {!user ? <p>请连接 New API 账号。</p> : <OwnedThreads key={user.id} model={model} imageModel={imageModel} />}
    {catalog.error && <p role="alert">模型目录加载失败</p>}
  </main>
}
