import { describe, expect, it } from 'vitest'
import { getPageTitle, getWorkspacePage } from './workspaceRoutes'

const all = { canvasEnabled: true, agentEnabled: true }

describe('workspaceRoutes', () => {
  it('maps known paths to their navigation page', () => {
    expect(getWorkspacePage('/generate', all)).toBe('generate')
    expect(getWorkspacePage('/works', all)).toBe('works')
    expect(getWorkspacePage('/favorites/', all)).toBe('favorites')
    expect(getWorkspacePage('/inspiration', all)).toBe('inspiration')
    expect(getWorkspacePage('/agent', all)).toBe('agent')
    expect(getWorkspacePage('/agent/conv-1', all)).toBe('agent')
    expect(getWorkspacePage('/canvas', all)).toBe('canvas')
    expect(getWorkspacePage('/canvas/project-1', all)).toBe('canvas')
    expect(getWorkspacePage('/topup', all)).toBe('topup')
  })

  it('treats unknown paths and switched-off features as not found', () => {
    expect(getWorkspacePage('/abc', all)).toBeUndefined()
    expect(getWorkspacePage('/', all)).toBeUndefined()
    expect(getWorkspacePage('/toString', all)).toBeUndefined()
    expect(getWorkspacePage('/works/extra', all)).toBeUndefined()
    expect(getWorkspacePage('/canvas/a/b', all)).toBeUndefined()
    expect(getWorkspacePage('/canvas/project-1', { canvasEnabled: false, agentEnabled: true })).toBeUndefined()
    expect(getWorkspacePage('/agent', { canvasEnabled: true, agentEnabled: false })).toBeUndefined()
  })

  it('builds a per-page title and prefers the detail name', () => {
    expect(getPageTitle('works')).toBe('我的作品 · 光构')
    expect(getPageTitle('generate')).toBe('创作 · 光构')
    expect(getPageTitle('canvas', '春季海报')).toBe('春季海报 · 光构')
    expect(getPageTitle('canvas', '  ')).toBe('我的画布 · 光构')
    expect(getPageTitle(undefined)).toBe('页面不存在 · 光构')
  })
})
