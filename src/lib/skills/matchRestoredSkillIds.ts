// 与服务端文档 ID 上限一致（len(clientID) > 128 会拒绝同步）
const SKILL_ID_MAX_BYTES = 128
const textEncoder = new TextEncoder()

// 固定的 imported- 前缀方便再次导入时认出。反复导出再恢复会一层层加长，超过 128 字节就永远同步不了，这时改用新的 UUID
export function restoredSkillId(id: string, taken: ReadonlySet<string>) {
  const prefixed = `imported-${id}`
  if (textEncoder.encode(prefixed).length <= SKILL_ID_MAX_BYTES && !taken.has(prefixed)) return prefixed
  return crypto.randomUUID()
}

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
