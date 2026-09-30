import type { ChatModelAdapter, ChatModelRunResult } from '@assistant-ui/react'
import { requestStream } from '../api'
import { readEventStream } from '../event-stream'

// 只适配 Studio 事件；鉴权、渠道、费用仍由现有业务后端负责。
export function studioAdapter(model: string, imageModel?: string): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, unstable_threadId }) {
      if (!model) throw new Error('请先配置可用的聊天模型')
      const textOf = (message: typeof messages[number]) => message.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
      const runId = crypto.randomUUID()
      const response = await requestStream('/api/studio/runs/stream', {
        method: 'POST', signal: abortSignal, headers: { 'Idempotency-Key': runId },
        body: JSON.stringify({ runId, model, prompt: textOf(messages[messages.length - 1]),
          sessionId: unstable_threadId || runId, conversationId: unstable_threadId || runId,
          history: messages.slice(0, -1).filter(m => m.role !== 'system').slice(-12).map(m => ({ role: m.role, content: textOf(m).slice(0, 8000) })),
          ...(imageModel ? { imageGenerationPreference: { mode: 'manual', models: [imageModel] } } : {}),
        }),
      })
      let content: NonNullable<ChatModelRunResult['content']> = []
      let completed = false
      for await (const raw of readEventStream(response)) {
        const event = raw as { runId: string; type: string; delta?: string; toolCallId?: string; toolName?: string; outputSummary?: string; artifacts?: { type: string; url: string }[]; error?: { message: string }; usage?: unknown }
        if (event.runId !== runId) throw new Error('收到不匹配的任务事件')
        if (event.type === 'message.delta') {
          const last = content.at(-1)
          content = last?.type === 'text' ? [...content.slice(0, -1), { type: 'text', text: last.text + (event.delta || '') }] : [...content, { type: 'text', text: event.delta || '' }]
        }
        if (event.type === 'tool.started') content = [...content, { type: 'tool-call', toolCallId: event.toolCallId!, toolName: event.toolName!, args: {}, argsText: '{}' }]
        if (event.type === 'tool.completed') {
          content = content.map(p => p.type === 'tool-call' && p.toolCallId === event.toolCallId ? { ...p, result: event.outputSummary || '完成' } : p)
          for (const artifact of event.artifacts || []) if (artifact.type === 'image' && /^data:image\/(png|jpeg|webp);base64,/.test(artifact.url)) content = [...content, { type: 'image', image: artifact.url }]
        }
        if (event.type === 'run.failed') throw new Error(event.error?.message || '任务失败，费用请查看账号记录')
        completed ||= event.type === 'run.completed'
        yield { content, metadata: { custom: { runId, usage: event.usage } } }
      }
      if (!completed) throw new Error('连接中断，结果与费用待确认；不会自动重试')
    },
  }
}
