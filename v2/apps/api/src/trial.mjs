import { StudioError } from './images-error.mjs'

const limits = { chat: 4, image: 1 }

// This stores non-monetary introductory benefits. New API owns the funds,
// token quota, pre-consumption and settlement; no balance is mirrored here.
export class Trial {
  constructor(db, policy, accountInstanceId = policy?.instanceId) {
    this.db = db
    this.policy = policy
    db.exec(`CREATE TABLE IF NOT EXISTS trial_installation (id INTEGER PRIMARY KEY CHECK(id=1), instance_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trial_grants (owner INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL,
        subscription_id INTEGER, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trial_reservations (owner INTEGER NOT NULL, request_kind TEXT NOT NULL,
        key TEXT NOT NULL, benefit TEXT NOT NULL, status TEXT NOT NULL,
        PRIMARY KEY(owner,request_kind,key,benefit))`)
    if (accountInstanceId) {
      const installation = db.prepare('SELECT instance_id FROM trial_installation WHERE id=1').get()
      if (installation && installation.instance_id !== accountInstanceId) throw new Error('业务数据库属于另一 New API 实例，请隔离数据；不能重复使用账号 ID')
      db.prepare('INSERT OR IGNORE INTO trial_installation VALUES(1,?)').run(accountInstanceId)
    } else if (db.prepare('SELECT instance_id FROM trial_installation WHERE id=1').get()) {
      throw new Error('业务数据库已有账号实例标识，必须提供相同的 GOUO_ACCOUNT_INSTANCE_ID；不能通过关闭试用取消绑定')
    }
    // Ledger's exclusive process lock is held before restart recovery.
    db.exec("UPDATE trial_grants SET status='unknown' WHERE status='claiming'; UPDATE trial_reservations SET status='unknown' WHERE status='reserved'")
  }
  grant(owner) { return this.db.prepare('SELECT * FROM trial_grants WHERE owner=?').get(owner) }
  beginClaim(owner) {
    const existing = this.grant(owner)
    if (existing) return false
    this.db.prepare('INSERT INTO trial_grants VALUES(?,?,NULL,?,?)').run(owner, this.policy.planId, 'claiming', new Date().toISOString())
    return true
  }
  activate(owner, subscriptionId) {
    const existing = this.grant(owner)
    if (existing && (existing.plan_id !== this.policy.planId || (existing.subscription_id && existing.subscription_id !== subscriptionId))) throw new StudioError('试用领取证据变化，请联系管理员核对；未重新领取', 409)
    if (!existing) this.beginClaim(owner)
    this.db.prepare("UPDATE trial_grants SET subscription_id=?, status='active' WHERE owner=?").run(subscriptionId, owner)
  }
  unknownClaim(owner) { this.db.prepare("UPDATE trial_grants SET status='unknown' WHERE owner=? AND status='claiming'").run(owner) }
  remaining(owner, benefit) {
    if (!(benefit in limits)) throw new StudioError('试用类型无效', 500)
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM trial_reservations WHERE owner=? AND benefit=?').get(owner, benefit).n
    return Math.max(0, limits[benefit] - count)
  }
  assertAvailable(owner, benefit) {
    if (this.remaining(owner, benefit) === 0) throw new StudioError(`${benefit === 'chat' ? '聊天' : '生图'}试用次数已用完，请充值后明确勾选本次使用 New API 余额`, 402)
  }
  reserve(owner, requestKind, key, benefit) {
    if (!(benefit in limits)) throw new StudioError('试用类型无效', 500)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const grant = this.grant(owner)
      if (grant?.status !== 'active' || grant.plan_id !== this.policy.planId) throw new StudioError('试用尚未开通或领取结果待确认', 409)
      const existing = this.db.prepare('SELECT status FROM trial_reservations WHERE owner=? AND request_kind=? AND key=? AND benefit=?').get(owner, requestKind, key, benefit)
      if (existing && benefit === 'image') throw new StudioError('本次发送已提交生图请求，不能再次提交', 402)
      // A bounded tool loop's subsequent chat calls belong to the same send.
      if (!existing) {
        this.assertAvailable(owner, benefit)
        this.db.prepare('INSERT INTO trial_reservations VALUES(?,?,?,?,?)').run(owner, requestKind, key, benefit, 'reserved')
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  finish(owner, requestKind, key, success) {
    this.db.prepare('UPDATE trial_reservations SET status=? WHERE owner=? AND request_kind=? AND key=? AND status=\'reserved\'').run(success ? 'used' : 'unknown', owner, requestKind, key)
  }
  summary(owner, state, message) {
    const benefit = kind => {
      const rows = this.db.prepare('SELECT status,COUNT(*) AS n FROM trial_reservations WHERE owner=? AND benefit=? GROUP BY status').all(owner, kind)
      const used = rows.find(r => r.status === 'used')?.n ?? 0
      const held = rows.filter(r => r.status !== 'used').reduce((n, row) => n + row.n, 0)
      return { limit: limits[kind], remaining: Math.max(0, limits[kind] - used - held), used, held }
    }
    const chat = benefit('chat'), image = benefit('image')
    const pendingReconciliation = this.grant(owner)?.status === 'unknown' || chat.held > 0 || image.held > 0
    if (state === 'active' && chat.remaining === 0 && image.remaining === 0) state = 'exhausted'
    if (state === 'active' && pendingReconciliation) state = 'pending'
    // Disabled/unavailable never presents an unissued benefit as usable.
    if (!['active', 'pending', 'eligible'].includes(state)) {
      if (this.grant(owner)?.status === 'active' && (chat.remaining > 0 || image.remaining > 0)) { chat.preservedRemaining = chat.remaining; image.preservedRemaining = image.remaining }
      chat.remaining = 0; image.remaining = 0
    }
    return { state, message, chat, image, pendingReconciliation }
  }
}
