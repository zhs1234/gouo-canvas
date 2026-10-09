import { useEffect, useRef, useState } from 'react'
import { ensureImageCached, executeTask, useStore } from '../../store'
import { useAgentStore } from '../../stores/agentStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { fileToDataUrl } from '../../lib/dataUrl'
import { storeImageWithSize } from '../../lib/db'
import { isBackendAuthEnabled } from '../../lib/gouoBackend'
import { executeAgentTool } from '../../lib/agent/tools'
import type { AgentConversation, AgentToolCall } from '../../lib/agent/types'
import BackendModelSelector from '../BackendModelSelector'
import ModelSelect from '../ModelSelect'
import { CloseIcon, CopyIcon, PlusIcon, RefreshIcon, SparklesIcon } from '../icons'
import './agent.css'

const toolLabels: Record<string, string> = {
  get_canvas: '查看画布',
  apply_canvas_operations: '编辑画布',
  create_image_task: '生成图片',
  get_task_status: '查询生成进度',
  add_task_output: '放入画布',
  select_reference: '选择参考图',
}

export function AgentImage({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const [url, setUrl] = useState<string>()
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let disposed = false
    setUrl(undefined)
    setUnavailable(false)
    void ensureImageCached(id).then((value) => {
      if (!disposed) { setUrl(value); setUnavailable(!value) }
    }).catch((error) => {
      console.warn('Agent 附件加载失败', error)
      if (!disposed) setUnavailable(true)
    })
    return () => { disposed = true }
  }, [id])
  return <span className="agent-reference" data-image-id={id}>
    {url ? <img src={url} alt="创作参考图" loading="lazy" /> : <span>{unavailable ? '图片暂不可用' : '图片加载中'}</span>}
    {onRemove && <button type="button" onClick={onRemove} aria-label="移除参考图"><CloseIcon width={12} height={12} /></button>}
  </span>
}

export function ToolCall({ call, conversationId, running }: { call: AgentToolCall; conversationId: string; running?: boolean }) {
  const notStarted = call.execution === 'not_started' && call.status === 'error'
  return <div><details className={`agent-tool agent-tool-${call.status}`}>
    <summary><span className="agent-status-dot" /><span>{toolLabels[call.name] || call.name}</span><span>{notStarted ? '未执行' : call.recovery === 'unconfirmed' ? '结果待核对' : call.recovery === 'acknowledged' ? '已核对原请求' : call.recovery === 'matched' ? '已找回原任务' : call.status === 'running' ? '执行中' : call.status === 'done' ? call.name === 'create_image_task' ? '已提交' : '已完成' : call.status === 'error' ? '未完成' : '准备中'}</span></summary>
    <div className="agent-tool-detail">
      {notStarted && <p>{call.name === 'create_image_task' ? '图片请求尚未提交，可继续对话完成。' : '工具尚未执行，可继续对话完成。'}</p>}
      <p>调用参数</p><pre>{call.arguments}</pre>
      {call.result && <><p>执行结果</p><pre>{call.result}</pre></>}
    </div>
  </details>{!notStarted && call.recovery === 'unconfirmed' && <div className="agent-resume"><span>原请求可能已提交，请核对我的作品和使用记录。</span><button type="button" className="agent-text-button" disabled={running} onClick={() => useStore.getState().setConfirmDialog({
    title: '确认已核对原图片请求',
    message: '原请求可能已经扣费。请先核对我的作品和用户中心的使用记录。确认后仅允许后续新的生成请求，原记录仍保留；不会恢复原任务，也不会自动重新生成。',
    confirmText: '已核对，允许新请求',
    action: () => useAgentStore.getState().acknowledgeImageRecovery(conversationId, call.id),
  })}>已核对，允许新的生成请求</button></div>}</div>
}

