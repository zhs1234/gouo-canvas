import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import TaskGrid from './TaskGrid'

const state = vi.hoisted(() => ({ tasks: [] as TaskRecord[], searchQuery: '', filterStatus: 'all', filterFavorite: false, activeFavoriteCollectionId: null, selectedTaskIds: [], clearSelection: () => {} }))
vi.mock('../store', () => ({ useStore: (select: (value: typeof state) => unknown) => select(state), ALL_FAVORITES_COLLECTION_ID: 'all', getTaskFavoriteCollectionIds: () => [], reuseConfig: vi.fn(), editOutputs: vi.fn(), removeTask: vi.fn() }))
vi.mock('../lib/serverLibrary', () => ({ restoreServerTask: vi.fn() }))
vi.mock('./TaskCard', () => ({ default: ({ task }: { task: TaskRecord }) => <span>{task.prompt}</span> }))

it('caps a thousand-task gallery at 60 cards while searching the complete library', () => {
  state.tasks = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), prompt: `图片 ${String(index).padStart(4, '0')}`, status: 'done', createdAt: index, inputImageIds: [], outputImages: [], params: DEFAULT_PARAMS, error: null, finishedAt: index, elapsed: 1 }))
  state.searchQuery = ''
  const page = renderToStaticMarkup(<TaskGrid />)
  expect(page.match(/class="task-card-wrapper"/g)).toHaveLength(60)
  expect(page).toContain('图片 0999')
  expect(page).not.toContain('图片 0000')
  state.searchQuery = '图片 0000'
  const filtered = renderToStaticMarkup(<TaskGrid />)
  expect(filtered.match(/class="task-card-wrapper"/g)).toHaveLength(1)
  expect(filtered).toContain('图片 0000')
  state.searchQuery = '不存在'
  expect(renderToStaticMarkup(<TaskGrid />)).toContain('没有找到匹配的任务')
})
