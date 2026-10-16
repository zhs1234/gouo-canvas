// 按 Agent Skills 规范解析 SKILL.md：frontmatter 只取 name、description、license、metadata，其余字段忽略。
// 社区 skill 写法不统一，名字不规范时规整并给出警告；只有缺 name/description 或无法解析时才拒绝。

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_DESCRIPTION = 1024
export const MAX_SKILL_BODY = 100_000

export interface ParsedSkillMarkdown {
  name: string
  description: string
  license?: string
  metadata: Record<string, string>
  body: string
  warnings: string[]
}

function unquote(value: string) {
  const text = value.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\nt])/g, (_, ch: string) => ch === 'n' ? '\n' : ch === 't' ? '\t' : ch)
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  return text
}

// 只支持 frontmatter 常见写法：key: value、带引号的值、| 和 > 块文本、一层缩进的映射（metadata）
function parseFrontmatter(text: string) {
  const fields: Record<string, string | Record<string, string>> = {}
  const lines = text.split('\n')
  let idx = 0
  while (idx < lines.length) {
    const line = lines[idx]
    idx += 1
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line.trimEnd())
    if (!match || /^\s/.test(line)) throw new Error(`frontmatter 第 ${idx} 行无法解析`)
    const value = (match[2] ?? '').trim()
    const indented: string[] = []
    while (idx < lines.length && (!lines[idx].trim() || /^\s/.test(lines[idx]))) indented.push(lines[idx++])
    while (indented.length && !indented[indented.length - 1].trim()) indented.pop()
    if (/^[|>][-+]?$/.test(value)) {
      const indent = Math.min(...indented.filter((item) => item.trim()).map((item) => item.length - item.trimStart().length))
      const block = indented.map((item) => item.slice(indent))
      fields[match[1]] = (value.startsWith('|') ? block.join('\n') : block.join(' ').replace(/\s+/g, ' ')).trim()
      continue
    }
    if (value || !indented.length) {
      fields[match[1]] = unquote(value)
      continue
    }
    const map: Record<string, string> = {}
    for (const item of indented) {
      if (!item.trim()) continue
      const entry = /^\s+([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(item.trimEnd())
      if (entry) map[entry[1]] = unquote(entry[2] ?? '')
    }
    fields[match[1]] = map
  }
  return fields
}

export function parseSkillMarkdown(text: string): ParsedSkillMarkdown {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source)
  if (!match) throw new Error('SKILL.md 缺少开头的 --- frontmatter')
  const fields = parseFrontmatter(match[1])
  const warnings: string[] = []
  const rawName = typeof fields.name === 'string' ? fields.name.trim() : ''
  const rawDescription = typeof fields.description === 'string' ? fields.description.trim() : ''
  if (!rawName) throw new Error('SKILL.md 缺少 name')
  if (!rawDescription) throw new Error('SKILL.md 缺少 description')
  const name = rawName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '')
  if (!name) throw new Error('SKILL.md 的 name 只能包含小写字母、数字和连字符')
  if (name !== rawName) warnings.push(`name 不符合规范，已改为 ${name}`)
  if (rawDescription.length > MAX_DESCRIPTION) warnings.push(`description 超过 ${MAX_DESCRIPTION} 字，已截断`)
  const body = source.slice(match[0].length).trim()
  if (!body) throw new Error('SKILL.md 正文为空')
  if (body.length > MAX_SKILL_BODY) throw new Error(`SKILL.md 正文超过 ${MAX_SKILL_BODY} 字`)
  return {
    name,
    description: rawDescription.slice(0, MAX_DESCRIPTION),
    license: typeof fields.license === 'string' && fields.license ? fields.license.slice(0, 200) : undefined,
    metadata: fields.metadata && typeof fields.metadata === 'object' ? fields.metadata : {},
    body,
    warnings,
  }
}
