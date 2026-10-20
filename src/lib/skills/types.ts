export interface SkillFile {
  path: string
  content: string
}

export interface Skill {
  // 会话里记录启用状态用的稳定标识：内置技能是名称，导入的技能是文档 ID；名称可能因重名加后缀而变化
  key: string
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

// 用户导入的 skill，按文档保存在本地并同步到服务端
export interface SkillDocument {
  id: string
  schemaVersion: 1
  name: string
  title: string
  description: string
  body: string
  files: SkillFile[]
  // scripts/ 下的脚本只记录路径，浏览器里不执行
  scripts?: string[]
  license?: string
  // 导入来源：GitHub 链接或文件名
  source?: string
  // 从 GitHub 导入时的 commit SHA
  sourceRef?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  revision: number
  hiddenAt?: number
}
