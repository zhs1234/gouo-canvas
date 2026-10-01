import { createHash } from 'node:crypto'
import { StudioError } from './images-error.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
  }
  binding(owner) {
    const row = this.db.prepare('SELECT token_id,token_name FROM relay_bindings WHERE owner=?').get(owner)
    return row && { id: row.token_id, name: row.token_name }
  }
  blocked(owner) { return Boolean(this.db.prepare("SELECT 1 FROM relay_renewals WHERE owner=? AND status IN ('pending','unknown')").get(owner)) }
  assertReady(owner) { if (this.blocked(owner)) throw new StudioError('生成权限续用结果待核对，已暂停新生成；请联系管理员，不要重复提交', 409) }
  unresolvedGeneration(owner) {
    return Boolean(this.db.prepare("SELECT 1 FROM requests WHERE owner=? AND status!='completed' LIMIT 1").get(owner))
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
    this.db.prepare("INSERT INTO relay_renewals VALUES(?,?,?,?,?,'pending',NULL)").run(owner, key, hash(payload), oldId, JSON.stringify(target))
  }
  unknown(owner, key) { this.db.prepare("UPDATE relay_renewals SET status='unknown' WHERE owner=? AND key=? AND status='pending'").run(owner, key) }
  complete(owner, key, binding, result) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const changed = this.db.prepare("UPDATE relay_renewals SET status='completed',result=? WHERE owner=? AND key=? AND status='pending'").run(JSON.stringify(result), owner, key)
      if (changed.changes !== 1) throw new StudioError('续用状态已变化，未切换生成权限', 409)
      this.db.prepare('INSERT INTO relay_bindings VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token_id=excluded.token_id,token_name=excluded.token_name').run(owner, binding.id, binding.name)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
