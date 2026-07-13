import type { TaskRecord } from '../types'

export type TaskFilterStatus = 'all' | 'running' | 'done' | 'error' | 'pending' | 'sync_error' | 'hidden'

export function taskHasOutputErrors(task: Pick<TaskRecord, 'outputErrors'>) {
  return Boolean(task.outputErrors?.length)
}

export function taskMatchesFilterStatus(task: TaskRecord, filterStatus: TaskFilterStatus) {
  if (filterStatus === 'hidden') return Boolean(task.cloudHiddenAt)
  if (task.cloudHiddenAt) return false
  if (filterStatus === 'all') return true
  if (filterStatus === 'pending') return task.cloudSyncStatus === 'pending' || task.cloudSyncStatus === 'syncing'
  if (filterStatus === 'sync_error') return task.cloudSyncStatus === 'error'
  if (filterStatus === 'error') return task.status === 'error' || taskHasOutputErrors(task)
  return task.status === filterStatus
}

export function taskMatchesSearchQuery(task: TaskRecord, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const prompt = (task.prompt || '').toLowerCase()
  const paramStr = JSON.stringify(task.params).toLowerCase()
  const errorStr = [task.error, ...(task.outputErrors ?? []).map((item) => item.error)].filter(Boolean).join('\n').toLowerCase()
  return prompt.includes(q) || paramStr.includes(q) || errorStr.includes(q)
}
