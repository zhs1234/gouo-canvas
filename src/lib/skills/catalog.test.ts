import { describe, expect, it, vi } from 'vitest'
import type { SkillDocument } from './types'

vi.mock('../../store', () => ({ useStore: { getState: () => ({ settings: { disabledSkills: [] } }) } }))
vi.mock('../../stores/skillStore', () => ({ useSkillStore: { getState: () => ({ skills: [] }) } }))

import { getAvailableSkills } from './catalog'
import { BUILTIN_SKILLS } from './builtin'

const doc = (patch: Partial<SkillDocument>): SkillDocument => ({ id: patch.name || 'x', schemaVersion: 1, name: 'x', title: 'x', description: 'x', body: 'x', files: [], enabled: true, createdAt: 1, updatedAt: 1, revision: 1, ...patch })

describe('getAvailableSkills', () => {
  it('内置在前，过滤停用和已删除的导入技能，重名的按导入先后加后缀', () => {
    const builtin = BUILTIN_SKILLS[0].name
    const skills = getAvailableSkills([BUILTIN_SKILLS[1].name], [
      doc({ name: 'later', createdAt: 3 }),
      doc({ id: 'dup-new', name: 'mine', createdAt: 5, title: '后导入' }),
      doc({ id: 'dup-old', name: 'mine', createdAt: 2, title: '先导入' }),
      doc({ name: builtin, createdAt: 1 }),
      doc({ name: 'off', enabled: false }),
      doc({ name: 'deleted', hiddenAt: 9 }),
    ])
    const names = skills.map((skill) => skill.name)
    expect(names).not.toContain(BUILTIN_SKILLS[1].name)
    expect(names.slice(-4)).toEqual([`${builtin}-2`, 'mine', 'later', 'mine-2'])
    expect(skills.find((skill) => skill.name === 'mine')).toMatchObject({ title: '先导入', builtin: false })
    expect(skills.find((skill) => skill.name === 'mine-2')).toMatchObject({ key: 'dup-new', title: '后导入', builtin: false })
    expect(skills.filter((skill) => skill.name === builtin)).toEqual([BUILTIN_SKILLS[0]])
    expect(names).not.toContain('off')
    expect(names).not.toContain('deleted')
    // 停用的导入技能也占着名称，启用别的技能时名称不会变
    expect(getAvailableSkills([], [doc({ id: 'a', name: 'x', createdAt: 1, enabled: false }), doc({ id: 'b', name: 'x', createdAt: 2 })]).map((skill) => skill.name)).toContain('x-2')
  })
})
