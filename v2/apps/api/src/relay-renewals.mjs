import { createHash } from 'node:crypto'
import { StudioError } from './images-error.mjs'
import { z } from 'zod'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const renewalPolicyHash = policy => hash(Object.fromEntries(Object.entries(policy).sort(([a], [b]) => a.localeCompare(b))))
const integer = z.number().int().safe()
const positive = integer.positive()
export const tokenMetadataSchema = z.object({
  id: positive, user_id: positive, name: z.string().min(1).max(50), status: z.union([z.literal(1), z.literal(3), z.literal(4)]),
  remain_quota: integer, used_quota: integer.nonnegative().optional(), expired_time: positive,
  created_time: integer.nonnegative().optional(), accessed_time: integer.nonnegative().optional(),
  unlimited_quota: z.literal(false), model_limits_enabled: z.literal(true), model_limits: z.string().min(1),
  allow_ips: z.union([z.literal(''), z.null()]), group: z.literal(''), cross_group_retry: z.literal(false),
  auto_groups: z.union([z.array(z.never()).length(0), z.null()]),
}).strict()
export const renewalTargetSchema = z.object({
  version: z.literal(2), instanceId: z.string().uuid(), owner: positive,
  sourceCommit: z.literal('0aec08fee811ec6136828fda790551b49e410301'),
  gatewayOrigin: z.string().url().refine(value => new URL(value).origin === value),
  oldBinding: z.object({ id: positive, name: z.string().min(1).max(50) }).strict(), oldMetadata: tokenMetadataSchema,
  approvedNativeNow: positive,
  approved: z.object({ name: z.string().regex(/^gouo-studio-[a-f0-9]{32}$/), remain_quota: positive, expired_time: positive,
    unlimited_quota: z.literal(false), model_limits_enabled: z.literal(true), model_limits: z.string().min(1),
    allow_ips: z.literal(''), group: z.literal(''), cross_group_retry: z.literal(false), auto_groups: z.array(z.never()).length(0),
  }).strict(),
  limits: z.object({ quotaCap: positive.max(2147483647), lifetimeSeconds: integer.min(60).max(31536000) }).strict(),
  policyHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((target, ctx) => {
  if (target.owner !== target.oldMetadata.user_id || target.oldBinding.id !== target.oldMetadata.id
    || target.oldBinding.name !== target.oldMetadata.name || target.approved.name === target.oldBinding.name
    || target.approved.remain_quota > target.limits.quotaCap || target.oldMetadata.remain_quota > target.limits.quotaCap
    || target.approved.expired_time !== target.approvedNativeNow + target.limits.lifetimeSeconds
    || (target.oldMetadata.status === 3 && target.oldMetadata.expired_time >= target.approvedNativeNow)
    || (target.oldMetadata.status === 4 && target.oldMetadata.remain_quota > 0)
    || !(target.oldMetadata.expired_time < target.approvedNativeNow || target.oldMetadata.remain_quota <= 0)
    || target.approved.model_limits !== [...new Set(target.approved.model_limits.split(','))].sort().join(',')
    || target.oldMetadata.model_limits.split(',').sort().join(',') !== target.approved.model_limits) {
    ctx.addIssue({ code: 'custom', message: 'Renewal approval snapshot is inconsistent' })
  }
})
export const retirementProofSchema = z.object({ version: z.literal(1), nativeNow: positive,
  kind: z.enum(['hard-expired', 'exhausted-status', 'exhausted-auth-rejection']), metadata: tokenMetadataSchema,
}).strict().superRefine((proof, ctx) => {
  if (proof.kind === 'hard-expired' ? proof.metadata.expired_time >= proof.nativeNow
    : proof.metadata.status !== 4 || proof.metadata.remain_quota > 0) ctx.addIssue({ code: 'custom', message: 'Retirement evidence is inconsistent' })
})
export function buildRenewalTarget(config, owner, inspection, approved) {
  return renewalTargetSchema.parse({ version: 2, instanceId: config.accountInstanceId, owner,
    sourceCommit: config.tokenRenewalPolicy.sourceCommit, gatewayOrigin: new URL(config.gateway).origin,
    oldBinding: { id: inspection.token.id, name: inspection.token.name }, oldMetadata: inspection.token,
    approvedNativeNow: inspection.nativeNow, approved,
    limits: { quotaCap: config.userTokenQuotaCap, lifetimeSeconds: config.userTokenLifetimeSeconds }, policyHash: renewalPolicyHash(config.tokenRenewalPolicy) })
}
export const accessVersion = (config, owner, inspection) => hash({ instance: config.accountInstanceId, owner, token: inspection.token,
  cap: config.userTokenQuotaCap, lifetime: config.userTokenLifetimeSeconds, policy: config.tokenRenewalPolicy })

// Credential metadata and non-monetary mutation barriers. Native alone owns
// every token key, quota, account balance and eventual model settlement.
export class RelayRenewals {
  constructor(db) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS relay_bindings (owner INTEGER PRIMARY KEY, token_id INTEGER NOT NULL, token_name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relay_renewals (owner INTEGER NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL,
        old_id INTEGER NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, result TEXT,
        PRIMARY KEY(owner,key));
      CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_renewal ON relay_renewals(owner) WHERE status IN ('pending','unknown');
      UPDATE relay_renewals SET status='unknown' WHERE status='pending'`)
    if (!db.prepare('PRAGMA table_info(relay_renewals)').all().some(column => column.name === 'proof')) db.exec('ALTER TABLE relay_renewals ADD COLUMN proof TEXT')
  }
  binding(owner) {
    const row = this.db.prepare('SELECT token_id,token_name FROM relay_bindings WHERE owner=?').get(owner)
    return row && { id: row.token_id, name: row.token_name }
  }
  blocked(owner) { return Boolean(this.db.prepare("SELECT 1 FROM relay_renewals WHERE owner=? AND status IN ('pending','unknown')").get(owner)) }
  assertReady(owner) { if (this.blocked(owner)) throw new StudioError('生成权限续用结果待核对，已暂停新生成；请联系管理员，不要重复提交', 409) }
  unresolvedGeneration(owner) {
    return Boolean(this.db.prepare("SELECT 1 FROM requests WHERE owner=? AND status NOT IN ('completed','cancelled_before_submission') LIMIT 1").get(owner))
      || Boolean(this.db.prepare("SELECT 1 FROM trial_reservations WHERE owner=? AND status!='used' LIMIT 1").get(owner))
      || Boolean(this.db.prepare("SELECT 1 FROM requests WHERE owner=? AND result IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(result,'$.events') WHERE json_extract(value,'$.type')='run.failed') LIMIT 1").get(owner))
  }
  replay(owner, key, payload) {
    const row = this.db.prepare('SELECT hash,status,result FROM relay_renewals WHERE owner=? AND key=?').get(owner, key)
    if (!row) return
    if (row.hash !== hash(payload)) throw new StudioError('同一续用标识不能更改确认参数', 409)
    if (row.status !== 'completed') throw new StudioError('该续用结果待确认，不能再次提交', 409)
    return JSON.parse(row.result)
  }
  begin(owner, key, payload, oldId, target) {
    this.assertReady(owner)
    target = renewalTargetSchema.parse(target)
    if (target.owner !== owner || target.oldBinding.id !== oldId) throw new StudioError('续用批准所属账号或旧令牌不一致', 409)
    this.db.prepare("INSERT INTO relay_renewals(owner,key,hash,old_id,target,status,result,proof) VALUES(?,?,?,?,?,'pending',NULL,NULL)").run(owner, key, hash(payload), oldId, JSON.stringify(target))
  }
  saveProof(owner, key, proof) {
    proof = retirementProofSchema.parse(proof)
    const row = this.db.prepare('SELECT target FROM relay_renewals WHERE owner=? AND key=? AND status=\'pending\' AND proof IS NULL').get(owner, key)
    if (!row) throw new StudioError('续用意图已变化或证据已存在', 409)
    const target = renewalTargetSchema.parse(JSON.parse(row.target))
    const strip = metadata => Object.fromEntries(Object.entries(metadata).filter(([field]) => !['status', 'accessed_time'].includes(field)))
    if (proof.nativeNow < target.approvedNativeNow || JSON.stringify(strip(proof.metadata)) !== JSON.stringify(strip(target.oldMetadata))) throw new StudioError('退休证明与批准快照已变化', 409)
    const changed = this.db.prepare("UPDATE relay_renewals SET proof=? WHERE owner=? AND key=? AND target=? AND status='pending' AND proof IS NULL").run(JSON.stringify(proof), owner, key, row.target)
    if (changed.changes !== 1) throw new StudioError('续用意图已变化，未创建新令牌', 409)
  }
  unknown(owner, key) { this.db.prepare("UPDATE relay_renewals SET status='unknown' WHERE owner=? AND key=? AND status='pending'").run(owner, key) }
  complete(owner, key, binding, result) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare("SELECT target,proof FROM relay_renewals WHERE owner=? AND key=? AND status='pending'").get(owner, key)
      if (!row?.proof) throw new StudioError('退休证据未持久确认，不能切换生成权限', 409)
      const target = renewalTargetSchema.parse(JSON.parse(row.target))
      retirementProofSchema.parse(JSON.parse(row.proof))
      if (!Number.isSafeInteger(binding.id) || binding.id <= 0 || binding.id === target.oldBinding.id || binding.name !== target.approved.name) throw new StudioError('新令牌绑定与批准快照不一致', 409)
      const changed = this.db.prepare("UPDATE relay_renewals SET status='completed',result=? WHERE owner=? AND key=? AND status='pending' AND proof IS NOT NULL").run(JSON.stringify(result), owner, key)
      if (changed.changes !== 1) throw new StudioError('续用状态已变化，未切换生成权限', 409)
      this.db.prepare('INSERT INTO relay_bindings VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token_id=excluded.token_id,token_name=excluded.token_name').run(owner, binding.id, binding.name)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
