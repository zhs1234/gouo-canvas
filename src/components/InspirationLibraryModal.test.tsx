import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { INSPIRATION_PROMPTS } from '../lib/inspirationPrompts'
import InspirationLibraryModal, { InspirationLibraryPage } from './InspirationLibraryModal'

const mocks = vi.hoisted(() => ({ setPrompt: vi.fn(), showToast: vi.fn(), portal: vi.fn() }))
vi.mock('../store', () => ({ useStore: (select: (state: typeof mocks) => unknown) => select(mocks) }))
vi.mock('react-dom', async (original) => ({ ...await original<typeof import('react-dom')>(), createPortal: mocks.portal }))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('renders an independent library page without an overlay, close action or applying a template on mount', () => {
  const onApply = vi.fn()
  const markup = renderToStaticMarkup(<InspirationLibraryPage onApply={onApply} />)
  expect(markup).toContain('<main aria-label="灵感库">')
  expect(markup).toContain('<h1')
  expect(markup).toContain('搜索灵感')
  expect(markup.match(/inspiration-template-card/g)).toHaveLength(INSPIRATION_PROMPTS.length)
  expect(markup).not.toContain('role="dialog"')
  expect(markup).not.toContain('aria-modal')
  expect(markup).not.toContain('关闭灵感库')
  expect(markup).not.toContain('fixed inset-0')
  expect(mocks.portal).not.toHaveBeenCalled()
  expect(onApply).not.toHaveBeenCalled()
  expect(mocks.setPrompt).not.toHaveBeenCalled()
})

it('preserves the existing default modal entry for older callers', () => {
  vi.stubGlobal('document', { body: {} })
  mocks.portal.mockImplementation((content) => content)
  const markup = renderToStaticMarkup(<InspirationLibraryModal onClose={() => {}} />)
  expect(mocks.portal).toHaveBeenCalledOnce()
  expect(markup).toContain('role="dialog"')
  expect(markup).toContain('关闭灵感库')
})
