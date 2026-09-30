import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AssistantRuntimeProvider, useLocalRuntime, ThreadPrimitive, MessagePrimitive, ComposerPrimitive, ThreadListPrimitive, ThreadListItemPrimitive } from '@assistant-ui/react'
import { Link } from 'react-router-dom'
import { useAuth } from '../loomic/lib/auth-context'
import { fetchCatalog } from '../loomic/lib/gateway'
import { studioAdapter } from './adapter'
import './chat-lab.css'

function Message() {
  return <MessagePrimitive.Root className="lab-message"><MessagePrimitive.Parts components={{
    Image: ({ image }) => <img src={image} alt="生成图片" />,
    tools: { Fallback: ({ toolName, result }) => <details open><summary>{toolName === 'generate_image' ? '图片生成工具' : toolName}</summary>{result ? String(result) : '执行中…'}</details> },
  }} /><MessagePrimitive.Error><p role="alert">请求失败或中断；请检查任务结果与账号费用，不会自动重试。</p></MessagePrimitive.Error></MessagePrimitive.Root>
}
function ThreadItem() {
  return <ThreadListItemPrimitive.Root><ThreadListItemPrimitive.Trigger><ThreadListItemPrimitive.Title fallback="新会话" /></ThreadListItemPrimitive.Trigger></ThreadListItemPrimitive.Root>
}
function LabRuntime({ model, imageModel }: { model: string; imageModel?: string }) {
  const adapter = useMemo(() => studioAdapter(model, imageModel), [model, imageModel])
  const runtime = useLocalRuntime(adapter)
  const [stopped, setStopped] = useState(false)
  return <AssistantRuntimeProvider runtime={runtime}><div className="lab-layout">
    <aside><ThreadListPrimitive.Root><ThreadListPrimitive.New>＋ 新会话</ThreadListPrimitive.New><ThreadListPrimitive.Items components={{ ThreadListItem: ThreadItem }} /></ThreadListPrimitive.Root><p>实验会话仅保留在本页内存，刷新即清空。</p></aside>
    <ThreadPrimitive.Root className="lab-thread"><ThreadPrimitive.Viewport><ThreadPrimitive.Empty>开始聊天，可通过智能体生成图片。</ThreadPrimitive.Empty><ThreadPrimitive.Messages components={{ Message }} /></ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root onSubmit={() => setStopped(false)}><ComposerPrimitive.Input aria-label="消息" placeholder="发送消息…" /><ComposerPrimitive.Send disabled={!model}>发送</ComposerPrimitive.Send><ComposerPrimitive.Cancel onClick={() => setStopped(true)}>停止接收</ComposerPrimitive.Cancel></ComposerPrimitive.Root>
      {stopped && <p role="status">已停止接收，保留部分内容。供应商任务和费用可能继续，请查看账号记录。</p>}
    </ThreadPrimitive.Root>
  </div></AssistantRuntimeProvider>
}
export default function ChatLab() {
  const { user } = useAuth()
  const catalog = useQuery({ queryKey: ['chat-lab-models'], queryFn: fetchCatalog })
  const chats = catalog.data?.models.filter(m => m.kind === 'chat' && m.accessible) || []
  const [selected, select] = useState('')
  const model = chats.find(m => m.id === selected)?.id || chats[0]?.id || ''
  const imageModel = catalog.data?.models.find(m => m.kind === 'image' && m.accessible)?.id
  return <main className="chat-lab"><header><Link to="/">← 返回画布与账号</Link><h1>聊天实验室</h1><span>assistant-ui · Studio · New API</span><select aria-label="聊天模型" value={model} onChange={e => select(e.target.value)}><option value="" disabled>选择聊天模型</option>{chats.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></header>
    {!user ? <p>请先返回画布连接 New API 账号。</p> : <LabRuntime key={user.id} model={model} imageModel={imageModel} />}
    {catalog.error && <p role="alert">模型目录加载失败</p>}
  </main>
}
