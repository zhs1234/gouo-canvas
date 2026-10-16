import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { buildSkillZip, collectSkillPackages, githubSkillEntries, parseGithubSkillUrl, SKILL_IMPORT_LIMITS, zipSkillEntries } from './importSkill'
import type { SkillEntry } from './importSkill'

const SKILL = '---\nname: poster-design\ndescription: 海报设计方法\nlicense: MIT\nmetadata:\n  title: 海报设计\n---\n# 正文\n'
const entry = (path: string, content: string): SkillEntry => ({ path, size: content.length, read: async () => content })

describe('collectSkillPackages', () => {
  it('按 SKILL.md 所在目录拆包，脚本只记路径，非文本文件忽略', async () => {
    const packages = await collectSkillPackages([
      entry('repo/poster-design/SKILL.md', SKILL),
      entry('repo/poster-design/references/guide.md', '指南'),
      entry('repo/poster-design/scripts/render.py', 'print(1)'),
      entry('repo/poster-design/assets/logo.png', 'binary'),
      entry('repo/poster-design/nested/SKILL.md', '---\nname: nested\ndescription: 嵌套\n---\n嵌套正文'),
      entry('repo/poster-design/nested/notes.md', '只属于嵌套技能'),
      entry('repo/README.md', '不属于任何技能'),
    ], { source: 'skills.zip' })
    expect(packages.map((pkg) => pkg.name)).toEqual(['poster-design', 'nested'])
    expect(packages[0]).toMatchObject({ title: '海报设计', license: 'MIT', source: 'skills.zip', files: [{ path: 'references/guide.md', content: '指南' }], scripts: ['scripts/render.py'] })
    expect(packages[0].warnings).toEqual([expect.stringContaining('1 个脚本'), expect.stringContaining('1 个非文本文件')])
    expect(packages[1].files).toEqual([{ path: 'notes.md', content: '只属于嵌套技能' }])
    expect(packages[1].warnings).toEqual([])
  })

  it('拒绝路径穿越，超出大小上限时报错', async () => {
    const packages = await collectSkillPackages([entry('SKILL.md', SKILL), entry('../secret.md', 'x'), entry('/etc/passwd.txt', 'x'), entry('.claude/notes.md', '隐藏目录照常读取')])
    expect(packages[0].files.map((file) => file.path)).toEqual(['.claude/notes.md'])
    await expect(collectSkillPackages([entry('README.md', 'x')])).rejects.toThrow('没有找到 SKILL.md')
    await expect(collectSkillPackages([entry('SKILL.md', SKILL), { path: 'big.md', size: SKILL_IMPORT_LIMITS.file + 1, read: async () => '' }])).rejects.toThrow('超过 1 MB')
    const many = Array.from({ length: 3 }, (_, idx) => ({ path: `part-${idx}.md`, size: SKILL_IMPORT_LIMITS.file, read: async () => '' }))
    await expect(collectSkillPackages([entry('SKILL.md', SKILL), ...many])).rejects.toThrow('超过 2 MB')
  })

  it('导出的压缩包可以原样导入', async () => {
    const zip = buildSkillZip({ name: 'poster-design', title: '海报：设计', description: '描述里有 "引号" 和冒号: 也没问题', body: '# 正文', files: [{ path: 'references/a.md', content: '资料' }], license: 'Apache-2.0', source: 'https://example.com/x', builtin: true })
    const [pkg] = await collectSkillPackages(zipSkillEntries(zip))
    expect(pkg).toMatchObject({ name: 'poster-design', title: '海报：设计', description: '描述里有 "引号" 和冒号: 也没问题', body: '# 正文', license: 'Apache-2.0', files: [{ path: 'references/a.md', content: '资料' }], warnings: [] })
  })

  it('压缩包里只解压文本文件', async () => {
    const zip = zipSync({ 'a/SKILL.md': strToU8(SKILL.replace('poster-design', 'a')), 'a/image.png': new Uint8Array(10), 'a/': new Uint8Array() })
    const entries = zipSkillEntries(zip)
    expect(entries.map((item) => item.path)).toEqual(['a/SKILL.md', 'a/image.png'])
    expect((await collectSkillPackages(entries))[0].warnings).toEqual([expect.stringContaining('1 个非文本文件')])
  })
})

describe('GitHub 导入', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('解析仓库、目录和文件链接', () => {
    expect(parseGithubSkillUrl('https://github.com/openai/skills')).toEqual({ owner: 'openai', repo: 'skills', rest: [], blob: false })
    expect(parseGithubSkillUrl('https://github.com/openai/skills/tree/main/skills/.system/imagegen')).toEqual({ owner: 'openai', repo: 'skills', rest: ['main', 'skills', '.system', 'imagegen'], blob: false })
    expect(parseGithubSkillUrl('https://raw.githubusercontent.com/a/b/main/x/SKILL.md')).toEqual({ owner: 'a', repo: 'b', rest: ['main', 'x', 'SKILL.md'], blob: true })
    expect(() => parseGithubSkillUrl('http://github.com/a/b')).toThrow('https')
    expect(() => parseGithubSkillUrl('https://gitlab.com/a/b')).toThrow('github.com')
    expect(() => parseGithubSkillUrl('https://github.com/a/b/issues/1')).toThrow('tree')
  })

  it('解析带斜杠的分支，只读取目标目录，并记录 commit', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/commits/feature')) return new Response('', { status: 422 })
      if (url.endsWith('/commits/feature%2Fskills')) return Response.json({ sha: 'abc123' })
      if (url.includes('/git/trees/abc123')) return Response.json({ tree: [{ path: 'skills/poster/SKILL.md', type: 'blob', size: 10 }, { path: 'skills/poster/references', type: 'tree' }, { path: 'skills/poster/references/a.md', type: 'blob', size: 2 }, { path: 'other/SKILL.md', type: 'blob', size: 1 }] })
      if (url === 'https://raw.githubusercontent.com/o/r/abc123/skills/poster/SKILL.md') return new Response(SKILL)
      if (url === 'https://raw.githubusercontent.com/o/r/abc123/skills/poster/references/a.md') return new Response('资料')
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { entries, source } = await githubSkillEntries('https://github.com/o/r/tree/feature/skills/skills/poster')
    expect(entries.map((item) => item.path)).toEqual(['SKILL.md', 'references/a.md'])
    const [pkg] = await collectSkillPackages(entries, source)
    expect(pkg).toMatchObject({ name: 'poster-design', sourceRef: 'abc123', source: 'https://github.com/o/r/tree/feature/skills/skills/poster', files: [{ path: 'references/a.md', content: '资料' }] })
  })

  it('接口限流时给出可操作的提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })))
    await expect(githubSkillEntries('https://github.com/o/r')).rejects.toThrow('每小时 60 次')
  })
})
