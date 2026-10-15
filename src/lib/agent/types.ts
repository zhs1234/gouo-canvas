type AgentRunStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error' | 'interrupted'

export interface AgentModel {
  id: string
  vision: boolean
  // 后台“光构设置”指定的默认 Agent 模型
  default?: boolean
  // 后台填写的一句话说明
  description?: string
  billing_mode?: 'ratio' | 'tiered_expr' | 'per_request'
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
  reasoning?: string
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
  // 输入框选择的每次生成张数，Agent 没有另行指定时按它提交；旧会话没有此字段，按 1 张
  imageCount?: number
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
  reasoning_content?: string
}

export interface AgentToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}
