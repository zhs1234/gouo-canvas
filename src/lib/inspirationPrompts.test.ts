import { describe, expect, it } from 'vitest'
import { INSPIRATION_CATEGORIES, INSPIRATION_PROMPTS, INSPIRATION_SOURCE } from './inspirationPrompts'

describe('inspiration templates', () => {
  it('keeps a complete, attributed snapshot without duplicate templates or missing references', () => {
    expect(INSPIRATION_PROMPTS).toHaveLength(22)
    expect(new Set(INSPIRATION_PROMPTS.map((item) => item.id)).size).toBe(INSPIRATION_PROMPTS.length)
    expect(INSPIRATION_CATEGORIES).toHaveLength(14)
    for (const item of INSPIRATION_PROMPTS) {
      expect(item.id).toMatch(/^canghe-template-/)
      expect(item.prompt.trim()).not.toBe('')
      expect(item.prompt).not.toContain('```')
      expect(item.guidance.length).toBeGreaterThan(0)
      expect(item.pitfalls.length).toBeGreaterThan(0)
      expect(INSPIRATION_CATEGORIES).toContain(item.category)
      expect(item.sourceUrl).toContain(`/blob/${INSPIRATION_SOURCE.revision}/docs/templates.md#tpl-`)
      expect(item.exampleUrl).toContain(`/blob/${INSPIRATION_SOURCE.revision}/docs/gallery-part-`)
      expect(item.previewSourceLabel.trim()).not.toBe('')
      expect(new URL(item.previewSourceUrl).protocol).toBe('https:')
      expect(item.previewImage).toMatch(/^inspiration\/case\d+\.webp$/)
      expect(item.referenceCount).toBe(['canghe-template-personalized-beauty-report', 'canghe-template-3d-collectible-toy'].includes(item.id) ? 1 : 0)
    }
  })
})
