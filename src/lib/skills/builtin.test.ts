import { describe, expect, it } from 'vitest'
import { BUILTIN_SKILLS } from './builtin'
import { SKILL_NAME_PATTERN } from './parse'

describe('内置 skill', () => {
  it('都能解析，字段齐全，名称唯一且合规', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(9)
    expect(new Set(BUILTIN_SKILLS.map((skill) => skill.name)).size).toBe(BUILTIN_SKILLS.length)
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.name).toMatch(SKILL_NAME_PATTERN)
      expect(skill.name).not.toMatch(/anthropic|claude/)
      expect(skill.title).not.toBe(skill.name)
      expect(skill.description.length).toBeGreaterThanOrEqual(20)
      expect(skill.description.length).toBeLessThanOrEqual(300)
      expect(skill.license).toBeTruthy()
      expect(skill.source).toMatch(/^https:\/\//)
      // 正文完整注入系统提示，过长会被截断
      expect(skill.body.length).toBeLessThan(20_000)
      for (const file of skill.files) expect(file.path).toMatch(/^references\/[a-z0-9-]+\.md$/)
    }
  })
})
