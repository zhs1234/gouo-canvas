import type { Skill } from './types'
import { parseSkillMarkdown } from './parse'

// 内置 skill 随前端打包，目录结构与 Agent Skills 规范一致：src/skills/<name>/SKILL.md 和 references/*.md
const RAW_FILES = import.meta.glob('../../skills/*/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

// 内置列表按这个顺序展示，未列出的排在后面
const ORDER = ['image-prompting', 'image-editing', 'image-to-prompt', 'product-photos', 'poster-design', 'consistent-characters', 'text-in-image', 'logo-brand', 'color-themes']

export const BUILTIN_SKILLS: Skill[] = Object.keys(RAW_FILES).filter((path) => path.endsWith('/SKILL.md')).map((path) => {
  const dir = path.slice(0, -'SKILL.md'.length)
  const parsed = parseSkillMarkdown(RAW_FILES[path])
  return {
    key: parsed.name,
    name: parsed.name,
    title: parsed.metadata.title || parsed.name,
    description: parsed.description,
    body: parsed.body,
    files: Object.keys(RAW_FILES).filter((file) => file.startsWith(dir) && file !== path).sort().map((file) => ({ path: file.slice(dir.length), content: RAW_FILES[file] })),
    license: parsed.license,
    source: parsed.metadata.source,
    builtin: true,
  }
}).sort((a, b) => (ORDER.indexOf(a.name) + 1 || ORDER.length + 1) - (ORDER.indexOf(b.name) + 1 || ORDER.length + 1) || a.name.localeCompare(b.name))
