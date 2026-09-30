import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
export class Ledger {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (
      owner INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, PRIMARY KEY(owner,kind,key))`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS gateway_attempts (
      owner INTEGER NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, attempt INTEGER NOT NULL,
      request_id TEXT, status INTEGER NOT NULL, PRIMARY KEY(owner,kind,key,attempt))`)
    // This synchronous integration has no durable worker. A crash cannot safely
    // establish whether a paid call finished; keep it blocked, never resubmit it.
    this.db.exec("UPDATE requests SET status='unknown' WHERE status='running'")
  }
  begin(owner, kind, key, payload, busy = false) {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const row = this.db.prepare('SELECT * FROM requests WHERE owner=? AND kind=? AND key=?').get(owner, kind, key)
    if (row) {
      if (row.hash !== hash) return { conflict: true }
      if (row.status === 'completed') return { result: JSON.parse(row.result) }
      return { blocked: true }
    }
    // 已有结果仍可重放；忙碌时不为尚未执行的新请求创建不确定记录。
    if (busy) return { busy: true }
    this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?)').run(owner, kind, key, hash, 'running', null, new Date().toISOString())
    return { started: true }
  }
  complete(owner, kind, key, result) {
    this.db.prepare("UPDATE requests SET status='completed', result=? WHERE owner=? AND kind=? AND key=?").run(JSON.stringify(result), owner, kind, key)
  }
  unknown(owner, kind, key) {
    this.db.prepare("UPDATE requests SET status='unknown' WHERE owner=? AND kind=? AND key=?").run(owner, kind, key)
  }
  releaseUnstarted(owner, kind, key) {
    this.db.prepare("DELETE FROM requests WHERE owner=? AND kind=? AND key=? AND status='running'").run(owner, kind, key)
  }
  gateway(owner, kind, key, info) {
    const attempt = this.db.prepare('SELECT COUNT(*) AS count FROM gateway_attempts WHERE owner=? AND kind=? AND key=?').get(owner, kind, key).count + 1
    const id = typeof info.requestId === 'string' && /^[\w-]{1,64}$/.test(info.requestId) ? info.requestId : null
    this.db.prepare('INSERT INTO gateway_attempts VALUES(?,?,?,?,?,?)').run(owner, kind, key, attempt, id, Number.isInteger(info.status) ? info.status : 0)
  }
  detail(owner, kind, key) {
    const row = this.db.prepare('SELECT status FROM requests WHERE owner=? AND kind=? AND key=?').get(owner, kind, key)
    if (!row) return null
    return { status: row.status, attempts: this.db.prepare('SELECT attempt, request_id AS requestId, status FROM gateway_attempts WHERE owner=? AND kind=? AND key=? ORDER BY attempt').all(owner, kind, key) }
  }
  close() { this.db.close() }
}
