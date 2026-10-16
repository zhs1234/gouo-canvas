import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Skill, SkillDocument, SkillFile } from './types'
import { parseSkillMarkdown } from './parse'

// 导入上限：技能只保存文本，总量要留在服务端单个文档 4 MB 的限制之内
export const SKILL_IMPORT_LIMITS = { file: 1024 * 1024, total: 2 * 1024 * 1024, files: 200, path: 200, upload: 10 * 1024 * 1024, entries: 2000 }
const TEXT_FILE = /\.(md|markdown|txt|json|ya?ml|csv|tsv)$/i
const GITHUB_API = 'https://api.github.com'

export interface SkillPackage {
  name: string
  title: string
  description: string
  body: string
  files: SkillFile[]
  scripts: string[]
  license?: string
  source?: string
  sourceRef?: string
  warnings: string[]
}

// 待读取的文件：路径相对导入根目录，内容按需读取，避免读入用不到的大文件
export interface SkillEntry {
  path: string
  size: number
  read: () => Promise<string>
}

interface ImportSource {
  source?: string
  sourceRef?: string
  // GitHub 导入时按技能目录生成各自的来源链接
  sourceFor?: (dir: string) => string
}

function normalizePath(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.')
  // 路径穿越、绝对路径、压缩工具和版本库附带的文件一律忽略；.claude/skills 这类隐藏目录照常读取
  if (/^[a-z]:/i.test(path) || path.startsWith('/') || parts.some((part) => ['..', '__MACOSX', '.git', '.DS_Store'].includes(part))) return
  return parts.join('/')
}

const textEncoder = new TextEncoder()
const byteLength = (text: string) => textEncoder.encode(text).length

// 已规整、没有穿越且不超过长度上限的相对路径
export function isSafeSkillPath(path: string) {
  return Boolean(path) && normalizePath(path) === path && path.length <= SKILL_IMPORT_LIMITS.path
}

// 导入和恢复（备份、本地、云端）共用的上限检查：路径安全、文件数量，
// 单文件和全部字段合计都按 UTF-8 字节计算，保证存到服务端时在单个文档 4 MB 以内
export function skillWithinLimits(skill: Pick<SkillDocument, 'title' | 'description' | 'body' | 'files' | 'scripts' | 'license' | 'source' | 'sourceRef'>) {
  const scripts = skill.scripts ?? []
  if (skill.files.length > SKILL_IMPORT_LIMITS.files || scripts.length > SKILL_IMPORT_LIMITS.files) return false
  if (![...skill.files.map((file) => file.path), ...scripts].every(isSafeSkillPath)) return false
  if (skill.files.some((file) => byteLength(file.content) > SKILL_IMPORT_LIMITS.file)) return false
  const fields = [skill.title, skill.description, skill.body, skill.license ?? '', skill.source ?? '', skill.sourceRef ?? '', ...scripts, ...skill.files.flatMap((file) => [file.path, file.content])]
  return fields.reduce((total, text) => total + byteLength(text), 0) <= SKILL_IMPORT_LIMITS.total
}

