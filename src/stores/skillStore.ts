import { create } from 'zustand'
import { getAllSkills, putSkill } from '../lib/db'
import { isStorageScopeCurrent } from '../lib/storageScope'
import { SKILL_NAME_PATTERN } from '../lib/skills/parse'
import type { SkillDocument } from '../lib/skills/types'

let hydratePromise: Promise<void> | undefined

// 从 IndexedDB 或云端恢复的 skill 必须字段齐全，文件列表只接受文本
export function normalizeSkillDocument(value: unknown): SkillDocument | undefined {
  if (!value || typeof value !== 'object') return
  const item = value as Partial<SkillDocument>
  if (item.schemaVersion !== 1 || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !SKILL_NAME_PATTERN.test(item.name)) return
  if (typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.body !== 'string' || !item.body) return
  if (!Array.isArray(item.files) || !item.files.every((file) => file && typeof file.path === 'string' && typeof file.content === 'string')) return
  if (!Number.isSafeInteger(item.revision) || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) return
  return {
    ...item as SkillDocument,
    scripts: Array.isArray(item.scripts) ? item.scripts.filter((path) => typeof path === 'string') : undefined,
    enabled: item.enabled !== false,
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