function AgentTask({ taskId, conversation }: { taskId: string; conversation: AgentConversation }) {
  const task = useStore((state) => state.tasks.find((item) => item.id === taskId))
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [added, setAdded] = useState(false)
  const [recovering, setRecovering] = useState(false)
  if (!task) return <div className="agent-task">图片任务记录已移除，附件仍保留在会话中。</div>
  const addToCanvas = async () => {
    setAdding(true)
    setAddError('')
    try {
      await executeAgentTool({ conversation, name: 'add_task_output', arguments: JSON.stringify({ taskId }), callId: crypto.randomUUID(), signal: new AbortController().signal })
      setAdded(true)
      useStore.getState().showToast('图片已放入画布', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入画布失败'
      setAddError(message)
      useStore.getState().showToast(message, 'error')
    } finally { setAdding(false) }
  }
  return <div className="agent-task">
    <div className="agent-task-heading"><span className={`agent-status-dot ${task.status === 'running' ? 'is-running' : ''}`} />{recovering ? '正在取回原请求结果，不会重新生成' : task.status === 'running' ? '图片正在生成，切换页面后仍会继续' : task.outputErrors?.length ? `成功 ${task.outputImages.length} 张，失败 ${task.outputErrors.length} 张（共 ${Math.max(task.params.n, task.outputImages.length + task.outputErrors.length)} 张）` : task.status === 'error' ? '图片生成未完成' : `已生成 ${task.outputImages.length} 张图片`}</div>
    {task.error && <p className="agent-error">{task.error}</p>}
    {task.outputErrors?.map((entry) => <p className="agent-error" key={entry.requestIndex}>第 {entry.requestIndex + 1} 张：{entry.error}</p>)}
    {task.outputImages.length > 0 && <div className="agent-result-images">{task.outputImages.map((id) => <AgentImage key={id} id={id} />)}</div>}
    {(task.status === 'error' || Boolean(task.outputErrors?.length)) && <button type="button" className="agent-text-button" onClick={() => useStore.getState().setDetailTaskId(taskId)}>查看结果与失败原因</button>}
    {isBackendAuthEnabled() && task.gouoPriceVersion && task.status === 'error' && !task.outputImages.length && <button type="button" className="agent-text-button" disabled={recovering} title="只取回原请求的图片，不会重新生成或扣费" onClick={() => {
      setRecovering(true)
      void executeTask(taskId, true).catch((error) => useStore.getState().showToast(error instanceof Error ? error.message : '取回结果失败', 'error')).finally(() => setRecovering(false))
    }}>取回原结果（不重新扣费）</button>}
    {task.status === 'done' && conversation.projectId && <button type="button" className="agent-text-button" disabled={adding} onClick={() => void addToCanvas()}>{adding ? '正在加入…' : added ? '已加入关联画布' : '加入关联画布'}</button>}
    {addError && <p role="alert" className="agent-error">{addError}</p>}
  </div>
}

export default function AgentWorkspace({ conversationId, onOpenConversation, onConversationReady, projectId, embedded = false }: {
  conversationId?: string
  onOpenConversation: (id: string) => void
  onConversationReady?: (id: string) => void
  projectId?: string
  embedded?: boolean
}) {
  const conversations = useAgentStore((state) => state.conversations)
  const models = useAgentStore((state) => state.models)
  const modelError = useAgentStore((state) => state.modelError)
  const modelsLoading = useAgentStore((state) => state.modelsLoading)
  const projects = useCanvasStore((state) => state.projects)
  const tasks = useStore((state) => state.tasks)
  const [localId, setLocalId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [, setImageModelReady] = useState(false)
  const creating = useRef<Promise<AgentConversation> | null>(null)
  const creatingForProject = useRef(projectId)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const id = conversationId || localId
  const conversation = conversations.find((item) => item.id === id && !item.hiddenAt)
  const running = conversation?.status === 'running'
  const started = Boolean(conversation?.messages.length)
  const model = models.find((item) => item.id === conversation?.modelId)
  const unavailableModel = Boolean(conversation?.modelId && !modelsLoading && !model)
  const history = conversations.filter((item) => !item.hiddenAt && item.messages.length).sort((left, right) => right.updatedAt - left.updatedAt)
  const linkedProject = projects.find((project) => project.id === conversation?.projectId && !project.hiddenAt)
  const referenceOptions = [...new Set([
    ...(linkedProject?.nodes.flatMap((node) => [node.metadata?.imageId, node.metadata?.storageKey, ...(node.metadata?.images?.map((image) => image.storageKey) || [])]).filter((imageId): imageId is string => !!imageId) || []),
    ...tasks.filter((task) => !task.cloudHiddenAt && task.outputImages.length).slice(0, 24).flatMap((task) => task.outputImages),
  ])].slice(0, 36)

  useEffect(() => {
    let disposed = false
    const initialize = async () => {
      await Promise.all([useAgentStore.getState().hydrate(), useCanvasStore.getState().hydrate(), useAgentStore.getState().loadModels()])
      if (disposed) return
      if (conversationId) {
        if (!useAgentStore.getState().conversations.some((item) => item.id === conversationId && !item.hiddenAt)) setLoadError('此会话不存在或已归档，请打开历史对话或创建新对话')
        else setLoadError('')
        return
      }
      if (creatingForProject.current !== projectId) {
        creatingForProject.current = projectId
        creating.current = null
      }
      if (!creating.current) {
        const existing = projectId && useAgentStore.getState().conversations.filter((item) => item.projectId === projectId && !item.hiddenAt).sort((left, right) => right.updatedAt - left.updatedAt)[0]
        creating.current = existing ? Promise.resolve(existing) : useAgentStore.getState().createConversation(projectId)
      }
      const created = await creating.current
      if (!disposed) {
        setLocalId(created.id)
        onConversationReady?.(created.id)
      }
    }
    void initialize().catch((error) => { if (!disposed) setLoadError(error instanceof Error ? error.message : '无法加载会话') })
    return () => { disposed = true }
  }, [conversationId, projectId, onConversationReady])

  useEffect(() => {
    if (conversation && !conversation.modelId && models[0]) useAgentStore.getState().configureConversation(conversation.id, { modelId: models[0].id })
  }, [conversation, models])

  useEffect(() => {
    const node = textarea.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(220, Math.max(64, node.scrollHeight))}px`
  }, [conversation?.draft])

  useEffect(() => {
    if (followBottom.current && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight
  }, [conversation?.messages])

  const newConversation = async () => {
    try {
      const created = await useAgentStore.getState().createConversation(projectId)
      creating.current = Promise.resolve(created)
      setLocalId(created.id)
      onOpenConversation(created.id)
    } catch (error) { setLoadError(error instanceof Error ? error.message : '创建会话失败') }
  }

  const send = async (text?: string) => {
    if (!conversation) return
    try {
      onOpenConversation(conversation.id)
      followBottom.current = true
      await useAgentStore.getState().send(conversation.id, text)
    } catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : '发送失败', 'error') }
  }

  const attachFiles = async (files: File[]) => {
    if (!conversation || running || uploading) return
    if (files.length + conversation.referenceImageIds.length > 16) { useStore.getState().showToast('最多添加 16 张参考图', 'error'); return }
    if (files.some((file) => !/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 25 * 1024 * 1024)) { useStore.getState().showToast('请上传 PNG、JPEG、WebP 或 GIF 图片，单张不超过 25 MB', 'error'); return }
    setUploading(true)
    try {
      const images = await Promise.all(files.map(async (file) => storeImageWithSize(await fileToDataUrl(file))))
      const current = useAgentStore.getState().conversations.find((item) => item.id === conversation.id)!
      useAgentStore.getState().configureConversation(conversation.id, { referenceImageIds: [...new Set([...current.referenceImageIds, ...images.map((image) => image.id)])] })
    } catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : '上传参考图失败', 'error') }
    finally { setUploading(false) }
  }

  const composer = <div className="agent-composer-region">
    {conversation?.referenceImageIds.length ? <div className="agent-attachments">{conversation.referenceImageIds.map((imageId) => <AgentImage key={imageId} id={imageId} onRemove={running ? undefined : () => useAgentStore.getState().configureConversation(id, { referenceImageIds: conversation.referenceImageIds.filter((value) => value !== imageId) })} />)}</div> : null}
    <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void send() }}
      onDragOver={(event) => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault() }}
      onDrop={(event) => { event.preventDefault(); void attachFiles([...event.dataTransfer.files]) }}>
      <div className="agent-composer-input">
        <button className="agent-upload-tile" type="button" aria-label="添加参考图片" disabled={running || uploading || !conversation} onClick={() => fileInput.current?.click()}><PlusIcon width={20} height={20} /></button>
        <textarea ref={textarea} aria-label="向 Agent 发送创作需求" placeholder="从一个想法开始，或上传参考图片。让 Agent 帮你构思、生成，或一起完善画布。" value={conversation?.draft || ''} maxLength={20_000} disabled={!conversation}
          onChange={(event) => useAgentStore.getState().updateDraft(id, event.target.value)}
          onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); void attachFiles(files) } }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!running && !uploading) void send() } }} />
      </div>
      <div className="agent-composer-footer">
        <span className="agent-mode"><SparklesIcon width={16} height={16} /> Agent</span>
        <div className="agent-model-select" title={model ? model.vision ? '可理解上传的参考图片' : '附件可用于图片生成，此对话模型不直接识图' : undefined}>
          <ModelSelect compact label="Agent 模型" models={models} value={conversation?.modelId || ''} disabled={running || modelsLoading || !conversation} placeholder={modelsLoading ? '正在加载…' : unavailableModel ? '原模型已不可用，请重新选择' : !models.length ? '暂无可用模型' : undefined} onChange={(modelId) => useAgentStore.getState().configureConversation(id, { modelId })} />
        </div>
        <button type="button" className={`agent-text-button ${showReferences ? 'is-active' : ''}`} aria-label="选择已有图片作为参考" aria-expanded={showReferences} disabled={running || !conversation} onClick={() => setShowReferences(!showReferences)}>@</button>
        <label className="agent-canvas-select"><span>画布</span><select aria-label="关联画布" value={conversation?.projectId || ''} disabled={running || !conversation} onChange={(event) => useAgentStore.getState().configureConversation(id, { projectId: event.target.value || undefined })}><option value="">未关联</option>{conversation?.projectId && !linkedProject && <option value={conversation.projectId} disabled>原画布已不可用</option>}{projects.filter((project) => !project.hiddenAt).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <span className="agent-composer-spacer" />
        {running ? <button type="button" className="agent-send agent-stop" aria-label="停止 Agent" title="停止对话；已提交的图片继续生成" onClick={() => useAgentStore.getState().stop(id)}><span /></button> : <button className="agent-send" type="submit" aria-label="发送" disabled={!conversation?.draft.trim() || uploading || !model || modelsLoading}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>}
      </div>
      <input hidden type="file" ref={fileInput} multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { void attachFiles([...event.target.files || []]); event.target.value = '' }} />
      {showReferences && <div className="agent-reference-picker"><p>画布素材与最近生成的图片</p><div>{referenceOptions.map((imageId) => <button type="button" key={imageId} aria-label={`引用图片 ${imageId.slice(0, 8)}`} aria-pressed={conversation?.referenceImageIds.includes(imageId)} onClick={() => {
        if (!conversation) return
        const refs = conversation.referenceImageIds
        if (!refs.includes(imageId) && refs.length >= 16) { useStore.getState().showToast('最多添加 16 张参考图', 'error'); return }
        useAgentStore.getState().configureConversation(id, { referenceImageIds: refs.includes(imageId) ? refs.filter((value) => value !== imageId) : [...refs, imageId] })
      }}><AgentImage id={imageId} /></button>)}{!referenceOptions.length && <span>暂无可引用的图片，可点 + 上传参考图。</span>}</div></div>}
    </form>
    {isBackendAuthEnabled() && <div className="agent-image-model-summary"><span>图片模型</span><BackendModelSelector compact onReady={setImageModelReady} /></div>}
    {(modelError || loadError) && <div role="alert" className="agent-inline-error">{modelError || loadError}<button type="button" onClick={() => void useAgentStore.getState().loadModels()}>刷新模型</button></div>}
    {unavailableModel && !modelError && <div role="alert" className="agent-inline-error">原 Agent 模型已不可用，请在下拉框重新选择后发送。</div>}
    {uploading && <p role="status" className="agent-composer-note">正在添加参考图…</p>}
    {!modelError && !loadError && <p className="agent-composer-note">Enter 发送，Shift + Enter 换行</p>}
  </div>

  return <section className={`agent-workspace ${started ? 'agent-started' : 'agent-empty'} ${embedded ? 'agent-embedded' : ''}`} aria-label="Agent 创作助手">
    <header className="agent-page-header">
      <h1>{started ? conversation?.title : 'Agent'}</h1>
      <div className="agent-page-actions"><details className="agent-history"><summary>历史对话</summary><div>{history.length ? history.map((item) => <button type="button" key={item.id} onClick={(event) => { onOpenConversation(item.id); event.currentTarget.closest('details')?.removeAttribute('open') }}>{item.title}<small>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small></button>) : <p>你的对话会显示在这里</p>}</div></details><button type="button" className="agent-text-button" onClick={() => void newConversation()}><PlusIcon width={16} height={16} />新对话</button></div>
    </header>
    {started ? <>
      <div ref={timeline} className="agent-timeline" onScroll={() => { const el = timeline.current; if (el) followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        <div className="agent-message-list" role="log" aria-label="会话消息">
          {conversation?.messages.map((message) => {
            if (message.role === 'tool') {
              const taskImages = new Set(tasks.filter((task) => message.taskIds?.includes(task.id)).flatMap((task) => task.outputImages))
              const attachments = (message.referenceImageIds || []).filter((imageId) => !taskImages.has(imageId))
              return <div className="agent-tool-results" key={message.id}>{message.taskIds?.map((taskId) => <AgentTask key={taskId} taskId={taskId} conversation={conversation} />)}{attachments.length && message.toolName !== 'select_reference' ? <div className="agent-attachments">{attachments.map((imageId) => <AgentImage key={imageId} id={imageId} />)}</div> : null}</div>
            }
            return <article className={`agent-message agent-message-${message.role}`} key={message.id}>
              {message.role === 'assistant' && <div className="agent-message-state">{running && message === conversation.messages[conversation.messages.length - 1] ? <><span className="agent-status-dot is-running" />正在创作</> : '光构 Agent'}</div>}
              {message.referenceImageIds?.length ? <div className="agent-attachments">{message.referenceImageIds.map((imageId) => <AgentImage key={imageId} id={imageId} />)}</div> : null}
              {message.content && <div className="agent-message-content">{message.content}</div>}
              {message.toolCalls?.map((call) => <ToolCall key={call.id || call.name} call={call} conversationId={conversation.id} running={running} />)}
              {message.role === 'assistant' && message.content && <div className="agent-message-actions"><button type="button" title="复制回复" aria-label="复制回复" onClick={() => { void navigator.clipboard.writeText(message.content).then(() => useStore.getState().showToast('已复制回复', 'success')).catch(() => useStore.getState().showToast('复制失败，请手动选择文字', 'error')) }}><CopyIcon width={15} height={15} /></button><span>内容由 AI 生成</span></div>}
            </article>
          })}
          {conversation?.error && <div role="alert" className="agent-run-error">{conversation.error}</div>}
          {!running && ['stopped', 'interrupted', 'error'].includes(conversation?.status || '') && <div className="agent-resume"><span>{conversation?.status === 'stopped' ? '已停止；已提交的图片任务继续生成。' : '内容已保留。'}已提交的任务请勿重复提交，尚未提交的步骤可继续完成。</span><button type="button" className="agent-text-button" disabled={!model} onClick={() => void send('请继续完成上一个请求。已提交的图片任务不要重复提交；明确尚未执行、尚未提交的步骤请继续完成。结果待核对的原请求不要重新提交。')}><RefreshIcon width={15} height={15} />继续对话</button></div>}
        </div>
      </div>
      <div className="agent-bottom-composer">{composer}</div>
    </> : <div className="agent-empty-content"><div className="agent-hero"><span>光构创作助手</span><h2>天马行空，尽情创作</h2><p>从灵感到画面，让想法一步步成形</p></div>{composer}<div className="agent-suggestions">{['帮我构思一组品牌海报', '为当前画布整理布局', '设计一个电影感画面'].map((prompt) => <button type="button" key={prompt} disabled={!conversation} onClick={() => { useAgentStore.getState().updateDraft(id, prompt); textarea.current?.focus() }}><span>/</span>{prompt}</button>)}</div></div>}
  </section>
}
