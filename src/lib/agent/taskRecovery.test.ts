import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../../types'
import { DEFAULT_PARAMS } from '../../types'
import type { AgentConversation } from './types'
import { reconcileAgentTasks } from './taskRecovery'

const conversation: AgentConversation = {
  id: 'conversation', schemaVersion: 1, title: '恢复测试', modelId: 'model', draft: '', referenceImageIds: [], status: 'interrupted', revision: 1, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'assistant', role: 'assistant', content: '', createdAt: 1, toolCalls: [{ id: 'call', name: 'create_image_task', arguments: '{}', status: 'error' }] }],
}
const task: TaskRecord = { id: 'task', requestId: 'agent:conversation:call', source: { kind: 'agent', conversationId: 'conversation' }, params: { ...DEFAULT_PARAMS, n: 2 }, status: 'done', outputImages: ['image'], outputErrors: [{ requestIndex: 1, error: '上游拒绝' }], error: null, prompt: '海报', inputImageIds: [], createdAt: 1, finishedAt: 2, elapsed: 1 }

describe('Agent image task reconciliation', () => {
  it.each(['pending', 'error'] as const)('records a proven unstarted %s call without suggesting that an image was submitted', (status) => {
    const saved = structuredClone(conversation)
    saved.messages[0].toolCalls![0] = { ...saved.messages[0].toolCalls![0], status, execution: 'not_started' }
    const recovered = reconcileAgentTasks(saved, [])
    expect(recovered.messages[0].toolCalls![0]).toMatchObject({ status: 'error', execution: 'not_started' })
    expect(recovered.messages[0].toolCalls![0].recovery).toBeUndefined()
    expect(JSON.parse(recovered.messages[1].content)).toMatchObject({ status: 'not_started', requestId: 'agent:conversation:call' })
    expect(recovered.messages[1].taskIds).toBeUndefined()
    expect(reconcileAgentTasks(recovered, [])).toBe(recovered)
  })

  it.each(['unconfirmed', 'acknowledged'] as const)('repairs the legacy repeated-ID parsing failure even after it was %s', (recovery) => {
    const saved = reconcileAgentTasks(conversation, [])
    const id = `call_${'a'.repeat(32)}`.repeat(5)
    saved.messages[0].toolCalls![0] = { ...saved.messages[0].toolCalls![0], id, arguments: '{"prompt":"画一只', recovery }
    saved.messages[1].toolCallId = id
    const repaired = reconcileAgentTasks(saved, [])
    expect(repaired.messages).toHaveLength(2)
    expect(repaired.messages[0].toolCalls![0]).toMatchObject({ id, execution: 'not_started', status: 'error' })
    expect(repaired.messages[0].toolCalls![0].recovery).toBeUndefined()
    expect(JSON.parse(repaired.messages[1].content)).toMatchObject({ status: 'not_started' })
    expect(reconcileAgentTasks(repaired, [])).toBe(repaired)
  })

  it.each(['null', '[]', '"prompt"'])('recognizes legacy %s arguments that cannot enter tool execution', (args) => {
    const saved = reconcileAgentTasks(conversation, [])
    saved.messages[0].toolCalls![0].arguments = args
    expect(reconcileAgentTasks(saved, []).messages[0].toolCalls![0].execution).toBe('not_started')
  })

  it('never infers no submission from a missing task after execution began', () => {
    const saved = structuredClone(conversation)
    saved.messages[0].toolCalls![0] = { ...saved.messages[0].toolCalls![0], arguments: '{', execution: 'started' }
    const recovered = reconcileAgentTasks(saved, [])
    expect(recovered.messages[0].toolCalls![0]).toMatchObject({ execution: 'started', recovery: 'unconfirmed' })
    expect(reconcileAgentTasks(recovered, [])).toBe(recovered)
  })

  it('does not repair legacy parse evidence while a conversation is still streaming', () => {
    const saved = reconcileAgentTasks(conversation, [])
    saved.status = 'running'
    saved.messages[0].toolCalls![0].arguments = '{'
    expect(reconcileAgentTasks(saved, [])).toBe(saved)
  })

  it('keeps an old valid JSON call uncertain even if its task cannot be found', () => {
    const saved = reconcileAgentTasks(conversation, [])
    saved.messages[0].toolCalls![0].arguments = '{"prompt":"海报"}'
    expect(reconcileAgentTasks(saved, [])).toBe(saved)
    expect(saved.messages[0].toolCalls![0].recovery).toBe('unconfirmed')
  })

  it('prioritizes an actual matching task over an incorrect unstarted marker', () => {
    const saved = structuredClone(conversation)
    saved.messages[0].toolCalls![0] = { ...saved.messages[0].toolCalls![0], arguments: '{', execution: 'not_started' }
    const recovered = reconcileAgentTasks(saved, [task])
    expect(recovered.messages[0].toolCalls![0]).toMatchObject({ execution: 'started', recovery: 'matched' })
    expect(recovered.messages[1].taskIds).toEqual(['task'])
  })

  it.each(['taskIds', 'result', 'matched'] as const)('preserves %s submission evidence when the original task has been deleted', (evidence) => {
    const saved = reconcileAgentTasks(conversation, [])
    saved.messages[0].toolCalls![0].arguments = '{'
    saved.messages[0].toolCalls![0].execution = 'not_started'
    if (evidence === 'taskIds') saved.messages[1].taskIds = ['deleted-task']
    if (evidence === 'result') saved.messages[0].toolCalls![0].result = '{"taskId":"deleted-task","status":"running"}'
    if (evidence === 'matched') saved.messages[0].toolCalls![0].recovery = 'matched'
    const recovered = reconcileAgentTasks(saved, [])
    expect(recovered.messages[0].toolCalls![0].execution).toBe('started')
    expect(recovered.messages[0].toolCalls![0].recovery).not.toBeUndefined()
    expect(JSON.parse(recovered.messages[1].content).status).not.toBe('not_started')
  })

  it('requires both request ID and originating conversation and does not steal other tasks', () => {
    const recovered = reconcileAgentTasks(conversation, [
      { ...task, id: 'other-source', source: { kind: 'agent', conversationId: 'another' } },
      { ...task, id: 'other-call', requestId: 'agent:conversation:other-call' },
    ])
    expect(recovered.messages[0].toolCalls?.[0].recovery).toBe('unconfirmed')
    expect(recovered.messages[1].taskIds).toBeUndefined()
    expect(recovered.messages[1].referenceImageIds).toEqual([])
    expect(reconcileAgentTasks(recovered, [])).toBe(recovered)
  })

  it('retains ambiguous duplicate request matches for review without choosing either task', () => {
    const recovered = reconcileAgentTasks(conversation, [task, { ...task, id: 'duplicate' }])
    expect(recovered.messages[1].taskIds).toBeUndefined()
    expect(recovered.messages[1].content).toContain('多个相同请求')
  })

  it('repairs a saved call result before its missing tool message and preserves partial failure details', () => {
    const saved = { ...conversation, messages: [{ ...conversation.messages[0], toolCalls: [{ ...conversation.messages[0].toolCalls![0], result: '{"taskId":"task"}' }] }] }
    const recovered = reconcileAgentTasks(saved, [task])
    expect(recovered.messages[1]).toMatchObject({ taskIds: ['task'], referenceImageIds: ['image'] })
    expect(JSON.parse(recovered.messages[1].content)).toMatchObject({ status: 'done', successCount: 1, failedCount: 1, requestedCount: 2, outputErrors: task.outputErrors })
    expect(reconcileAgentTasks(recovered, [task])).toBe(recovered)
  })

  it('keeps recovered attachments and confirmed submission when the user later deletes the task', () => {
    const recovered = reconcileAgentTasks(conversation, [task])
    const deleted = reconcileAgentTasks(recovered, [])
    expect(deleted).toBe(recovered)
    expect(deleted.messages[1].referenceImageIds).toEqual(['image'])
    expect(deleted.messages[0].toolCalls?.[0].recovery).toBe('matched')
  })

  it('does not reclassify a known validation failure as an uncertain paid request', () => {
    const saved = { ...conversation, messages: [{ ...conversation.messages[0], toolCalls: [{ ...conversation.messages[0].toolCalls![0], result: '{"error":"图片数量无效"}' }] }] }
    expect(reconcileAgentTasks(saved, [])).toBe(saved)
  })

  it('preserves explicit acknowledgement without making an original unresolved call executable again', () => {
    const unknown = reconcileAgentTasks(conversation, [])
    unknown.messages[0].toolCalls![0].recovery = 'acknowledged'
    expect(reconcileAgentTasks(unknown, [])).toBe(unknown)
    const later = reconcileAgentTasks(unknown, [task])
    expect(later.messages[0].toolCalls?.[0].recovery).toBe('acknowledged')
    expect(later.messages[1].taskIds).toEqual(['task'])
  })

  it('pins images while an Agent run is active without interpreting unfinished calls as crashes', () => {
    const active = { ...conversation, messages: [...conversation.messages, { id: 'tool', role: 'tool' as const, content: '{}', createdAt: 1, taskIds: ['task'] }] }
    const recovered = reconcileAgentTasks(active, [task], false)
    expect(recovered.messages[0]).toBe(active.messages[0])
    expect(recovered.messages[1].referenceImageIds).toEqual(['image'])
  })
})
