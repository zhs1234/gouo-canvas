export interface SkillFile {
  path: string
  content: string
}

export interface Skill {
  name: string
  title: string
  description: string
  // SKILL.md 去掉 frontmatter 后的正文
  body: string
  // references/ 等随 skill 提供的文本资料，按需读取
  files: SkillFile[]
  license?: string
  source?: string
  builtin: boolean
}
