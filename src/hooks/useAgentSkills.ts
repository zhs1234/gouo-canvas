import { useEffect, useMemo } from 'react'
import { useStore } from '../store'
import { useSkillStore } from '../stores/skillStore'
import { getAvailableSkills } from '../lib/skills/catalog'

export function useAgentSkills() {
  const disabled = useStore((state) => state.settings.disabledSkills)
  const imported = useSkillStore((state) => state.skills)
  useEffect(() => {
    void useSkillStore.getState().hydrate().catch((error) => console.warn('读取技能失败', error))
  }, [])
  return useMemo(() => getAvailableSkills(disabled, imported), [disabled, imported])
}
