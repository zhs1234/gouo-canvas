import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { useSkillStore } from '../../stores/skillStore'
import type { Skill, SkillDocument } from '../../lib/skills/types'
import { BUILTIN_SKILLS } from '../../lib/skills/builtin'
import { importedSkillNames, skillFromDocument } from '../../lib/skills/catalog'
import { suffixSkillName } from '../../lib/skills/parse'
import { buildSkillZip, collectSkillPackages, fileSkillEntries, githubSkillEntries, skillDocumentFromPackage, type SkillPackage } from '../../lib/skills/importSkill'
import { getCurrentUser, isSkillGithubImportOpen, isSkillImportEnabled } from '../../lib/gouoBackend'
import { useBackendStatus } from '../../hooks/useBackendStatus'
import { DownloadIcon, ImportIcon, TrashIcon } from '../icons'

type ImportAction = 'create' | 'replace' | 'copy' | 'skip'
interface PendingSkill {
  pkg: SkillPackage
  conflict?: SkillDocument | 'builtin'
  action: ImportAction
}

const buttonClass = 'rounded-xl bg-gray-100/80 px-3.5 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white'
const cardClass = 'rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-3 shadow-sm'

function downloadSkill(skill: Skill | SkillDocument) {
  const url = URL.createObjectURL(new Blob([buildSkillZip(skill).buffer as ArrayBuffer], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${skill.name}.zip`
  link.click()
  URL.revokeObjectURL(url)
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return <button type="button" onClick={onChange} role="switch" aria-checked={checked} aria-label={label}
    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
    <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
  </button>
}

function SkillRow({ skill, enabled, onToggle, onDelete, source, sourceRef }: { skill: Skill; enabled: boolean; onToggle: () => void; onDelete?: () => void; source?: string; sourceRef?: string }) {
  const [open, setOpen] = useState(false)
  return <div className="py-3 first:pt-0 last:pb-0">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{skill.title}</span>
          <code className="text-xs text-gray-400">${skill.name}</code>
        </div>
        <p data-selectable-text className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{skill.description}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
          {skill.license && <span>许可：{skill.license}</span>}
          {source && (/^https:\/\//.test(source) ? <a className="hover:text-blue-500 underline-offset-2 hover:underline" href={source} target="_blank" rel="noopener noreferrer">来源：{source.replace(/^https:\/\/(github\.com\/)?/, '')}{sourceRef ? `@${sourceRef.slice(0, 7)}` : ''}</a> : <span>来源：{source}</span>)}
          <button type="button" className="hover:text-blue-500" onClick={() => setOpen(!open)}>{open ? '收起内容' : '查看内容'}</button>
          <button type="button" className="inline-flex items-center gap-1 hover:text-blue-500" onClick={() => downloadSkill(skill)}><DownloadIcon className="h-3 w-3" />导出</button>
          {onDelete && <button type="button" className="inline-flex items-center gap-1 hover:text-red-500" onClick={onDelete}><TrashIcon className="h-3 w-3" />删除</button>}
        </div>
      </div>
      <Switch checked={enabled} label={`${enabled ? '停用' : '启用'}技能 ${skill.title}`} onChange={onToggle} />
    </div>
    {open && <div className="mt-2 space-y-2">
      {/* 只按纯文本显示，导入内容里的 HTML 和图片链接不会被渲染或加载 */}
      <pre data-selectable-text className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">{skill.body}</pre>
      {skill.files.length > 0 && <p className="text-xs text-gray-400">参考文件：{skill.files.map((file) => file.path).join('、')}</p>}
    </div>}
  </div>
}

export default function SkillsSettingsTab() {
  const disabled = useStore((state) => state.settings.disabledSkills)
  const setSettings = useStore((state) => state.setSettings)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const allImported = useSkillStore((state) => state.skills)
  const imported = allImported.filter((doc) => !doc.hiddenAt).sort((a, b) => a.createdAt - b.createdAt)
  const importedNames = importedSkillNames(allImported)
  const [pending, setPending] = useState<PendingSkill[]>()
  const [busy, setBusy] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const status = useBackendStatus()
  const [isAdmin, setIsAdmin] = useState(false)
  // 读到后台设置之前不开放导入，避免在设置接口异常时绕过关闭的导入开关
  const canImport = status !== null && isSkillImportEnabled(status)
  const canImportGithub = canImport && (isAdmin || isSkillGithubImportOpen(status))

  useEffect(() => {
    void useSkillStore.getState().hydrate().catch((error) => console.warn('读取技能失败', error))
    void getCurrentUser().then((user) => setIsAdmin((user.role ?? 0) >= 10)).catch((error) => console.warn('读取账号信息失败', error))
    return () => abort.current?.abort()
  }, [])

  const preview = async (load: () => Promise<SkillPackage[]>) => {
    setBusy(true)
    try {
      const packages = await load()
      const seen = new Set<string>()
      const unique = packages.filter((pkg) => !seen.has(pkg.name) && Boolean(seen.add(pkg.name)))
      if (unique.length < packages.length) showToast('压缩包里有重名技能，只保留第一个', 'info')
      setPending(unique.map((pkg) => {
        const conflict = BUILTIN_SKILLS.some((skill) => skill.name === pkg.name) ? 'builtin' as const : imported.find((doc) => doc.name === pkg.name)
        return { pkg, conflict, action: conflict ? 'skip' : 'create' }
      }))
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) showToast(error instanceof Error ? error.message : '读取技能失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const importFiles = (files: File[]) => {
    if (!files.length) return
    void preview(async () => collectSkillPackages(await fileSkillEntries(files), { source: files.length === 1 ? files[0].name : files[0].webkitRelativePath.split('/')[0] || files[0].name }))
  }

  const importGithub = () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    void preview(async () => {
      const { entries, source } = await githubSkillEntries(githubUrl, controller.signal)
      return collectSkillPackages(entries, source)
    })
  }

  const confirmImport = async () => {
    if (!pending) return
    setBusy(true)
    // 本批要新建的名称也算已占用，另存副本时不会和它们重名
    const taken = new Set([...BUILTIN_SKILLS.map((skill) => skill.name), ...imported.map((doc) => doc.name), ...pending.filter((item) => item.action === 'create').map((item) => item.pkg.name)])
    let count = 0
    // 逐个保存；中途失败时已保存的从待导入列表移除，重试不会重复导入
    let idx = 0
    try {
      for (; idx < pending.length; idx += 1) {
        const item = pending[idx]
        if (item.action === 'skip') continue
        if (item.action === 'replace' && item.conflict && item.conflict !== 'builtin') {
          await useSkillStore.getState().save({ ...skillDocumentFromPackage(item.pkg, item.conflict.id), enabled: item.conflict.enabled })
        } else if (item.action === 'copy') {
          let suffix = 2
          while (taken.has(suffixSkillName(item.pkg.name, suffix))) suffix += 1
          const name = suffixSkillName(item.pkg.name, suffix)
          taken.add(name)
          await useSkillStore.getState().save(skillDocumentFromPackage({ ...item.pkg, name, title: `${item.pkg.title}（副本）` }))
        } else {
          await useSkillStore.getState().save(skillDocumentFromPackage(item.pkg))
        }
        count += 1
      }
      setPending(undefined)
      setGithubUrl('')
      showToast(count ? `已导入 ${count} 个技能` : '没有导入任何技能', count ? 'success' : 'info')
    } catch (error) {
      setPending(pending.slice(idx))
      const reason = error instanceof Error ? error.message : '保存失败'
      showToast(count ? `已导入 ${count} 个技能，其余未导入：${reason}` : `导入失败：${reason}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleBuiltin = (name: string) => setSettings({ disabledSkills: disabled.includes(name) ? disabled.filter((item) => item !== name) : [...disabled, name] })
  const updateImported = (id: string, patch: Pick<Partial<SkillDocument>, 'enabled' | 'hiddenAt'>) => {
    void useSkillStore.getState().update(id, patch).catch((error) => showToast(error instanceof Error ? error.message : '保存技能失败', 'error'))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05] text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
        <p>技能是写给 Agent 的创作方法说明。Agent 会在需要时自动启用，你也可以在 Agent 输入框点「技能」选择，或在消息里输入 $名称。停用的技能不会出现在 Agent 里。</p>
        <p className="mt-2">导入的技能来自第三方，只作为参考说明使用，其中的脚本不会执行。请只导入可信来源的技能。</p>
      </div>

      {canImport && <div className={cardClass}>
        <div className="flex items-center gap-2">
          <ImportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入技能</h4>
        </div>
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">支持技能目录、它的 .zip / .skill 压缩包或单个 SKILL.md。只保存文本内容，单个文件不超过 1 MB，每个技能合计不超过 2 MB。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => fileInput.current?.click()}>选择文件</button>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => folderInput.current?.click()}>选择文件夹</button>
        </div>
        {canImportGithub && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (githubUrl.trim()) importGithub() }}>
          <input type="url" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="GitHub 链接，如 https://github.com/用户/仓库/tree/main/skills/名称" aria-label="GitHub 技能链接"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200" />
          <button type="submit" className={buttonClass} disabled={busy || !githubUrl.trim()}>{busy ? '读取中…' : '从 GitHub 导入'}</button>
        </form>}
        <input ref={fileInput} type="file" multiple accept=".zip,.skill,.md,.markdown" className="hidden" onChange={(event) => { importFiles([...event.target.files || []]); event.target.value = '' }} />
        <input ref={folderInput} type="file" className="hidden" {...{ webkitdirectory: '' }} onChange={(event) => { importFiles([...event.target.files || []]); event.target.value = '' }} />

        {pending && <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-white/[0.06]">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-300">确认导入以下 {pending.length} 个技能</p>
          {pending.map((item, idx) => <div key={`${item.pkg.name}-${idx}`} className="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{item.pkg.title}</span>
              <code className="text-xs text-gray-400">${item.pkg.name}</code>
              <span className="text-xs text-gray-400">{item.pkg.files.length} 个参考文件{item.pkg.license ? ` · 许可：${item.pkg.license}` : ' · 未声明许可'}</span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{item.pkg.description}</p>
            {item.pkg.source && <p className="mt-0.5 break-all text-xs text-gray-400">来源：{item.pkg.source}</p>}
            {item.pkg.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-600 dark:text-amber-400">{warning}</p>)}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-blue-500">查看内容</summary>
              <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600 dark:text-gray-300">{item.pkg.body}</pre>
            </details>
            <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              {item.conflict ? <span className="text-amber-600 dark:text-amber-400">{item.conflict === 'builtin' ? '与内置技能重名' : '已有同名技能'}：</span> : <span>操作：</span>}
              <select value={item.action} aria-label={`${item.pkg.title} 的导入方式`} onChange={(event) => setPending(pending.map((value, i) => i === idx ? { ...value, action: event.target.value as ImportAction } : value))}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-white/[0.04]">
                {!item.conflict && <option value="create">导入</option>}
                {item.conflict && item.conflict !== 'builtin' && <option value="replace">替换已有</option>}
                {item.conflict && <option value="copy">另存为副本</option>}
                <option value="skip">跳过</option>
              </select>
            </label>
          </div>)}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setPending(undefined)}>取消</button>
            <button type="button" className="rounded-xl bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50" disabled={busy || pending.every((item) => item.action === 'skip')} onClick={() => void confirmImport()}>确认导入</button>
          </div>
        </div>}
      </div>}

      <div className={cardClass}>
        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">我导入的技能</h4>
        {imported.length ? <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">{imported.map((doc) => <SkillRow key={doc.id} skill={{ ...skillFromDocument(doc), name: importedNames.get(doc.id) ?? doc.name }} enabled={doc.enabled} source={doc.source} sourceRef={doc.sourceRef}
          onToggle={() => updateImported(doc.id, { enabled: !doc.enabled })}
          onDelete={() => setConfirmDialog({ title: '删除技能', message: `删除「${doc.title}」？已启用它的会话之后不再使用它。`, confirmText: '删除', tone: 'danger', action: () => updateImported(doc.id, { hiddenAt: Date.now() }) })} />)}</div>
          : <p className="text-xs text-gray-400">还没有导入技能。</p>}
      </div>

      <div className={cardClass}>
        <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">内置技能</h4>
        <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">{BUILTIN_SKILLS.map((skill) => <SkillRow key={skill.name} skill={skill} enabled={!disabled.includes(skill.name)} source={skill.source?.split(',')[0].trim()} onToggle={() => toggleBuiltin(skill.name)} />)}</div>
        <p className="text-xs leading-relaxed text-gray-400">内置技能改编自开源项目，来源与许可见各技能的「来源」，完整声明随应用一起发布。</p>
      </div>
    </div>
  )
}
