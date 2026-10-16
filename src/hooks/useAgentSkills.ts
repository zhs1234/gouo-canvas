import { useEffect, useMemo } from 'react'
import { useStore } from '../store'
import { useSkillStore } from '../stores/skillStore'
import { getAvailableSkills } from '../lib/skills/catalog'
import { isSkillsEnabled } from '../lib/gouoBackend'
import { useBackendStatus } from './useBackendStatus'

export function useAgentSkills() {
  const disabled = useStore((state) => state.settings.disabledSkills)
  const imported = useSkillStore((state) => state.skills)
  const enabled = isSkillsEnabled(useBackendStatus())
  useEffect(() => {
    void useSkillStore.getState().hydrate().catch((error) => console.warn('读取技能失败', error))
  }, [])
  return useMemo(() => enabled ? getAvailableSkills(disabled, imported) : [], [enabled, disabled, imported])
}
