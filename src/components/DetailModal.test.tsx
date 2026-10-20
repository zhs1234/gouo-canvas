import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import DetailModal from './DetailModal'

const state = vi.hoisted(() => ({
  tasks: [] as TaskRecord[],
  detailTaskId: 'task' as string | null,
  detailTaskList: ['task'] as string[],
  setDetailTaskId: vi.fn(),
  setLightboxImageId: vi.fn(),
  setConfirmDialog: vi.fn(),
  showToast: vi.fn(),
  settings: { zipBatchDownload: true },
}))

vi.mock('../store', () => ({
  useStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }),
  getCachedImage: () => '',
  ensureImageCached: vi.fn(async () => ''),
  reuseConfig: vi.fn(),
  editOutputs: vi.fn(),
  removeTask: vi.fn(),
  retryTask: vi.fn(),
  executeTask: vi.fn(),
  toggleTaskFavorite: vi.fn(),
}))
vi.mock('../hooks/useImageModels', () => ({ useImageModels: () => [] }))

function task(prompt: string, revised?: string): TaskRecord {
  return {
    id: 'task',
    prompt,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: revised === undefined ? [] : ['out'],
    revisedPromptByImage: revised === undefined ? undefined : { out: revised },
    status: 'done',
    error: null,
    createdAt: 0,
    finishedAt: 0,
    elapsed: 1,
  }
}

beforeEach(() => {
  state.detailTaskId = 'task'
  state.detailTaskList = ['task']
})

it('keeps internal-looking sentences in the original prompt and only cleans the revised prompt', () => {
  const prompt = 'Requested output image style: oil painting of a red apple.'
  state.tasks = [task(prompt, '一只橘猫 Requested output image size: 1024x1024.')]
  const markup = renderToStaticMarkup(<DetailModal />)
  expect(markup).toContain(prompt)
  expect(markup).not.toContain('(无提示词)')
  expect(markup).toContain('模型改写后的提示词')
  expect(markup).toContain('一只橘猫')
  expect(markup).not.toContain('Requested output image size: 1024x1024.')
})

it('hides a revised prompt that only appends an upstream parameter sentence', () => {
  const prompt = '一只橘猫坐在窗台上'
  state.tasks = [task(prompt, `${prompt} Requested output image size: 1024x1024.`)]
  const markup = renderToStaticMarkup(<DetailModal />)
  expect(markup).toContain(prompt)
  expect(markup).not.toContain('模型改写后的提示词')
  expect(markup).not.toContain('Requested output image size:')
})

it('does not show a rewrite when the original prompt already contains an internal sentence and the API echoes it', () => {
  const prompt = 'Draw a cat. Requested output image size: 1024x1024.'
  state.tasks = [task(prompt, prompt)]
  const markup = renderToStaticMarkup(<DetailModal />)
  expect(markup).toContain(prompt)
  expect(markup).not.toContain('模型改写后的提示词')
})
