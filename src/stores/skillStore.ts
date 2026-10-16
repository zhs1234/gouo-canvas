import { create } from 'zustand'
import { getAllSkills, putSkill } from '../lib/db'
import { isStorageScopeCurrent } from '../lib/storageScope'
import { MAX_SKILL_BODY, SKILL_NAME_PATTERN } from '../lib/skills/parse'
import { SKILL_IMPORT_LIMITS } from '../lib/skills/importSkill'
import type { SkillDocument } from '../lib/skills/types'

let hydratePromise: Promise<void> | undefined

// 从 IndexedDB、备份或云端恢复的 skill 必须字段齐全，文件列表只接受文本；
// 这些来源可能被改过，大小和数量按导入时的上限重新检查
export function normalizeSkillDocument(value: unknown): SkillDocument | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Partial<SkillDocument>
  if (item.schemaVersion !== 1 || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !SKILL_NAME_PATTERN.test(item.name)) return
  if (typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.body !== 'string' || !item.body || item.body.length > MAX_SKILL_BODY) return
  if (!Array.isArray(item.files) || item.files.length > SKILL_IMPORT_LIMITS.files || !item.files.every((file) => file && typeof file.path === 'string' && file.path.length <= SKILL_IMPORT_LIMITS.path && typeof file.content === 'string' && file.content.length <= SKILL_IMPORT_LIMITS.file)) return
  if (item.files.reduce((total, file) => total + file.path.length + file.content.length, item.body.length) > SKILL_IMPORT_LIMITS.total) return
  if (!Number.isSafeInteger(item.revision) || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) return
  // 只保留校验过的字段，可选字段类型不对时丢弃，避免界面拿到对象当文字渲染
  const text = (value: unknown) => typeof value === 'string' && value ? value : undefined
  return {
    id: item.id, schemaVersion: 1, name: item.name, title: item.title, description: item.description, body: item.body,
    files: item.files.map((file) => ({ path: file.path, content: file.content })),
    scripts: Array.isArray(item.scripts) ? item.scripts.filter((path) => typeof path === 'string' && path.length <= SKILL_IMPORT_LIMITS.path).slice(0, SKILL_IMPORT_LIMITS.files) : undefined,
    license: text(item.license), source: text(item.source), sourceRef: text(item.sourceRef),
    enabled: item.enabled !== false,
    createdAt: item.createdAt!, updatedAt: item.updatedAt!, revision: item.revision!,
    hiddenAt: Number.isFinite(item.hiddenAt) ? item.hiddenAt : undefined,
  }
}

interface SkillState {
  skills: SkillDocument[]
  hydrated: boolean
  hydrate: () => Promise<void>
  save: (skill: SkillDocument) => Promise<void>
  update: (id: string, patch: Pick<Partial<SkillDocument>, 'enabled' | 'hiddenAt'>) => Promise<void>
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    if (hydratePromise) return hydratePromise
    hydratePromise = (async () => {
      const stored = await getAllSkills()
      if (!isStorageScopeCurrent()) return
      set({ skills: stored.flatMap((value) => normalizeSkillDocument(value) || []), hydrated: true })
    })()
    try { await hydratePromise } finally { hydratePromise = undefined }
  },
  // 新建或整份替换；替换时沿用原 ID 并递增版本
  save: async (skill) => {
    if (!isStorageScopeCurrent()) throw new Error('账号已切换，请刷新页面')
    const current = get().skills.find((item) => item.id === skill.id)
    const next = current ? { ...skill, createdAt: current.createdAt, revision: current.revision + 1, updatedAt: Date.now() } : skill
    await putSkill(next, current?.revision ?? 0)
    set((state) => ({ skills: [...state.skills.filter((item) => item.id !== next.id), next] }))
  },
  update: async (id, patch) => {
    const current = get().skills.find((item) => item.id === id)
    if (!current) return
    await get().save({ ...current, ...patch })
  },
}))

