import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ thumbnail: vi.fn() }))
vi.mock('../../store', () => ({ ensureImageCached: vi.fn() }))
vi.mock('../db', () => ({ getStoredFreshImageThumbnail: mocks.thumbnail }))

beforeEach(() => {
  vi.resetModules()
  mocks.thumbnail.mockReset().mockImplementation(async (id: string) => ({ thumbnailDataUrl: `preview:${id}` }))
})

describe('可见画布图片缓存', () => {
  it('401 张同时可见图片不在刷新时反复淘汰，离开后恢复缓存上限', async () => {
    const cache = await import('./imageStorage')
    const ids = Array.from({ length: 401 }, (_, index) => `image-${index}`)
    const owner = Symbol('viewport')
    cache.setCanvasImagePreviewOwner(owner, ids)
    for (let render = 0; render < 6; render += 1) {
      cache.setCanvasImagePreviewOwner(owner, ids)
      await Promise.all(ids.map((id) => cache.ensureCanvasImagePreview(id)))
      expect(ids.every((id) => cache.previewUrlFor(id))).toBe(true)
    }
    expect(mocks.thumbnail).toHaveBeenCalledTimes(401)
    cache.releaseCanvasImagePreviewOwner(owner)
    expect(ids.filter((id) => cache.previewUrlFor(id))).toHaveLength(400)
  })

  it('视口离开不淘汰资源侧栏仍使用的图片，卸载后清理超额缓存', async () => {
    const cache = await import('./imageStorage')
    const ids = Array.from({ length: 500 }, (_, index) => `image-${index}`)
    const canvas = Symbol('viewport')
    const sidebar = Symbol('sidebar')
    cache.setCanvasImagePreviewOwner(canvas, ids)
    cache.setCanvasImagePreviewOwner(sidebar, ids.slice(0, 60))
    await Promise.all(ids.map((id) => cache.ensureCanvasImagePreview(id)))
    cache.setCanvasImagePreviewOwner(canvas, [])
    expect(ids.slice(0, 60).every((id) => cache.previewUrlFor(id))).toBe(true)
    expect(ids.filter((id) => cache.previewUrlFor(id))).toHaveLength(400)
    cache.releaseCanvasImagePreviewOwner(canvas)
    cache.releaseCanvasImagePreviewOwner(sidebar)
  })
})
