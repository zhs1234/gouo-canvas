// Preserve Loomic's event contract over authenticated SSE and read-only HTTP.
// Original agent IDs live only for this mounted page; no token is persisted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StreamEvent, WsCommandAck, RunCreateRequest } from '../shared'
import { getIdentityEpoch, requestStream } from '../../api'
import { readEventStream } from '../../event-stream'
import { fetchCatalog } from '../lib/gateway'
import { createRequestResultReader, fetchMessages, fetchModels } from '../lib/server-api'
import { readDraft } from '../lib/local-drafts'
import { billingChanged, type StudioUsage } from '../lib/billing'
import { requestStatusMessage, type RequestRecovery, type RequestStatus } from '../lib/request-recovery'

type EventCallback = (event: StreamEvent) => void
export type RunReception = { runId: string; sessionId: string; status: RequestStatus | 'receiving' | 'interrupted' | 'not_submitted'; message: string }
type RecoveryCallback = (state: RunReception, result?: RequestRecovery) => void
export type WebSocketHandle = {
  connected: boolean
  runs: RunReception[]
  startRun: (payload: RunCreateRequest, onAck?: (ack: WsCommandAck) => void) => void
  cancelRun: (runId: string) => void
  recoverRun: (runId: string) => Promise<void>
  onEvent: (callback: EventCallback) => () => void
  onRecovery: (callback: RecoveryCallback) => () => void
}
export function useWebSocket(getOwner: () => string | null): WebSocketHandle {
  const owner = getOwner()
  const [connected, setConnected] = useState(false)
  const [runs, setRuns] = useState<RunReception[]>([])
  const listeners = useRef(new Set<EventCallback>())
  const recoveryListeners = useRef(new Set<RecoveryCallback>())
  const mounted = useRef(false)
  const active = useRef(new Map<string, { owner: string; epoch: number; controller: AbortController; state: RunReception }>())
  const reader = useMemo(() => createRequestResultReader(getOwner), [getOwner])
  const emit = useCallback((event: StreamEvent) => { for (const listener of listeners.current) listener(event) }, [])
  const publish = useCallback((id: string, status: RunReception['status'], message: string, result?: RequestRecovery) => {
    const run = active.current.get(id)
    if (!mounted.current || !run || run.owner !== getOwner() || run.epoch !== getIdentityEpoch()) return
    run.state = { ...run.state, status, message }
    setRuns([...active.current.values()].filter(r => r.owner === getOwner() && r.epoch === getIdentityEpoch()).map(r => r.state))
    for (const listener of recoveryListeners.current) listener(run.state, result)
  }, [getOwner])
  const recoverRun = useCallback(async (id: string) => {
    const run = active.current.get(id)
    if (!run || run.owner !== getOwner() || run.epoch !== getIdentityEpoch() || run.state.status === 'not_submitted' || run.state.status === 'receiving') return
    try {
      const result = await reader(run.owner, 'agent', id)
      publish(id, result.status, requestStatusMessage(result.status), result)
      if (mounted.current && run.owner === getOwner() && run.epoch === getIdentityEpoch()) {
        setConnected(true)
        if (result.result && 'events' in result.result) billingChanged(run.owner, result.result.usage)
      }
    } catch (error) {
      publish(id, run.state.status, '读取失败，已收到内容保留；未重新生成。' + (error instanceof Error ? ` ${error.message}` : ''))
    }
  }, [getOwner, publish, reader])
  useEffect(() => {
    mounted.current = true
    let disposed = false
    let check = 0
    const epoch = getIdentityEpoch()
    const probe = () => {
      const attempt = ++check
      if (!navigator.onLine) { setConnected(false); return }
      void fetchCatalog().then(() => { if (!disposed && attempt === check && owner === getOwner() && epoch === getIdentityEpoch()) setConnected(true) })
        .catch(() => { if (!disposed && attempt === check) setConnected(false) })
    }
    const offline = () => { ++check; setConnected(false) }
    const online = () => {
      probe()
      // A reconnect performs one GET per original interrupted request, no polling.
      for (const run of active.current.values()) if (['interrupted', 'running', 'unknown'].includes(run.state.status)) void recoverRun(run.state.runId)
    }
    probe()
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      mounted.current = false; disposed = true
      window.removeEventListener('offline', offline); window.removeEventListener('online', online)
      for (const run of active.current.values()) run.controller.abort()
      active.current.clear()
    }
  }, [owner, getOwner, recoverRun])
  const onEvent = useCallback((callback: EventCallback) => { listeners.current.add(callback); return () => { listeners.current.delete(callback) } }, [])
  const onRecovery = useCallback((callback: RecoveryCallback) => { recoveryListeners.current.add(callback); return () => { recoveryListeners.current.delete(callback) } }, [])
  const startRun = useCallback((payload: RunCreateRequest, onAck?: (ack: WsCommandAck) => void) => {
    const runId = crypto.randomUUID(), runOwner = getOwner(), epoch = getIdentityEpoch()
    if (!runOwner) throw new Error('本地对话尚未加载')
    const controller = new AbortController()
    if (runOwner) active.current.set(runId, { owner: runOwner, epoch, controller, state: { runId, sessionId: payload.sessionId, status: 'receiving', message: '' } })
    onAck?.({ type: 'command.ack', action: 'run.start', payload: { runId } } as WsCommandAck)
    publish(runId, 'receiving', '正在接收原请求')
    void (async () => {
      let usage: StudioUsage | undefined
      let submitted = false, terminal = false
      const assertOwner = () => { if (runOwner !== getOwner() || epoch !== getIdentityEpoch()) throw new Error('账号已变化，未继续原请求') }
      try {
        if (!runOwner || runOwner === 'local:guest') throw new Error('请先登录 New API 账号')
        const messages = (await fetchMessages(runOwner, payload.sessionId)).messages
        const canvas = await readDraft(runOwner, payload.canvasId || 'draft')
        const models = (await fetchModels()).models
        assertOwner(); controller.signal.throwIfAborted()
        const model = payload.model ?? models[0]?.id
        if (!model) throw new Error('尚未配置可用的对话模型，请先接通 New API 对话渠道')
        if (!models.some(m => m.id === model)) throw new Error('所选对话模型当前不可用，请重新选择 Agent 模型')
        const { accessToken: _discard, payWithBalance, ...safePayload } = payload
        submitted = true
        const result = await requestStream('/api/studio/runs/stream', {
          method: 'POST', signal: controller.signal, headers: { 'Idempotency-Key': runId },
          body: JSON.stringify({ ...safePayload, model, runId,
            ...(payWithBalance === true ? { payWithBalance: true } : {}),
            history: messages.slice(-12).filter(m => m.role === 'assistant' || m.content !== payload.prompt),
            canvasContext: canvas.canvas.content.elements.filter(e => !e.isDeleted).slice(0, 80).map(e => ({ id: e.id, type: e.type, text: e.text, x: e.x, y: e.y, width: e.width, height: e.height })),
          }),
        })
        for await (const value of readEventStream(result)) {
          controller.signal.throwIfAborted(); assertOwner()
          if (!mounted.current) return
          const event = value as StreamEvent
          if (!event || typeof event.type !== 'string' || (event.type === 'message.delta' && typeof event.delta !== 'string')) throw new Error('生成事件格式无效')
          if (event.runId !== runId) throw new Error('生成事件与当前请求不匹配')
          terminal = ['run.completed', 'run.failed', 'run.canceled'].includes(event.type)
          if (terminal) usage = (value as { usage?: StudioUsage }).usage
          emit(event)
          if (terminal) {
            publish(runId, event.type === 'run.canceled' ? 'interrupted' : 'completed', event.type === 'run.failed'
              ? '原请求已失败；已收到的图片保留，费用待核对。' : event.type === 'run.canceled'
                ? '后台报告停止事件，请读取原请求核对；费用仍需核对。' : '接收已结束；费用仍需核对。')
            break
          }
        }
        if (!terminal) throw new Error('连接已中断')
      } catch (error) {
        if (!mounted.current || runOwner !== getOwner() || epoch !== getIdentityEpoch()) return
        // Reception errors are not provider failure/cancellation StreamEvents.
        publish(runId, submitted ? 'interrupted' : 'not_submitted', submitted
          ? '已停止接收；后台可能仍在处理。已收到内容保留，请读取原请求，费用待核对。'
          : error instanceof Error ? error.message : '请求未发送')
        if (submitted && !controller.signal.aborted && navigator.onLine) void recoverRun(runId)
      } finally {
        if (mounted.current && runOwner && runOwner === getOwner() && epoch === getIdentityEpoch()) billingChanged(runOwner, usage)
      }
    })()
  }, [getOwner, emit, publish, recoverRun])
  const cancelRun = useCallback((id: string) => active.current.get(id)?.controller.abort(), [])
  return useMemo(() => ({ connected, runs: runs.filter(r => active.current.get(r.runId)?.owner === owner && active.current.get(r.runId)?.epoch === getIdentityEpoch()), startRun, cancelRun, recoverRun, onEvent, onRecovery }), [connected, owner, runs, startRun, cancelRun, recoverRun, onEvent, onRecovery])
}
