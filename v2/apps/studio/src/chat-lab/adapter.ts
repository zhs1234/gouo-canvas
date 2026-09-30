import type { ChatModelAdapter, ChatModelRunResult, ThreadMessageLike } from '@assistant-ui/react'
import { requestStream } from '../api'
import { readEventStream } from '../event-stream'

export type StudioEvent = { runId: string; type: string; delta?: string; toolCallId?: string; toolName?: string; outputSummary?: string; artifacts?: { type: string; url: string }[]; error?: { message: string }; usage?: unknown }
export type GeneratedImageReference = { runId: string; toolCallId: string; artifactIndex: number; url: string }
export type SavedRun = { runId: string; prompt: string; status: 'running' | 'completed' | 'failed' | 'unknown'; events: StudioEvent[]; usage?: unknown }
export type SavedThread = { id: string; title: string; updatedAt: string; nextOffset?: number | null; runs: SavedRun[] }
type Parts = NonNullable<ChatModelRunResult['content']>
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
    return [ { id: `${run.runId}-user`, role: 'user' as const, content: [{ type: 'text' as const, text: run.prompt }] },
      { id: run.runId, role: 'assistant' as const, content: content.length ? content : [{ type: 'text' as const, text: '尚未收到回复，任务结果待确认。' }],
        status: run.status === 'completed' ? { type: 'complete' as const, reason: 'stop' as const } : { type: 'incomplete' as const, reason: 'error' as const }, metadata: { custom: { runId: run.runId, usage: run.usage, generatedImages: generatedImages(run.events, run.runId) } } } ]
  })
}
// 线程上下文由服务端按 New API owner 读取，不上传客户端拼接的历史。
export function studioAdapter(model: string, imageModel: string | undefined, threadId: string, getLifetime: () => AbortSignal, finish: (completed: boolean) => void): ChatModelAdapter {
  return { async *run({ messages, abortSignal }) {
    if (!model) throw new Error('请先配置可用的聊天模型')
    const lifetime = getLifetime()
    const runId = crypto.randomUUID()
    let completed = false
    try {
      const response = await requestStream('/api/studio/runs/stream', {
        method: 'POST', signal: AbortSignal.any([abortSignal, lifetime]), headers: { 'Idempotency-Key': runId },
        body: JSON.stringify({ runId, model, threadId,
          prompt: messages[messages.length - 1].content.filter(p => p.type === 'text').map(p => p.text).join('\n'),
          sessionId: threadId, conversationId: threadId,
          ...(imageModel ? { imageGenerationPreference: { mode: 'manual', models: [imageModel] } } : {}),
        }),
      })
      let content: Parts = []
      const toolEvents: StudioEvent[] = []
      for await (const raw of readEventStream(response)) {
        lifetime.throwIfAborted()
        const event = raw as StudioEvent
        if (event.runId !== runId) throw new Error('收到不匹配的任务事件')
        content = appendEvent(content, event)
        if (event.type === 'tool.completed') toolEvents.push(event)
        if (event.type === 'run.failed') throw new Error(event.error?.message || '任务失败，费用请查看账号记录')
        completed ||= event.type === 'run.completed'
        yield { content, metadata: { custom: { runId, usage: event.usage, generatedImages: generatedImages(toolEvents, runId) } } }
      }
      if (!completed) throw new Error('连接中断，结果与费用待确认；不会自动重试')
    } finally { if (!lifetime.aborted) finish(completed) }
  } }
}
