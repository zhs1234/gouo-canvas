export type AgentRunStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error' | 'interrupted'

export interface AgentModel {
  id: string
  name: string
  tool_calls: boolean
  vision: boolean
  input_price_cny?: number
  output_price_cny?: number
}

export interface AgentToolCall {
  id: string
  name: string
  arguments: string
  status: 'pending' | 'running' | 'done' | 'error'
  /** 进入工具执行前持久化 started；旧记录缺失时不能推断尚未提交。 */
  execution?: 'not_started' | 'started'
  result?: string
  /** 刷新后只读对账状态；未知结果不能自动重提图片任务。 */
  recovery?: 'matched' | 'unconfirmed' | 'acknowledged'
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
  referenceImageIds?: string[]
  toolCalls?: AgentToolCall[]
  toolCallId?: string
  toolName?: string
  taskIds?: string[]
}

export interface AgentConversation {
  id: string
  schemaVersion: 1
  title: string
  modelId: string
  projectId?: string
  messages: AgentMessage[]
  draft: string
  referenceImageIds: string[]
  status: AgentRunStatus
  error?: string
  createdAt: number
  updatedAt: number
  revision: number
  hiddenAt?: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface AgentToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
