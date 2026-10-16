import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { SkillDocument } from '../lib/skills/types'

vi.mock('../lib/storageScope', () => ({ getLoadedStorageName: () => 'skill-test', isStorageScopeCurrent: () => true }))
const skill = (patch: Partial<SkillDocument> = {}): SkillDocument => ({ id: 'skill', schemaVersion: 1, name: 'poster-design', title: '海报', description: '用途', body: '正文', files: [], enabled: true, createdAt: 1, updatedAt: 1, revision: 1, ...patch })

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('window', new EventTarget())
})

describe('技能存储', () => {
  it('从 v5 升级时保留原有数据并新建技能表', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('skill-test', 5)
      req.onupgradeneeded = () => { req.result.createObjectStore('tasks', { keyPath: 'id' }).put({ id: 'task' }) }
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
    })
    const db = await import('../lib/db')
    expect(await db.getAllTasks()).toEqual([{ id: 'task' }])
    expect(await db.getAllSkills()).toEqual([])
  })

  it('新建、替换和停用都递增版本并写入数据库，读取时丢弃无效记录', async () => {
    const db = await import('../lib/db')
    await db.putSkill({ ...skill({ id: 'broken', name: 'Bad Name' }) })
    const { useSkillStore } = await import('./skillStore')
    await useSkillStore.getState().hydrate()
    expect(useSkillStore.getState().skills).toEqual([])
    await useSkillStore.getState().save(skill())
    await useSkillStore.getState().save(skill({ body: '新正文', createdAt: 99 }))
    await useSkillStore.getState().update('skill', { enabled: false })
    const stored = (await db.getAllSkills()).find((item) => item.id === 'skill')
    expect(stored).toMatchObject({ body: '新正文', createdAt: 1, revision: 3, enabled: false })
    expect(useSkillStore.getState().skills).toEqual([stored])
  })

  it('其他标签页已改过时拒绝覆盖', async () => {
    const db = await import('../lib/db')
    const { useSkillStore } = await import('./skillStore')
    await useSkillStore.getState().hydrate()
    await useSkillStore.getState().save(skill())
    await db.putSkill(skill({ revision: 5, body: '别处的修改' }))
    await expect(useSkillStore.getState().update('skill', { enabled: false })).rejects.toThrow('文档已变更')
  })

  it('恢复时校验字段', async () => {
    const { normalizeSkillDocument } = await import('./skillStore')
    expect(normalizeSkillDocument(skill({ enabled: undefined as unknown as boolean, scripts: ['a.py', 1 as unknown as string] }))).toMatchObject({ enabled: true, scripts: ['a.py'] })
    expect(normalizeSkillDocument({ ...skill(), files: [{ path: 'a.md' }] })).toBeUndefined()
    // 可选字段类型不对时丢弃，不带入未知字段
    expect(normalizeSkillDocument({ ...skill({ hiddenAt: 5 }), source: {}, license: 1, sourceRef: [], extra: 'x' })).toEqual({ ...skill({ hiddenAt: 5 }), scripts: undefined, license: undefined, source: undefined, sourceRef: undefined })
    expect(normalizeSkillDocument({ ...skill(), schemaVersion: 2 })).toBeUndefined()
    expect(normalizeSkillDocument({ ...skill(), body: '' })).toBeUndefined()
    // 备份或云端数据可能被改过，导入时的大小和数量上限要重新检查
    expect(normalizeSkillDocument({ ...skill(), body: 'x'.repeat(100_001) })).toBeUndefined()
    expect(normalizeSkillDocument({ ...skill(), files: [{ path: 'a.md', content: 'x'.repeat(1024 * 1024 + 1) }] })).toBeUndefined()
    expect(normalizeSkillDocument({ ...skill(), files: Array.from({ length: 3 }, (_, idx) => ({ path: `${idx}.md`, content: 'x'.repeat(1024 * 1024) })) })).toBeUndefined()
    expect(normalizeSkillDocument({ ...skill(), files: Array.from({ length: 201 }, (_, idx) => ({ path: `${idx}.md`, content: 'x' })) })).toBeUndefined()
    expect(normalizeSkillDocument({ ...skill(), files: [{ path: 'x'.repeat(201), content: 'x' }] })).toBeUndefined()
  })
})
