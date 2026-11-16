import { describe, expect, it } from 'vitest'
import license from '../../public/inspiration-license.txt?raw'
import { INSPIRATION_CATEGORIES, INSPIRATION_PROMPTS, INSPIRATION_SOURCE } from './inspirationPrompts'

const previewImages = Object.keys(import.meta.glob('../../public/inspiration/*.webp')).map((path) => path.slice('../../public/'.length))

const templates = INSPIRATION_PROMPTS.filter((item) => item.kind !== 'case')
const cases = INSPIRATION_PROMPTS.filter((item) => item.kind === 'case')

describe('inspiration templates', () => {
  it('keeps a complete, attributed snapshot without duplicate templates or missing references', () => {
    expect(templates).toHaveLength(22)
    expect(new Set(INSPIRATION_PROMPTS.map((item) => item.id)).size).toBe(INSPIRATION_PROMPTS.length)
    expect(INSPIRATION_CATEGORIES).toHaveLength(14)
    for (const item of templates) {
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

  it('keeps featured cases attributed to their original authors with local preview images', () => {
    expect(cases).toHaveLength(23)
    for (const item of cases) {
      expect(item.id).toMatch(/^canghe-case-\d+$/)
      expect(item.prompt.trim()).not.toBe('')
      expect(item.description.trim()).not.toBe('')
      expect(item.tags.length).toBeGreaterThan(0)
      expect(INSPIRATION_CATEGORIES).toContain(item.category)
      expect(item.exampleUrl).toContain(`/blob/${INSPIRATION_SOURCE.revision}/docs/gallery-part-`)
      expect(item.sourceUrl).toBe(item.exampleUrl)
      expect(item.previewSourceLabel.trim()).not.toBe('')
      expect(new URL(item.previewSourceUrl).protocol).toBe('https:')
      expect(item.previewImage).toMatch(/^inspiration\/case\d+\.webp$/)
      expect(previewImages).toContain(item.previewImage)
      // 每张示例图都要在许可文件里有署名
      expect(license).toContain(`${item.previewImage.slice('inspiration/'.length)}: `)
    }
  })
})
