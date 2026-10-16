import type { TaskRecord } from '../types'

export type TaskFilterStatus = 'all' | 'running' | 'done' | 'error' | 'hidden'

export function taskHasOutputErrors(task: Pick<TaskRecord, 'outputErrors'>) {
  return Boolean(task.outputErrors?.length)
}

export function taskMatchesFilterStatus(task: TaskRecord, filterStatus: TaskFilterStatus) {
  if (filterStatus === 'hidden') return Boolean(task.cloudHiddenAt)
  if (task.cloudHiddenAt) return false
  if (filterStatus === 'all') return true
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

export type TaskSortOrder = 'newest' | 'oldest'

export function sortTasksByCreatedAt(tasks: TaskRecord[], order: TaskSortOrder) {
  return [...tasks].sort((a, b) => order === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
}

// 空字符串表示全部模型
export function taskMatchesModel(task: TaskRecord, model: string) {
  return !model || task.apiModel === model
}

// 按使用次数从多到少列出作品里用过的模型，供筛选下拉使用
export function getTaskModelIds(tasks: TaskRecord[]) {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (task.apiModel) counts.set(task.apiModel, (counts.get(task.apiModel) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}
