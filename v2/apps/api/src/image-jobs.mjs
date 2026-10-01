import { createHash } from 'node:crypto'
import { StudioError } from './images-error.mjs'

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function imageApproval(config, model, account) {
  return digest({ model, gateway: config.gateway, instance: config.accountInstanceId, routing: config.relayRoutingMode,
    credentialMode: config.relayCredentialMode, owner: config.relayOwnerId, cap: config.userTokenQuotaCap,
    lifetime: config.userTokenLifetimeSeconds, trial: config.trial, bindingPolicy: config.tokenRenewalPolicy,
    account: { owner: account.id, group: account.group } })
}
const active = "('accepted','ready','submission_started','output_saved')"
export class ImageJobs {
  constructor(ledger) {
    this.ledger = ledger
    this.db = ledger.db
    this.db.exec(`CREATE TABLE IF NOT EXISTS image_jobs (
      owner INTEGER NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, hash TEXT NOT NULL,
      approval_hash TEXT NOT NULL, model_id TEXT NOT NULL, funding_source TEXT NOT NULL,
      status TEXT NOT NULL, native_pending INTEGER NOT NULL DEFAULT 0,
      output TEXT, asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner,key));
      CREATE UNIQUE INDEX IF NOT EXISTS image_job_owner_active ON image_jobs(owner) WHERE status IN ${active};
      CREATE TABLE IF NOT EXISTS image_job_reservations (owner INTEGER NOT NULL,key TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(owner,key));
      CREATE TABLE IF NOT EXISTS image_job_outbox (owner INTEGER NOT NULL,key TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(owner,key));`)
    this.transaction(() => {
      for (const row of this.db.prepare(`SELECT owner,key,status,native_pending FROM image_jobs WHERE status IN ('accepted','ready','submission_started')`).all()) {
        const submitted = this.db.prepare("SELECT 1 FROM model_submissions WHERE owner=? AND kind='image' AND key=?").get(row.owner, row.key)
        const unsafe = row.native_pending || submitted || row.status === 'submission_started'
          || this.db.prepare("SELECT 1 FROM funding_writes WHERE owner=? AND status IN ('pending','unknown')").get(row.owner)
          || this.db.prepare("SELECT 1 FROM relay_renewals WHERE owner=? AND status IN ('pending','unknown')").get(row.owner)
          || this.db.prepare("SELECT 1 FROM trial_grants WHERE owner=? AND status='unknown'").get(row.owner)
        this.db.prepare('UPDATE image_jobs SET status=?,updated_at=? WHERE owner=? AND key=?').run(unsafe ? 'unknown' : 'needs_authorization', new Date().toISOString(), row.owner, row.key)
        this.db.prepare('UPDATE image_job_reservations SET status=? WHERE owner=? AND key=?').run(unsafe ? 'unknown' : 'released_before_submission', row.owner, row.key)
        this.db.prepare("UPDATE image_job_outbox SET status='deferred' WHERE owner=? AND key=?").run(row.owner, row.key)
      }
    })
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = action(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  active(owner) { return Boolean(this.db.prepare(`SELECT 1 FROM image_jobs WHERE owner=? AND (status IN ${active} OR (status='unknown' AND native_pending=1))`).get(owner)) }
  capacity(limit) {
    if (this.db.prepare(`SELECT COUNT(*) AS n FROM image_jobs WHERE status IN ${active}`).get().n >= limit) throw new StudioError('后台图片任务已达到并发上限，本次尚未受理，请稍后明确发送', 429)
  }
  row(owner, key) { return this.db.prepare('SELECT * FROM image_jobs WHERE owner=? AND key=?').get(owner, key) }
  require(owner, key) {
    const row = this.row(owner, key)
    if (!row) throw new StudioError('图片任务不存在或无权访问', 404)
    return row
  }
  publicRow(owner, key) {
    const row = this.db.prepare('SELECT key,status,native_pending,asset_id,created_at,updated_at FROM image_jobs WHERE owner=? AND key=?').get(owner, key)
    if (!row) throw new StudioError('图片任务不存在或无权访问', 404)
    return row
  }
  payload(row) {
    const payload = JSON.parse(row.payload)
    if (digest(payload) !== row.hash) throw new StudioError('图片任务参数记录已变化，未重新生成', 502)
    return payload
  }
  summary(row) {
    if (!['accepted','ready','submission_started','output_saved','needs_authorization','unknown','completed','cancelled_before_submission'].includes(row.status)) throw new StudioError('图片任务状态无法安全读取', 502)
    return { jobId: row.key, requestId: row.key, kind: 'image', status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at, ...(row.status === 'unknown' && row.native_pending ? { pendingNativeOperation: true } : {}),
      ...(row.asset_id ? { assetId: row.asset_id } : {}) }
  }
  previous(owner, key, payload) {
    const row = this.row(owner, key)
    if (row && row.hash !== digest(payload)) throw new StudioError('同一图片请求标识不能修改参数或付款同意', 409)
    return row
  }
  accept(owner, key, payload, approval, modelId, funding, isBusy, limit) {
    return this.transaction(() => {
      if (isBusy || this.active(owner)) throw new StudioError('本人已有操作正在处理，本次图片任务尚未受理', 409)
      this.capacity(limit)
      const begun = this.ledger.begin(owner, 'image', key, payload)
      if (!begun.started) throw new StudioError('该图片请求标识已经使用，请只读查询原请求，不能另建任务', 409)
      const now = new Date().toISOString()
      this.db.prepare('INSERT INTO image_jobs VALUES(?,?,?,?,?,?,?,?,0,NULL,NULL,?,?)').run(owner, key, JSON.stringify(payload), digest(payload), approval, modelId, funding, 'accepted', now, now)
      this.db.prepare("INSERT INTO image_job_reservations VALUES(?,?,'held')").run(owner, key)
      this.db.prepare("INSERT INTO image_job_outbox VALUES(?,?,'pending')").run(owner, key)
      return this.summary(this.require(owner, key))
    })
  }
  ready(owner, key) {
    const row = this.require(owner, key), original = this.db.prepare("SELECT hash,status FROM requests WHERE owner=? AND kind='image' AND key=?").get(owner, key)
    if (original?.hash !== row.hash || original.status !== 'running') throw new StudioError('原图片请求记录已变化，未发送模型', 409)
    this.change(owner, key, ['accepted'], 'ready')
  }
  change(owner, key, from, status, extra = {}) {
    const row = this.require(owner, key)
    if (!from.includes(row.status)) throw new StudioError('图片任务已变化，未重复执行', 409)
    this.db.prepare('UPDATE image_jobs SET status=?,native_pending=?,updated_at=? WHERE owner=? AND key=? AND status=?').run(status, extra.nativePending ?? row.native_pending, new Date().toISOString(), owner, key, row.status)
  }
  native(owner, key, pending) {
    const row = this.require(owner, key)
    if (row.status !== 'ready') throw new StudioError('图片任务不再允许外发', 409)
    this.db.prepare('UPDATE image_jobs SET native_pending=? WHERE owner=? AND key=? AND status=\'ready\'').run(pending ? 1 : 0, owner, key)
  }
  submitted(owner, key) {
    if (this.db.prepare("SELECT 1 FROM model_submissions WHERE owner=? AND kind='image' AND key=?").get(owner, key)) throw new StudioError('该图片任务已有提交意图，不能重复外发', 409)
    this.change(owner, key, ['ready'], 'submission_started', { nativePending: 0 })
    this.db.prepare("UPDATE image_job_outbox SET status='delivered' WHERE owner=? AND key=?").run(owner, key)
  }
  interrupted(owner, key) {
    this.transaction(() => {
      const row = this.require(owner, key)
      if (['completed','cancelled_before_submission','output_saved'].includes(row.status)) return
      const safe = !row.native_pending && !this.db.prepare("SELECT 1 FROM model_submissions WHERE owner=? AND kind='image' AND key=?").get(owner, key)
        && !this.db.prepare("SELECT 1 FROM funding_writes WHERE owner=? AND status IN ('pending','unknown')").get(owner)
        && !this.db.prepare("SELECT 1 FROM relay_renewals WHERE owner=? AND status IN ('pending','unknown')").get(owner)
        && !this.db.prepare("SELECT 1 FROM trial_grants WHERE owner=? AND status='unknown'").get(owner)
      this.change(owner, key, ['accepted','ready','submission_started'], safe ? 'needs_authorization' : 'unknown')
      this.ledger.unknown(owner, 'image', key)
      this.db.prepare('UPDATE image_job_reservations SET status=? WHERE owner=? AND key=?').run(safe ? 'released_before_submission' : 'unknown', owner, key)
      this.db.prepare("UPDATE image_job_outbox SET status='deferred' WHERE owner=? AND key=?").run(owner, key)
    })
  }
  authorize(owner, key, approval, isBusy, limit) {
    return this.transaction(() => {
      const row = this.require(owner, key)
      if (isBusy || this.active(owner)) throw new StudioError('本人已有操作正在处理，未重新授权图片任务', 409)
      this.capacity(limit)
      if (row.status !== 'needs_authorization' || row.native_pending || approval !== row.approval_hash
        || this.db.prepare("SELECT 1 FROM model_submissions WHERE owner=? AND kind='image' AND key=?").get(owner, key)) throw new StudioError('仅确定未提交且批准配置未变化的图片任务可以重新授权', 409)
      this.change(owner, key, ['needs_authorization'], 'accepted')
      const changed = this.db.prepare("UPDATE requests SET status='running' WHERE owner=? AND kind='image' AND key=? AND hash=? AND status='unknown'").run(owner, key, row.hash)
      if (changed.changes !== 1) throw new StudioError('原图片请求记录已变化，未重新授权', 409)
      this.db.prepare("UPDATE image_job_reservations SET status='held' WHERE owner=? AND key=?").run(owner, key)
      this.db.prepare("UPDATE image_job_outbox SET status='pending' WHERE owner=? AND key=?").run(owner, key)
      return this.summary(this.require(owner, key))
    })
  }
  cancel(owner, key) {
    return this.transaction(() => {
      const row = this.require(owner, key)
      if (row.status === 'cancelled_before_submission') return this.summary(row)
      if (!['accepted','ready','needs_authorization'].includes(row.status) || row.native_pending
        || this.db.prepare("SELECT 1 FROM model_submissions WHERE owner=? AND kind='image' AND key=?").get(owner, key)
        || this.db.prepare("SELECT 1 FROM trial_reservations WHERE owner=? AND request_kind='image' AND key=?").get(owner, key)) throw new StudioError('无法证明图片任务尚未提交，不能取消或释放次数；未请求供应商退款', 409)
      this.change(owner, key, ['accepted','ready','needs_authorization'], 'cancelled_before_submission')
      this.db.prepare("UPDATE requests SET status='cancelled_before_submission' WHERE owner=? AND kind='image' AND key=?").run(owner, key)
      this.db.prepare("UPDATE image_job_reservations SET status='released_before_submission' WHERE owner=? AND key=?").run(owner, key)
      this.db.prepare("UPDATE image_job_outbox SET status='cancelled' WHERE owner=? AND key=?").run(owner, key)
      return this.summary(this.require(owner, key))
    })
  }
  saveOutput(owner, key, result, assetId) {
    this.change(owner, key, ['submission_started'], 'output_saved')
    this.db.prepare('UPDATE image_jobs SET output=?,asset_id=? WHERE owner=? AND key=?').run(JSON.stringify(result), assetId, owner, key)
  }
  finalize(owner, key, result) {
    const row = this.require(owner, key), original = this.db.prepare("SELECT hash,status FROM requests WHERE owner=? AND kind='image' AND key=?").get(owner, key)
    if (original?.hash !== row.hash || !['running','unknown'].includes(original.status)) throw new StudioError('原图片请求记录已变化，不能覆盖终态', 409)
    this.change(owner, key, ['output_saved'], 'completed')
    this.ledger.complete(owner, 'image', key, result)
    this.db.prepare("UPDATE image_job_reservations SET status='used' WHERE owner=? AND key=?").run(owner, key)
  }
  pendingOutputs() { return this.db.prepare("SELECT owner,key FROM image_jobs WHERE status='output_saved'").all() }
}
