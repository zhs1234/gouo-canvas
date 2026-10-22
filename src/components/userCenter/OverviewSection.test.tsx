import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { GouoUser } from '../../lib/gouoBackend'

const mocks = vi.hoisted(() => ({ model: 'cheap' }))
vi.mock('../../store', () => ({ useStore: (select: (state: { settings: { model: string } }) => unknown) => select({ settings: { model: mocks.model } }) }))
vi.mock('../../lib/serverLibrary', () => ({ importLocalTasks: vi.fn() }))
vi.mock('../../lib/gouoBackend', async (importOriginal) => ({
  getImagePrice: (await importOriginal<typeof import('../../lib/gouoBackend')>()).getImagePrice,
  getCachedImageModels: () => [
    { id: 'default', name: '默认模型', price_cny: 0.5, default: true },
    { id: 'cheap', name: '便宜模型', price_cny: 0.2 },
    { id: 'ratio', name: '浮动模型', price_cny: 0.2, tier_ratios: { '2K': 2 }, quality_ratios: { high: 2.5, low: 0.5 } },
  ],
  getCloudStorage: vi.fn(),
  getImageModels: vi.fn(),
  getUsageLogs: vi.fn(),
  getUsageStat: vi.fn(),
}))

import OverviewSection from './OverviewSection'

const user = { id: 1, username: 'demo', balance_cny: 10, used_cny: 3, quota_cny_rate: 0.001 } as GouoUser
const render = () => renderToStaticMarkup(<OverviewSection user={user} loading={false} error="" onRefresh={() => {}} onNavigate={() => {}} onClose={() => {}} />)

it('按当前选择的图片模型估算余额可生成张数，模型不在目录时用默认模型', () => {
  expect(render()).toContain('约可生成 50 张 便宜模型')
  mocks.model = 'removed'
  expect(render()).toContain('约可生成 20 张 默认模型')
  // 有价格系数时按自动尺寸（1K）、自动画质（高）的单张价估算
  mocks.model = 'ratio'
  expect(render()).toContain('约可生成 20 张 浮动模型')
})
