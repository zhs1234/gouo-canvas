import { expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getTaskModelIds, sortTasksByCreatedAt, taskMatchesModel } from './taskFilters'

const task = (id: string, createdAt: number, apiModel?: string): TaskRecord => ({
  id,
  prompt: '',
  params: DEFAULT_PARAMS,
  apiModel,
  inputImageIds: [],
  outputImages: [],
  status: 'done',
  error: null,
  createdAt,
  finishedAt: createdAt,
  elapsed: 0,
})

const tasks = [task('b', 2, 'model-x'), task('a', 1, 'model-y'), task('c', 3, 'model-x'), task('d', 4)]

it('sorts works by newest or oldest without mutating the input', () => {
  expect(sortTasksByCreatedAt(tasks, 'newest').map((t) => t.id)).toEqual(['d', 'c', 'b', 'a'])
  expect(sortTasksByCreatedAt(tasks, 'oldest').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(tasks.map((t) => t.id)).toEqual(['b', 'a', 'c', 'd'])
})

it('filters works by model and lists used models by frequency', () => {
  expect(tasks.filter((t) => taskMatchesModel(t, 'model-x')).map((t) => t.id)).toEqual(['b', 'c'])
  expect(tasks.filter((t) => taskMatchesModel(t, '')).length).toBe(4)
  expect(getTaskModelIds(tasks)).toEqual(['model-x', 'model-y'])
})
