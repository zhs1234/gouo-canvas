// Keep Loomic's event contract while using same-origin authenticated HTTP.
// Account tokens never appear in a WebSocket URL or in persisted run payloads.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StreamEvent, WsCommandAck, RunCreateRequest } from '../shared'
import { requestStream } from '../../api'
import { readEventStream } from '../../event-stream'
import { fetchCatalog } from '../lib/gateway'
import { fetchMessages, fetchModels } from '../lib/server-api'
import { readDraft } from '../lib/local-drafts'
import type { StudioUsage } from '../lib/billing'
type EventCallback = (event: StreamEvent) => void
export type WebSocketHandle = {
  connected: boolean
  startRun: (payload: RunCreateRequest, onAck?: (ack: WsCommandAck) => void) => void
  cancelRun: (runId: string) => void
  onEvent: (callback: EventCallback) => () => void
}
export function useWebSocket(getOwner: () => string | null): WebSocketHandle {
  const [connected, setConnected] = useState(false)
  const listeners = useRef(new Set<EventCallback>())
  const mounted = useRef(false)
  const active = useRef(new Map<string, AbortController>())
  const emit = useCallback((event: StreamEvent) => { for (const listener of listeners.current) listener(event) }, [])
  useEffect(() => {
    mounted.current = true
    let disposed = false
    fetchCatalog().then(() => { if (!disposed) setConnected(true) }).catch(() => setConnected(false))
    return () => { mounted.current = false; disposed = true; for (const controller of active.current.values()) controller.abort() }
  }, [])
  const onEvent = useCallback((callback: EventCallback) => { listeners.current.add(callback); return () => { listeners.current.delete(callback) } }, [])
  const startRun = useCallback((payload: RunCreateRequest, onAck?: (ack: WsCommandAck) => void) => {
    const runId = crypto.randomUUID()
    const controller = new AbortController(); active.current.set(runId, controller)
    onAck?.({ type: 'command.ack', action: 'run.start', payload: { runId } } as WsCommandAck)
    void (async () => {
      const owner = getOwner()
      let usage: StudioUsage | undefined
      let submitted = false
      let terminal = false
      try {
        if (!owner) throw new Error('本地对话尚未加载')
        if (owner === 'local:guest') throw new Error('请先登录 New API 账号')
        const messages = (await fetchMessages(owner, payload.sessionId)).messages
        const canvas = await readDraft(owner, payload.canvasId || 'draft')
        const models = (await fetchModels()).models
        controller.signal.throwIfAborted()
        const model = payload.model ?? models[0]?.id
        if (!model) throw new Error('尚未配置可用的对话模型，请先接通 New API 对话渠道')
        if (!models.some(m => m.id === model)) throw new Error('所选对话模型当前不可用，请重新选择 Agent 模型')
        const { accessToken: _discard, ...safePayload } = payload
        submitted = true
        const result = await requestStream('/api/studio/runs/stream', {
          method: 'POST', signal: controller.signal,
          headers: { 'Idempotency-Key': runId },
          body: JSON.stringify({ ...safePayload, model, runId,
            history: messages.slice(-12).filter(m => m.role === 'assistant' || m.content !== payload.prompt),
            canvasContext: canvas.canvas.content.elements.filter(e => !e.isDeleted).slice(0, 80).map(e => ({ id: e.id, type: e.type, text: e.text, x: e.x, y: e.y, width: e.width, height: e.height })),
          }),
        })
        for await (const value of readEventStream(result)) {
          controller.signal.throwIfAborted()
          if (!mounted.current || owner !== getOwner()) return
          const event = value as StreamEvent
          if (!event || typeof event.type !== 'string' || (event.type === 'message.delta' && typeof event.delta !== 'string')) throw new Error('生成事件格式无效')
          if (event.runId !== runId) throw new Error('生成事件与当前请求不匹配')
          terminal = ['run.completed', 'run.failed', 'run.canceled'].includes(event.type)
          if (terminal) usage = (value as { usage?: StudioUsage }).usage
          emit(event)
          if (terminal) break
        }
        if (!terminal) throw new Error('连接已中断，生成结果和费用待确认；请检查 New API 记录，不要重复提交。')
      } catch (error) {
        if (!mounted.current || owner !== getOwner()) return
        emit({ type: 'run.failed', runId, timestamp: new Date().toISOString(), error: { code: 'run_failed', message: controller.signal.aborted ? '已停止接收；后台可能仍在生成，结果和费用待确认，请勿重复提交。' : submitted && !(error instanceof Error && 'status' in error) ? '连接或生成事件异常，结果和费用待确认；请检查 New API 记录，不要重复提交。' : error instanceof Error ? error.message : '生成请求失败' } } as StreamEvent)
      } finally {
        active.current.delete(runId)
        if (mounted.current && owner && owner === getOwner()) window.dispatchEvent(new CustomEvent('gouo:billing-changed', { detail: { owner, usage } }))
      }
    })()
  }, [getOwner, emit])
  const cancelRun = useCallback((id: string) => active.current.get(id)?.abort(), [])
  return useMemo(() => ({ connected, startRun, cancelRun, onEvent }), [connected, startRun, cancelRun, onEvent])
}