export async function collectSkillPackages(rawEntries: SkillEntry[], options: ImportSource = {}): Promise<SkillPackage[]> {
  const entries = rawEntries.flatMap((entry) => {
    const path = normalizePath(entry.path)
    return path ? [{ ...entry, path }] : []
  })
  const roots = entries.filter((entry) => /(^|\/)skill\.md$/i.test(entry.path)).map((entry) => ({ entry, dir: entry.path.slice(0, -'SKILL.md'.length) }))
  if (!roots.length) throw new Error('没有找到 SKILL.md，请确认导入的是技能目录或其压缩包')
  const packages: SkillPackage[] = []
  for (const root of roots) {
    // 嵌套的技能目录各自成包，不算进外层技能
    const owned = entries.filter((entry) => entry !== root.entry && entry.path.startsWith(root.dir) && !roots.some((other) => other.dir.length > root.dir.length && other.dir.startsWith(root.dir) && entry.path.startsWith(other.dir)))
    if (root.entry.size > SKILL_IMPORT_LIMITS.file) throw new Error(`${root.entry.path} 超过 1 MB`)
    const parsed = parseSkillMarkdown(await root.entry.read())
    const warnings = [...parsed.warnings]
    const dirName = root.dir.split('/').filter(Boolean).pop()
    if (dirName && dirName !== parsed.name) warnings.push(`目录名 ${dirName} 与 name 不一致，以 name 为准`)
    // 文件路径会列进 Agent 的系统提示，过长的路径不导入，路径长度也计入总量
    const usable = owned.filter((entry) => entry.path.length - root.dir.length <= SKILL_IMPORT_LIMITS.path)
    const scripts = usable.map((entry) => entry.path.slice(root.dir.length)).filter((path) => path.startsWith('scripts/'))
    const texts = usable.filter((entry) => TEXT_FILE.test(entry.path) && !entry.path.slice(root.dir.length).startsWith('scripts/'))
    const ignored = usable.length - scripts.length - texts.length
    if (texts.length > SKILL_IMPORT_LIMITS.files || scripts.length > SKILL_IMPORT_LIMITS.files) throw new Error(`技能 ${parsed.name} 的文件超过 ${SKILL_IMPORT_LIMITS.files} 个`)
    if (usable.length < owned.length) warnings.push(`已忽略 ${owned.length - usable.length} 个路径超过 ${SKILL_IMPORT_LIMITS.path} 字的文件`)
    let total = parsed.body.length
    const files: SkillFile[] = []
    for (const entry of texts.sort((a, b) => a.path.localeCompare(b.path))) {
      total += entry.size + entry.path.length - root.dir.length
      if (entry.size > SKILL_IMPORT_LIMITS.file) throw new Error(`${entry.path} 超过 1 MB`)
      if (total > SKILL_IMPORT_LIMITS.total) throw new Error(`技能 ${parsed.name} 的文本总量超过 2 MB`)
      files.push({ path: entry.path.slice(root.dir.length), content: await entry.read() })
    }
    if (scripts.length) warnings.push(`包含 ${scripts.length} 个脚本，浏览器里不会执行，Agent 只能参考文字说明`)
    if (ignored) warnings.push(`已忽略 ${ignored} 个非文本文件（图片、字体等）`)
    const pkg = {
      name: parsed.name,
      title: (parsed.metadata.title || parsed.name).slice(0, 60),
      description: parsed.description,
      body: parsed.body,
      files,
      scripts,
      license: parsed.license,
      source: (options.sourceFor ? options.sourceFor(root.dir) : options.source)?.slice(0, 2000),
      sourceRef: options.sourceRef,
      warnings,
    }
    if (!skillWithinLimits(pkg)) throw new Error(`技能 ${parsed.name} 超出大小限制（单个文件 1 MB，合计 2 MB）`)
    packages.push(pkg)
  }
  return packages
}

export function zipSkillEntries(bytes: Uint8Array, prefix = ''): SkillEntry[] {
  const entries: SkillEntry[] = []
  let total = 0
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false
      if (entries.length >= SKILL_IMPORT_LIMITS.entries) throw new Error(`压缩包内文件超过 ${SKILL_IMPORT_LIMITS.entries} 个`)
      entries.push({ path: prefix + file.name, size: file.originalSize, read: async () => strFromU8(files[file.name]) })
      // 只解压可能用到的文本；脚本和二进制只记录路径
      if (!TEXT_FILE.test(file.name) || file.originalSize > SKILL_IMPORT_LIMITS.file) return false
      total += file.originalSize
      if (total > SKILL_IMPORT_LIMITS.upload) throw new Error('压缩包解压后过大')
      return true
    },
  })
  return entries
}

// 上传的 .zip/.skill 展开为条目；单个 .md 视为 SKILL.md；选择文件夹时保留相对路径
export async function fileSkillEntries(fileList: File[]): Promise<SkillEntry[]> {
  if (fileList.length > SKILL_IMPORT_LIMITS.entries) throw new Error(`所选文件超过 ${SKILL_IMPORT_LIMITS.entries} 个，请选择单个技能目录`)
  const entries: SkillEntry[] = []
  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name
    if (/\.(zip|skill)$/i.test(file.name)) {
      if (file.size > SKILL_IMPORT_LIMITS.upload) throw new Error(`${file.name} 超过 10 MB`)
      entries.push(...zipSkillEntries(new Uint8Array(await file.arrayBuffer()), fileList.length > 1 ? `${file.name}/` : ''))
      continue
    }
    const single = fileList.length === 1 && /\.(md|markdown)$/i.test(file.name)
    entries.push({ path: single ? 'SKILL.md' : path, size: file.size, read: () => file.text() })
  }
  return entries
}

export function parseGithubSkillUrl(input: string) {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('请输入 GitHub 链接') }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const valid = (value?: string) => Boolean(value && /^[A-Za-z0-9_.-]+$/.test(value))
  if (url.protocol !== 'https:' || !valid(parts[0]) || !valid(parts[1])) throw new Error('只支持 https://github.com/用户/仓库 形式的链接')
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/, '')
  if (url.hostname === 'raw.githubusercontent.com') return { owner, repo, rest: parts.slice(2), blob: true }
  if (url.hostname !== 'github.com') throw new Error('只支持 github.com 上的仓库链接')
  if (parts.length === 2) return { owner, repo, rest: [], blob: false }
  if (parts[2] !== 'tree' && parts[2] !== 'blob') throw new Error('请使用仓库、目录（tree）或 SKILL.md 文件（blob）的链接')
  return { owner, repo, rest: parts.slice(3), blob: parts[2] === 'blob' }
}

