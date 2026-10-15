import { backendFetch } from '../gouoBackend'
import type { AgentModel, AgentToolCall, AgentToolDefinition, ChatMessage } from './types'

// 每条用户消息最多工具轮数、单条消息需确认的图片张数，由后台“光构设置”下发；读取目录前按后台默认值
let agentLimits = { maxRounds: 8, confirmImages: 4 }

export function getAgentLimits() {
  return agentLimits
}

// 目录同时带回运营方在后台填写的附加提示词和 Agent 限制
export async function getAgentModels(): Promise<{ models: AgentModel[]; systemPrompt: string }> {
  const response = await backendFetch('/api/gouo/agent/models')
  const payload = await response.json()
  if (!response.ok || payload.success !== true) throw new Error(payload.message || `加载 Agent 模型失败（HTTP ${response.status}）`)
  if (!Array.isArray(payload.data) || payload.data.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return true
    const model = entry as Record<string, unknown>
    return typeof model.id !== 'string' || typeof model.vision !== 'boolean'
  })) throw new Error('Agent 模型目录格式无效')
  agentLimits = {
    maxRounds: Number.isInteger(payload.max_rounds) && payload.max_rounds >= 1 ? payload.max_rounds : agentLimits.maxRounds,
    confirmImages: Number.isInteger(payload.confirm_images) && payload.confirm_images >= 1 ? payload.confirm_images : agentLimits.confirmImages,
  }
  return { models: payload.data as AgentModel[], systemPrompt: typeof payload.system_prompt === 'string' ? payload.system_prompt.trim() : '' }
}

// SSE 的分片可能切在中文字符、CRLF 或 tool arguments 中间，统一按完整事件消费。
export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (content: string, calls: AgentToolCall[], reasoning?: string) => void,
  signal: AbortSignal,
): Promise<{ content: string; calls: AgentToolCall[]; reasoning?: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finished = false
  const calls: AgentToolCall[] = []
  const slots = new Map<number, AgentToolCall>()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const consume = (event: string) => {
    const data = event.trimStart().startsWith('{') ? event : event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || finished) return
    if (data.trim() === '[DONE]') { finished = true; return }
    const payload = JSON.parse(data)
    if (payload.error) throw new Error(typeof payload.error.message === 'string' ? payload.error.message : 'Agent 服务返回错误')
    const choice = payload.choices?.[0]
    if (!choice) return
    if (choice.finish_reason === 'length') throw new Error('回复达到模型长度上限，已保留内容，请手动继续')
    if (choice.finish_reason === 'content_filter') throw new Error('模型未能完成这次回复，请调整描述后重试')
    const delta = choice.delta || choice.message || {}
    const thought = delta.reasoning_content ?? delta.reasoning
    if (typeof thought === 'string') reasoning += thought
    if (reasoning.length > 200_000) throw new Error('Agent 思考过程超过长度上限')
    if (typeof delta.content === 'string') content += delta.content
    if (content.length > 200_000) throw new Error('Agent 回复超过长度上限')
    if (Array.isArray(delta.tool_calls)) {
      for (const [idx, fragment] of delta.tool_calls.entries()) {
        const index = choice.message ? idx : fragment.index
        if (!Number.isInteger(index) || index < 0 || index > 7) throw new Error('Agent 工具调用数量或格式无效')
        let current = slots.get(index)
        // 旧版 Claude 转换让同一回复的多个调用共用 index，同一 index 出现新 ID 视为下一个调用
        if (!current || (typeof fragment.id === 'string' && fragment.id && current.id && current.id !== fragment.id)) {
          if (calls.length >= 8) throw new Error('Agent 工具调用数量或格式无效')
          current = { id: '', name: '', arguments: '', status: 'pending' as const }
          calls.push(current)
          slots.set(index, current)
        }
        // ID 和工具名是同一次调用的元数据；兼容渠道可能在每帧重复返回。
        if (typeof fragment.id === 'string' && fragment.id) current.id = fragment.id
        if (typeof fragment.function?.name === 'string' && fragment.function.name) {
          if (current.name && current.name !== fragment.function.name) throw new Error('Agent 工具名在流式响应中发生变化，已停止执行')
          current.name = fragment.function.name
        }
        if (typeof fragment.function?.arguments === 'string') current.arguments += fragment.function.arguments
        if (current.id.length > 200) throw new Error('Agent 工具调用 ID 超过长度上限（200）')
        if (current.name.length > 100) throw new Error('Agent 工具名超过长度上限（100）')
        if (current.arguments.length > 100_000) throw new Error('Agent 工具参数超过长度上限（100000）')
      }
    }
    onUpdate(content, calls.map((call) => ({ ...call })), reasoning || undefined)
    // 终态已包含完整回复；部分兼容渠道随后仍保持连接，不必等待 [DONE]。
    if (choice.finish_reason || choice.message) finished = true
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
    const result = calls
    if (result.some((call) => !call.id || !call.name || !call.arguments)) throw new Error('Agent 工具调用不完整，已停止执行')
    if (new Set(result.map((call) => call.id)).size !== result.length) throw new Error('Agent 返回重复的工具调用标识')
    return { content, calls: result, ...(reasoning ? { reasoning } : {}) }
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
  onUpdate: (content: string, calls: AgentToolCall[], reasoning?: string) => void
}) {
  input.signal.throwIfAborted()
  // 走 New API 原生 Playground，用登录会话鉴权；X-Gouo-Agent 让服务端套用光构的 Agent 开关和回复上限
  const response = await backendFetch('/pg/chat/completions', {
    method: 'POST',
    headers: { 'X-Gouo-Agent': '1' },
    body: JSON.stringify({ model: input.model, messages: input.messages, tools: input.tools, stream: true, stream_options: { include_usage: true }, parallel_tool_calls: false }),
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
