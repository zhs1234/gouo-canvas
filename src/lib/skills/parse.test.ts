import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown, SKILL_NAME_PATTERN, suffixSkillName } from './parse'

describe('parseSkillMarkdown', () => {
  it('解析常见 frontmatter 写法', () => {
    const parsed = parseSkillMarkdown(`﻿---\r\nname: poster-design\r\ndescription: "海报设计：先写理念，再写提示词"\r\nlicense: Apache-2.0\r\nmetadata:\r\n  title: 海报与艺术设计\r\n  source: 'https://example.com/a, https://example.com/b'\r\nallowed-tools: Bash\r\n---\r\n\r\n# 海报\r\n正文\r\n`)
    expect(parsed).toEqual({
      name: 'poster-design',
      description: '海报设计：先写理念，再写提示词',
      license: 'Apache-2.0',
      metadata: { title: '海报与艺术设计', source: 'https://example.com/a, https://example.com/b' },
      body: '# 海报\n正文',
      warnings: [],
    })
  })

  it('支持块文本 description，值里未加引号的冒号保留原样', () => {
    expect(parseSkillMarkdown('---\nname: a\ndescription: >-\n  第一行\n  第二行\n---\n正文').description).toBe('第一行 第二行')
    expect(parseSkillMarkdown('---\nname: a\ndescription: |\n  第一行\n  第二行\n---\n正文').description).toBe('第一行\n第二行')
    // 普通值换行续写也是合法 YAML，后续缩进行要接上
    expect(parseSkillMarkdown('---\nname: a\ndescription: Use this skill when\n  the user wants a poster\nlicense: MIT\n---\n正文')).toMatchObject({ description: 'Use this skill when the user wants a poster', license: 'MIT' })
    expect(parseSkillMarkdown('---\nname: a\ndescription: "第一行\n  第二行"\n---\n正文').description).toBe('第一行 第二行')
    expect(parseSkillMarkdown('---\nname: a\ndescription: 用途: 生成海报\n---\n正文').description).toBe('用途: 生成海报')
  })

  it('名字不规范时规整并警告，缺少必需字段时拒绝', () => {
    const parsed = parseSkillMarkdown('---\nname: Poster_Design!\ndescription: x\n---\n正文')
    expect(parsed.name).toBe('poster-design')
    expect(parsed.warnings[0]).toContain('poster-design')
    expect(parseSkillMarkdown(`---\nname: a\ndescription: ${'长'.repeat(1100)}\n---\n正文`).description).toHaveLength(1024)
    expect(() => parseSkillMarkdown('# 没有 frontmatter')).toThrow('frontmatter')
    expect(() => parseSkillMarkdown('---\ndescription: x\n---\n正文')).toThrow('缺少 name')
    expect(() => parseSkillMarkdown('---\nname: a\n---\n正文')).toThrow('缺少 description')
    expect(() => parseSkillMarkdown('---\nname: ！！\ndescription: x\n---\n正文')).toThrow('小写字母')
    expect(() => parseSkillMarkdown('---\nname: a\ndescription: x\n---\n')).toThrow('正文为空')
    expect(() => parseSkillMarkdown('---\nname: a\n  bad indent\n---\n正文')).toThrow('缺少 description')
  })
})

describe('suffixSkillName', () => {
  it('截断到连字符处时去掉结尾的连字符，结果仍符合名称规范', () => {
    const name = `${'a'.repeat(59)}-${'b'.repeat(4)}`
    expect(suffixSkillName(name, 2)).toBe(`${'a'.repeat(59)}-2`)
    expect(suffixSkillName(name, 2)).toMatch(SKILL_NAME_PATTERN)
    expect(suffixSkillName('poster', 3)).toBe('poster-3')
  })
})