async function githubJson<T>(path: string, signal?: AbortSignal): Promise<T | undefined> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal })
  if (response.status === 404 || response.status === 422) return
  if (response.status === 403 || response.status === 429) throw new Error('GitHub 接口访问次数已达上限（未登录每小时 60 次），请稍后再试，或下载压缩包后导入')
  if (!response.ok) throw new Error(`GitHub 返回错误：${response.status}`)
  return response.json() as Promise<T>
}

// 前端直接调用 GitHub 接口列出文件，再从 raw 地址读取文本；只支持公开仓库
export async function githubSkillEntries(input: string, signal?: AbortSignal): Promise<{ entries: SkillEntry[]; source: ImportSource }> {
  const { owner, repo, rest, blob } = parseGithubSkillUrl(input)
  const base = `/repos/${owner}/${repo}`
  // 分支名可能带斜杠，从短到长尝试，找到第一个能解析的引用
  let ref = 'HEAD'
  let sha = ''
  let pathParts = rest
  for (let idx = rest.length ? 1 : 0; idx <= Math.min(rest.length, 5); idx += 1) {
    const candidate = idx ? rest.slice(0, idx).join('/') : 'HEAD'
    const commit = await githubJson<{ sha: string }>(`${base}/commits/${encodeURIComponent(candidate)}`, signal)
    if (!commit) continue
    ref = candidate
    sha = commit.sha
    pathParts = rest.slice(idx)
    break
  }
  if (!sha) throw new Error('找不到这个仓库或分支，私有仓库无法导入')
  const tree = await githubJson<{ tree: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>(`${base}/git/trees/${sha}?recursive=1`, signal)
  if (!tree) throw new Error('读取仓库文件列表失败')
  // 列表被截断时可能缺少参考文件，不能导入不完整的技能
  if (tree.truncated) throw new Error('仓库文件过多，GitHub 只返回了部分文件列表，请下载技能目录的压缩包后导入')
  const target = pathParts.join('/')
  const dir = blob ? target.split('/').slice(0, -1).join('/') : target
  const prefix = dir ? `${dir}/` : ''
  const blobs = tree.tree.filter((item) => item.type === 'blob' && item.path.startsWith(prefix))
  if (!blobs.length) throw new Error('这个路径下没有文件')
  if (blobs.length > 2000) throw new Error('目录内文件过多，请改用指向单个技能目录的链接')
  return {
    entries: blobs.map((item) => ({
      path: item.path.slice(prefix.length),
      size: item.size ?? 0,
      read: async () => {
        const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${item.path.split('/').map(encodeURIComponent).join('/')}`, { signal })
        if (!response.ok) throw new Error(`读取 ${item.path} 失败：${response.status}`)
        return response.text()
      },
    })),
    source: { sourceRef: sha, sourceFor: (skillDir) => `https://github.com/${owner}/${repo}/tree/${ref}/${prefix}${skillDir}`.replace(/\/$/, '') },
  }
}

export function skillDocumentFromPackage(pkg: SkillPackage, id: string = crypto.randomUUID()): SkillDocument {
  const now = Date.now()
  return {
    id, schemaVersion: 1, name: pkg.name, title: pkg.title, description: pkg.description, body: pkg.body, files: pkg.files,
    scripts: pkg.scripts.length ? pkg.scripts : undefined, license: pkg.license, source: pkg.source, sourceRef: pkg.sourceRef,
    enabled: true, createdAt: now, updatedAt: now, revision: 1,
  }
}

// 导出为标准技能目录压缩包；正文已去掉 frontmatter，这里按保存的字段重新生成
export function buildSkillZip(skill: Skill | SkillDocument) {
  const metadata = [`  title: ${JSON.stringify(skill.title)}`, ...skill.source ? [`  source: ${JSON.stringify(skill.source)}`] : []]
  const frontmatter = ['---', `name: ${skill.name}`, `description: ${JSON.stringify(skill.description)}`, ...skill.license ? [`license: ${JSON.stringify(skill.license)}`] : [], 'metadata:', ...metadata, '---'].join('\n')
  return zipSync({
    [`${skill.name}/SKILL.md`]: strToU8(`${frontmatter}\n\n${skill.body}\n`),
    ...Object.fromEntries(skill.files.map((file) => [`${skill.name}/${file.path}`, strToU8(file.content)])),
  }, { level: 6 })
}
