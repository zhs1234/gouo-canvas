import type { TaskRecord } from '../../types'
import type { AgentConversation, AgentMessage } from './types'

// 部分渠道的调用 ID 含 '.' 等字符，需与服务端请求 ID 规则保持一致；合法 ID 保持原样以兼容已存任务。
export function getAgentRequestId(conversationId: string, callId: string) {
  return `agent:${conversationId}:${callId.replace(/[^a-zA-Z0-9_:-]/g, '_')}`
}

export function getAgentTaskResult(task: TaskRecord) {
  return {
    taskId: task.id,
    status: task.status,
    outputImageIds: task.outputImages,
    requestedCount: Math.max(task.params.n, task.outputImages.length + (task.outputErrors?.length || 0)),
    successCount: task.outputImages.length,
    failedCount: task.outputErrors?.length || 0,
    outputErrors: task.outputErrors,
    error: task.error,
  }
}

// 只认领本会话、同一次工具请求的持久化任务；恢复本身不创建或执行任务。
export function reconcileAgentTasks(conversation: AgentConversation, tasks: TaskRecord[], recoverCalls = true): AgentConversation {
  const replacements = new Map<string, AgentMessage>()
  const additions = new Map<string, AgentMessage[]>()
  for (const message of recoverCalls ? conversation.messages : []) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) continue
    const calls = message.toolCalls.map((saved) => {
      if (saved.name !== 'create_image_task') return saved
      const existing = conversation.messages.find((entry) => entry.role === 'tool' && entry.toolCallId === saved.id)
      const requestId = getAgentRequestId(conversation.id, saved.id)
      const matches = tasks.filter((task) => task.requestId === requestId && task.source?.kind === 'agent' && task.source.conversationId === conversation.id)
      const task = matches.length === 1 ? matches[0] : undefined
      const submitted = matches.length > 0 || !!existing?.taskIds?.length || saved.recovery === 'matched' || [saved.result, existing?.content].some((raw) => {
        if (!raw) return false
        try {
          const result: unknown = JSON.parse(raw)
          if (!result || typeof result !== 'object' || Array.isArray(result)) return false
          const value = result as Record<string, unknown>
          return typeof value.taskId === 'string' && !!value.taskId || Array.isArray(value.taskIds) && value.taskIds.length > 0 || ['running', 'done', 'settled', 'needs_review'].includes(value.status as string)
        } catch { return false }
      })
      const call = submitted && saved.execution !== 'started' ? { ...saved, execution: 'started' as const } : saved
      let notStarted = !submitted && call.execution === 'not_started'
      // 旧版会把解析失败的 pending 调用误记为待核对；无效 JSON 在提交图片前必被拒绝。
      if (!submitted && !call.execution && call.status === 'error' && ['error', 'stopped', 'interrupted'].includes(conversation.status) && (call.recovery === 'unconfirmed' || call.recovery === 'acknowledged')) {
        try {
          const args: unknown = JSON.parse(call.arguments)
          notStarted = !args || typeof args !== 'object' || Array.isArray(args)
        } catch { notStarted = true }
      }
      if (!call.recovery && call.result !== undefined && existing?.taskIds?.length) return call
      if (notStarted) {
        const result = JSON.stringify({ status: 'not_started', requestId, error: '工具调用在执行前已中断，未提交图片任务。', message: '这次调用未执行，可继续提出图片生成需求。' })
        if (!existing || existing.content !== result) {
          const tool: AgentMessage = { ...existing, id: existing?.id || crypto.randomUUID(), role: 'tool', content: result, toolCallId: call.id, toolName: call.name, createdAt: existing?.createdAt || message.createdAt }
          if (existing) replacements.set(existing.id, tool)
          else additions.set(message.id, [...(additions.get(message.id) || []), tool])
        }
        return call.result === result && call.status === 'error' && call.execution === 'not_started' && !call.recovery ? call : { ...call, status: 'error' as const, execution: 'not_started' as const, result, recovery: undefined }
      }
      if (!task && call.recovery === 'acknowledged') return call
      if (!task && call.recovery === 'matched' && existing?.taskIds?.length) return call
      // 明确的工具校验失败不应变成“可能已扣费”。
      if (!task && !call.recovery && call.result !== undefined) return call
      const result = JSON.stringify(task ? {
        ...getAgentTaskResult(task),
        recovered: true,
        message: '已找回原图片任务，请查看或查询该任务，不要重复提交。',
      } : {
        status: 'unconfirmed', requestId,
        error: matches.length > 1 ? '发现多个相同请求的图片任务，结果待核对。' : '会话中断，尚未找到可确认的原图片任务。任务可能已提交或已删除，不能认定未扣费。',
        message: '请先在我的作品和用户中心核对原请求；未确认前不会再次提交图片。可继续讨论或使用其他工具。',
      })
      const taskIds = task ? [task.id] : existing?.taskIds
      const refs = [...new Set([...(existing?.referenceImageIds || []), ...(task?.outputImages || [])])]
      if (!existing || existing.content !== result || JSON.stringify(existing.taskIds) !== JSON.stringify(taskIds) || JSON.stringify(existing.referenceImageIds || []) !== JSON.stringify(refs)) {
        const tool: AgentMessage = {
          ...existing,
          id: existing?.id || crypto.randomUUID(), role: 'tool', content: result,
          toolCallId: call.id, toolName: call.name, createdAt: existing?.createdAt || message.createdAt,
          taskIds, referenceImageIds: refs,
        }
        if (existing) replacements.set(existing.id, tool)
        else additions.set(message.id, [...(additions.get(message.id) || []), tool])
      }
      const status = task ? 'done' : 'error'
      const recovery = call.recovery === 'acknowledged' ? 'acknowledged' : task ? 'matched' : 'unconfirmed'
      return call.result === result && call.status === status && call.recovery === recovery ? call : { ...call, status, result, recovery } as typeof call
    })
    if (calls.some((call, index) => call !== message.toolCalls![index])) replacements.set(message.id, { ...message, toolCalls: calls })
  }
  const messages = conversation.messages.flatMap((message) => {
    const current = replacements.get(message.id) || message
    const refs = [...new Set([...(current.referenceImageIds || []), ...(current.taskIds || []).flatMap((id) => tasks.find((task) => task.id === id)?.outputImages || [])])]
    const next = refs.length === (current.referenceImageIds?.length || 0) ? current : { ...current, referenceImageIds: refs }
    if (next !== message) replacements.set(message.id, next)
    return [next, ...(additions.get(message.id) || [])]
  })
  return replacements.size || additions.size ? { ...conversation, messages } : conversation
}
