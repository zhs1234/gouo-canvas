// 每份备份技能最多认领两个本地 ID：原 ID，或之前恢复时写下的 imported-<原 ID>。
// 按备份里的先后贪心认领会在两种顺序下各认错一次，所以在本批里做最大匹配；原 ID 对得上时优先。
export function matchRestoredSkillIds(ids: string[], localIds: ReadonlySet<string>) {
  const unique = [...new Set(ids)]
  const assignment = new Map<string, string>()
  const candidates = (id: string) => [id, `imported-${id}`].filter((item) => localIds.has(item))
  const tryAssign = (id: string, seen: Set<string>): boolean => {
    for (const localId of candidates(id)) {
      if (seen.has(localId)) continue
      seen.add(localId)
      const owner = assignment.get(localId)
      if (!owner || tryAssign(owner, seen)) {
        assignment.set(localId, id)
        return true
      }
    }
    return false
  }
  for (const id of unique) if (localIds.has(id)) assignment.set(id, id)
  const matched = new Set(assignment.values())
  for (const id of unique) {
    if (matched.has(id)) continue
    if (tryAssign(id, new Set())) matched.add(id)
  }
  return new Map([...assignment].map(([localId, id]) => [id, localId]))
}
