import { StudioError } from './images-error.mjs'
import { readBillingPreference, selectBillingPreference } from './funding.mjs'

// This is a safety barrier for account-wide native preference writes, not funds.
// A timed-out PUT can still finish later. A subsequent GET cannot prove that
// handler has stopped, so an ambiguous write blocks all new sends until an
// operator reconciles it. Never restore the old preference in a finally block.
export class FundingState {
  constructor(db) {
    this.db = db
    const upgrading = !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='funding_writes'").get()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS funding_writes (owner INTEGER PRIMARY KEY,
        preference TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`)
      // Older ledgers had no durable preference-write barrier. A pre-response
      // unknown run may include a still-running native PUT. Preserve that doubt
      // on the first upgrade instead of allowing a later wallet request to race it.
      if (upgrading && db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trial_grants'").get()) {
        db.prepare(`INSERT OR IGNORE INTO funding_writes
          SELECT DISTINCT g.owner,'subscription_only','unknown',? FROM trial_grants g
          WHERE g.status='unknown' OR EXISTS (SELECT 1 FROM requests r WHERE r.owner=g.owner AND r.status='unknown'
            AND NOT EXISTS (SELECT 1 FROM gateway_attempts a WHERE a.owner=r.owner AND a.kind=r.kind AND a.key=r.key))`).run(new Date().toISOString())
      }
      db.exec("UPDATE funding_writes SET status='unknown' WHERE status='pending'")
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  blocked(owner) { return ['pending', 'unknown'].includes(this.db.prepare('SELECT status FROM funding_writes WHERE owner=?').get(owner)?.status) }
  assertReady(owner) {
    if (this.blocked(owner)) throw new StudioError('账号付款偏好写入结果待核对，已暂停生成；请联系管理员确认旧请求已结束，不要重复提交', 409)
  }
  async select(config, authorization, owner, preference, fetcher) {
    if (!['subscription_only', 'wallet_only'].includes(preference)) throw new StudioError('付款偏好必须明确为仅订阅或仅余额', 400)
    this.assertReady(owner)
    if (await readBillingPreference(config, authorization, fetcher) === preference) return
    this.db.prepare(`INSERT INTO funding_writes VALUES(?,?,'pending',?)
      ON CONFLICT(owner) DO UPDATE SET preference=excluded.preference,status='pending',updated_at=excluded.updated_at`).run(owner, preference, new Date().toISOString())
    try {
      await selectBillingPreference(config, authorization, preference, fetcher)
      if (await readBillingPreference(config, authorization, fetcher) !== preference) throw new StudioError('账号付款偏好确认失败，已暂停生成', 502)
      this.db.prepare("UPDATE funding_writes SET status='confirmed',updated_at=? WHERE owner=?").run(new Date().toISOString(), owner)
    } catch (error) {
      this.db.prepare("UPDATE funding_writes SET status='unknown',updated_at=? WHERE owner=?").run(new Date().toISOString(), owner)
      throw error
    }
  }
}
