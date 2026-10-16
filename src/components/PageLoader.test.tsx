import { Suspense, type ReactNode } from 'react'
import { prerender } from 'react-dom/static'
import { expect, it, vi } from 'vitest'
import { lazyPage, PageSkeleton } from './PageLoader'

async function render(node: ReactNode) {
  const { prelude } = await prerender(<Suspense fallback={<PageSkeleton />}>{node}</Suspense>)
  return new Response(prelude).text()
}

it('renders the lazily loaded page with its props', async () => {
  const Page = lazyPage(async () => ({ default: ({ name }: { name: string }) => <p>{`你好，${name}`}</p> }))
  expect(await render(<Page name="光构" />)).toContain('你好，光构')
})

it('shows a retry prompt instead of crashing when the module fails to load', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const Page = lazyPage<() => null>(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
  const html = await render(<Page />)
  expect(html).toContain('页面加载失败')
  expect(html).toContain('重试')
})
