// Keep Loomic's event contract while using same-origin authenticated HTTP.
// Account tokens never appear in a WebSocket URL or in persisted run payloads.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StreamEvent, WsCommandAck, RunCreateRequest } from '../shared'
import { request } from '../../api'
import { fetchCatalog } from '../lib/gateway'
import { fetchMessages } from '../lib/server-api'
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
  const active = useRef(new Map<string, AbortController>())
  const emit = useCallback((event: StreamEvent) => { for (const listener of listeners.current) listener(event) }, [])
  useEffect(() => {
    let disposed = false
    fetchCatalog().then(() => { if (!disposed) setConnected(true) }).catch(() => setConnected(false))
    return () => { disposed = true; for (const controller of active.current.values()) controller.abort() }
  }, [])
  const onEvent = useCallback((callback: EventCallback) => { listeners.current.add(callback); return () => { listeners.current.delete(callback) } }, [])
  const startRun = useCallback((payload: RunCreateRequest, onAck?: (ack: WsCommandAck) => void) => {
    const runId = crypto.randomUUID()
    const controller = new AbortController(); active.current.set(runId, controller)
    onAck?.({ type: 'command.ack', action: 'run.start', payload: { runId } } as WsCommandAck)
    void (async () => {
      const owner = getOwner()
      let usage: StudioUsage | undefined
      try {
        if (!owner) throw new Error('本地对话尚未加载')
        const messages = (await fetchMessages(owner, payload.sessionId)).messages
        const canvas = await readDraft(owner, payload.canvasId || 'draft')
        const { accessToken: _discard, ...safePayload } = payload
        const result = await request<{ events: StreamEvent[]; usage?: StudioUsage }>('/api/studio/runs', {
          method: 'POST', signal: controller.signal,
          headers: { 'Idempotency-Key': runId },
          body: JSON.stringify({ ...safePayload, runId,
            history: messages.slice(-12).filter(m => m.role === 'assistant' || m.content !== payload.prompt),
            canvasContext: canvas.canvas.content.elements.filter(e => !e.isDeleted).slice(0, 80).map(e => ({ id: e.id, type: e.type, text: e.text, x: e.x, y: e.y, width: e.width, height: e.height })),
          }),
        })
        usage = result.usage
        for (const event of result.events) emit(event)
      } catch (error) {
        emit({ type: controller.signal.aborted ? 'run.canceled' : 'run.failed', runId, timestamp: new Date().toISOString(), error: { code: 'request_failed', message: error instanceof Error ? error.message : '生成请求失败' } } as StreamEvent)
      } finally {
        active.current.delete(runId)
        if (owner) window.dispatchEvent(new CustomEvent('gouo:billing-changed', { detail: { owner, usage } }))
      }
    })()
  }, [getOwner, emit])
  const cancelRun = useCallback((id: string) => active.current.get(id)?.abort(), [])
  return useMemo(() => ({ connected, startRun, cancelRun, onEvent }), [connected, startRun, cancelRun, onEvent])
}
