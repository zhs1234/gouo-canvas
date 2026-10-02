import type { ChatModelAdapter, ChatModelRunResult, ThreadMessageLike } from '@assistant-ui/react'
import { ApiError, requestStream } from '../api'
import { readEventStream } from '../event-stream'

export type StudioEvent = { runId: string; type: string; delta?: string; toolCallId?: string; toolName?: string; outputSummary?: string; artifacts?: { type: string; url: string }[]; error?: { message: string }; usage?: unknown }
export type GeneratedImageReference = { runId: string; toolCallId: string; artifactIndex: number; url: string }
export type SavedRun = { runId: string; prompt: string; status: 'running' | 'completed' | 'failed' | 'unknown'; events: StudioEvent[]; usage?: unknown }
export type ThreadMetadata = { id: string; title: string; createdAt?: string; updatedAt: string }
export type SavedThread = ThreadMetadata & { nextOffset?: number | null; runs: SavedRun[] }
type Parts = NonNullable<ChatModelRunResult['content']>
export type PublicFailure = { message: string; walletSuggested: boolean }
function publicFailure(message: string, status?: number): PublicFailure {
  const safeMessage = message.trim().slice(0, 500) || '任务结果待确认，请核对原生记录'
  return { message: safeMessage, walletSuggested: status === 402 || /试用|次数.*用完|余额不足|充值|钱包/.test(safeMessage) }
}
export function readPublicFailure(value: unknown): PublicFailure | undefined {
  if (!value || typeof value !== 'object') return
  const failure = value as Partial<PublicFailure>
  if (typeof failure.message !== 'string' || !failure.message || failure.message.length > 500 || typeof failure.walletSuggested !== 'boolean') return
  return { message: failure.message, walletSuggested: failure.walletSuggested }
}
export function appendEvent(content: Parts, event: StudioEvent): Parts {
  if (event.type === 'message.delta') {
    const last = content.at(-1)
    return last?.type === 'text' ? [...content.slice(0, -1), { type: 'text', text: last.text + (event.delta || '') }] : [...content, { type: 'text', text: event.delta || '' }]
  }
  if (event.type === 'tool.started') return content.some(part => part.type === 'tool-call' && part.toolCallId === event.toolCallId) ? content : [...content, { type: 'tool-call', toolCallId: event.toolCallId!, toolName: event.toolName!, args: {}, argsText: '{}' }]
  if (event.type === 'tool.completed') {
    content = content.map(p => p.type === 'tool-call' && p.toolCallId === event.toolCallId ? { ...p, result: event.outputSummary || '完成' } : p)
    for (const artifact of event.artifacts || []) if (artifact.type === 'image' && /^data:image\/(png|jpeg|webp);base64,/.test(artifact.url) && !content.some(part => part.type === 'image' && part.image === artifact.url)) content = [...content, { type: 'image', image: artifact.url }]
  }
  return content
}
export function generatedImages(events: StudioEvent[], runId: string): GeneratedImageReference[] {
  const references = new Map<string, GeneratedImageReference>()
  for (const event of events) {
    if (event.type !== 'tool.completed' || !event.toolCallId) continue
    for (const [artifactIndex, artifact] of (event.artifacts || []).entries()) {
      if (artifact.type !== 'image' || !/^data:image\/(png|jpeg|webp);base64,/.test(artifact.url)) continue
      const reference = { runId, toolCallId: event.toolCallId, artifactIndex, url: artifact.url }
      references.set(`${event.toolCallId}:${artifactIndex}`, reference)
    }
  }
  return [...references.values()]
}
export function restoreMessages(thread: SavedThread): ThreadMessageLike[] {
  return thread.runs.flatMap(run => {
    const content = run.events.reduce(appendEvent, [] as Parts)
    const failed = [...run.events].reverse().find(event => event.type === 'run.failed')
    const failure = failed ? publicFailure(failed.error?.message || '任务失败或结果待确认，请核对原生记录')
      : run.status !== 'completed' ? publicFailure(run.status === 'running' ? '任务仍在处理，刷新只查询原任务。' : '任务结果待确认，请核对原生记录。') : undefined
    return [ { id: `${run.runId}-user`, role: 'user' as const, content: [{ type: 'text' as const, text: run.prompt }] },
      { id: run.runId, role: 'assistant' as const, content: content.length ? content : [{ type: 'text' as const, text: '尚未收到回复，任务结果待确认。' }],
        status: run.status === 'completed' ? { type: 'complete' as const, reason: 'stop' as const } : { type: 'incomplete' as const, reason: 'error' as const }, metadata: { custom: { runId: run.runId, usage: run.usage, generatedImages: generatedImages(run.events, run.runId), ...(failure ? { publicFailure: failure } : {}) } } } ]
  })
}
// 线程上下文由服务端按 New API owner 读取，不上传客户端拼接的历史。
export function studioAdapter(model: string, imageModel: string | undefined, threadId: string, getLifetime: () => AbortSignal, finish: (completed: boolean) => void, consumeBalanceConsent: () => boolean = () => false): ChatModelAdapter {
  return { async *run({ messages, abortSignal }) {
    if (!model) throw new Error('请先配置可用的聊天模型')
    const lifetime = getLifetime()
    const runId = crypto.randomUUID()
    const payWithBalance = consumeBalanceConsent()
    let completed = false
    let content: Parts = []
    const toolEvents: StudioEvent[] = []
    let usage: unknown
    let failure: PublicFailure | undefined
    try {
      const response = await requestStream('/api/studio/runs/stream', {
        method: 'POST', signal: AbortSignal.any([abortSignal, lifetime]), headers: { 'Idempotency-Key': runId },
        body: JSON.stringify({ runId, model, threadId,
          ...(payWithBalance ? { payWithBalance: true } : {}),
          prompt: messages[messages.length - 1].content.filter(p => p.type === 'text').map(p => p.text).join('\n'),
          sessionId: threadId, conversationId: threadId,
          ...(imageModel ? { imageGenerationPreference: { mode: 'manual', models: [imageModel] } } : {}),
        }),
      })
      for await (const raw of readEventStream(response)) {
        lifetime.throwIfAborted()
        const event = raw as StudioEvent
        if (event.runId !== runId) throw new Error('收到不匹配的任务事件')
        content = appendEvent(content, event)
        if (event.type === 'tool.completed') toolEvents.push(event)
        if (event.usage !== undefined) usage = event.usage
        if (event.type === 'run.failed') { failure = publicFailure(event.error?.message || '任务失败，费用请查看账号记录'); throw new Error(failure.message) }
        completed ||= event.type === 'run.completed'
        yield { content, metadata: { custom: { runId, usage, generatedImages: generatedImages(toolEvents, runId) } } }
      }
      if (!completed) throw new Error('连接中断，结果与费用待确认；不会自动重试')
    } catch (error) {
      // Never replace partial replies or completed tools, and never publish raw
      // transport/parser exceptions. Server envelopes/events are public errors.
      if (!lifetime.aborted) {
        failure ??= error instanceof ApiError ? publicFailure(error.message, error.status)
          : publicFailure(abortSignal.aborted ? '已停止接收，任务结果与费用仍待确认。' : '连接中断，任务结果与费用待确认。')
        yield { content, metadata: { custom: { runId, usage, generatedImages: generatedImages(toolEvents, runId), publicFailure: failure } } }
      }
      throw error
    } finally { if (!lifetime.aborted) finish(completed) }
  } }
}
