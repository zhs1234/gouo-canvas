import { createBackendSettings, isBackendAuthEnabled } from '../gouoBackend'
import type { AgentModel, AgentToolCall, AgentToolDefinition, ChatMessage } from './types'

export async function getAgentModels(): Promise<AgentModel[]> {
  if (!isBackendAuthEnabled()) throw new Error('Agent 需要启用光构平台服务，请先配置平台后端')
  const settings = await createBackendSettings()
  const base = settings.baseUrl!.replace(/\/v1\/?$/, '')
  const response = await fetch(`${base}/api/gouo/agent/models`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'X-Gouo-Token': settings.apiKey! },
  })
  const payload = await response.json()
  if (!response.ok || payload.success !== true) throw new Error(payload.message || `加载 Agent 模型失败（HTTP ${response.status}）`)
  if (!Array.isArray(payload.data) || payload.data.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return true
    const model = entry as Record<string, unknown>
    return typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.tool_calls !== 'boolean' || typeof model.vision !== 'boolean'
  })) throw new Error('Agent 模型目录格式无效')
  return payload.data.filter((model: AgentModel) => model.tool_calls)
}

// SSE 的分片可能切在中文字符、CRLF 或 tool arguments 中间，统一按完整事件消费。
export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (content: string, calls: AgentToolCall[]) => void,
  signal: AbortSignal,
): Promise<{ content: string; calls: AgentToolCall[] }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finished = false
  const calls = new Map<number, AgentToolCall>()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const consume = (event: string) => {
    const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || finished) return
    if (data.trim() === '[DONE]') { finished = true; return }
    const payload = JSON.parse(data)
    if (payload.error) throw new Error(typeof payload.error.message === 'string' ? payload.error.message : 'Agent 服务返回错误')
    const choice = payload.choices?.[0]
    if (!choice) return
    if (choice.finish_reason === 'length') throw new Error('回复达到模型长度上限，已保留内容，请手动继续')
    if (choice.finish_reason === 'content_filter') throw new Error('模型未能完成这次回复，请调整描述后重试')
    const delta = choice.delta || {}
    if (typeof delta.content === 'string') content += delta.content
    if (content.length > 200_000) throw new Error('Agent 回复超过长度上限')
    if (Array.isArray(delta.tool_calls)) {
      for (const fragment of delta.tool_calls) {
        if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index > 7) throw new Error('Agent 工具调用数量或格式无效')
        const current = calls.get(fragment.index) || { id: '', name: '', arguments: '', status: 'pending' as const }
        // ID 和工具名是同一次调用的元数据；兼容渠道可能在每帧重复返回。
        if (typeof fragment.id === 'string' && fragment.id) {
          if (current.id && current.id !== fragment.id) throw new Error('Agent 工具调用 ID 在流式响应中发生变化，已停止执行')
          current.id = fragment.id
        }
        if (typeof fragment.function?.name === 'string' && fragment.function.name) {
          if (current.name && current.name !== fragment.function.name) throw new Error('Agent 工具名在流式响应中发生变化，已停止执行')
          current.name = fragment.function.name
        }
        if (typeof fragment.function?.arguments === 'string') current.arguments += fragment.function.arguments
        if (current.id.length > 200) throw new Error('Agent 工具调用 ID 超过长度上限（200）')
        if (current.name.length > 100) throw new Error('Agent 工具名超过长度上限（100）')
        if (current.arguments.length > 100_000) throw new Error('Agent 工具参数超过长度上限（100000）')
        calls.set(fragment.index, current)
      }
    }
    onUpdate(content, [...calls.values()].map((call) => ({ ...call })))
    // 终态已包含完整回复；部分兼容渠道随后仍保持连接，不必等待 [DONE]。
    if (choice.finish_reason) finished = true
  }
  try {
    while (!finished) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let separator = buffer.indexOf('\n\n')
      while (separator >= 0) {
        consume(buffer.slice(0, separator))
        buffer = buffer.slice(separator + 2)
        separator = buffer.indexOf('\n\n')
      }
      if (buffer.length > 1_000_000) throw new Error('Agent 服务事件超过长度上限')
      if (chunk.done) {
        if (buffer.trim()) consume(buffer)
        break
      }
    }
    signal.throwIfAborted()
    if (!finished) throw new Error('连接意外中断，已保留收到的内容；请手动继续')
    const result = [...calls.values()]
    if (result.some((call) => !call.id || !call.name || !call.arguments)) throw new Error('Agent 工具调用不完整，已停止执行')
    if (new Set(result.map((call) => call.id)).size !== result.length) throw new Error('Agent 返回重复的工具调用标识')
    return { content, calls: result }
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function streamAgentCompletion(input: {
  model: string
  messages: ChatMessage[]
  tools: AgentToolDefinition[]
  signal: AbortSignal
  onUpdate: (content: string, calls: AgentToolCall[]) => void
}) {
  const settings = await createBackendSettings()
  input.signal.throwIfAborted()
  const response = await fetch(`${settings.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: input.model, messages: input.messages, tools: input.tools, stream: true, parallel_tool_calls: false }),
    signal: input.signal,
  })
  if (!response.ok) {
    let message = `Agent 请求失败（HTTP ${response.status}）`
    try {
      const error = await response.json()
      if (typeof error.error?.message === 'string') message = error.error.message
      else if (typeof error.message === 'string') message = error.message
    } catch { /* 非 JSON 的网关错误保留 HTTP 状态。 */ }
    throw new Error(message)
  }
  if (!response.body) throw new Error('浏览器无法读取 Agent 流式响应')
  return consumeChatStream(response.body, input.onUpdate, input.signal)
}
