import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function rowHash(instanceId, owner, row) {
  return createHash('sha256').update(JSON.stringify({ instanceId, owner, preference: row.preference, status: row.status, updatedAt: row.updated_at })).digest('hex')
}

// Runs without a network or Docker socket. Only the trusted host orchestrator
// may send clear after observing the old native process stop and a new start.
export class RecoverySession {
  constructor(path, owner, instanceId) {
    if (!Number.isSafeInteger(owner) || owner <= 0 || !/^[0-9a-f-]{36}$/.test(instanceId)) throw new Error('Invalid owner or instance identity')
    this.path = path; this.owner = owner; this.instanceId = instanceId; this.nonce = randomUUID()
    try {
      this.lock = new DatabaseSync(`${path}.process-lock`)
      this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
      this.db = new DatabaseSync(path, { readOnly: true })
      this.inspect()
    } catch (error) { this.close(); throw error }
  }
  inspect() {
    const installation = this.db.prepare('SELECT instance_id FROM trial_installation WHERE id=1').get()
    if (installation?.instance_id !== this.instanceId) throw new Error('Ledger instance identity does not match')
    const row = this.db.prepare('SELECT preference,status,updated_at FROM funding_writes WHERE owner=?').get(this.owner)
    if (!row) throw new Error('No funding write for this owner')
    return { owner: this.owner, instanceId: this.instanceId, row: { ...row }, hash: rowHash(this.instanceId, this.owner, row), session: this.nonce }
  }
  clear(expectedHash, session, receipt) {
    if (session !== this.nonce || this.cleared) throw new Error('Recovery session is invalid or already consumed')
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error('An exact expected row hash is required')
    if (receipt?.session !== this.nonce || receipt?.version !== 1 || receipt.instanceId !== this.instanceId
      || !/^[0-9a-f]{64}$/.test(receipt.containerId ?? '')
      || !/^sha256:[0-9a-f]{64}$/.test(receipt.imageId ?? '')
      || !['a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529', '8689cc98471806eb03093849abdcfe974e582b85571b44da0d1816b21b360227'].includes(receipt.binarySha256)
      || receipt.stopped?.running !== false || receipt.stopped?.pid !== 0
      || receipt.started?.running !== true || receipt.started?.healthy !== true
      || !receipt.oldStartedAt || !receipt.started.startedAt || receipt.oldStartedAt === receipt.started.startedAt) throw new Error('Restart receipt is incomplete or belongs to a different session')
    const inspected = this.inspect()
    if (inspected.hash !== expectedHash || !['pending', 'unknown'].includes(inspected.row.status)) throw new Error('Funding barrier changed or is not recoverable')
    this.db.close(); this.db = undefined; this.db = new DatabaseSync(this.path)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.inspect()
      if (current.hash !== expectedHash) throw new Error('Funding barrier changed during recovery')
      this.db.exec(`CREATE TABLE IF NOT EXISTS funding_recoveries (
        id TEXT PRIMARY KEY, owner INTEGER NOT NULL, original_hash TEXT NOT NULL,
        original_preference TEXT NOT NULL, original_status TEXT NOT NULL,
        original_updated_at TEXT NOT NULL, evidence TEXT NOT NULL, reconciled_at TEXT NOT NULL)`)
      const now = new Date().toISOString(), recoveryId = randomUUID()
      this.db.prepare('INSERT INTO funding_recoveries VALUES(?,?,?,?,?,?,?,?)').run(
        recoveryId, this.owner, expectedHash, current.row.preference, current.row.status, current.row.updated_at, JSON.stringify(receipt), now)
      const changed = this.db.prepare("UPDATE funding_writes SET status='reconciled',updated_at=? WHERE owner=? AND preference=? AND status=? AND updated_at=?").run(
        now, this.owner, current.row.preference, current.row.status, current.row.updated_at)
      if (changed.changes !== 1) throw new Error('Funding barrier changed during recovery')
      this.db.exec('COMMIT'); this.cleared = true
      return { recoveryId, owner: this.owner, status: 'reconciled', message: 'Old handler barrier reconciled; no native preference or charges were confirmed. New sends must still select and confirm their source.' }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  close() {
    try { this.db?.close(); this.db = undefined }
    finally { this.lock?.close(); this.lock = undefined }
  }
}

async function* boundedLines(input) {
  let pending = Buffer.alloc(0)
  for await (const chunk of input) {
    let start = 0
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start)
      const end = newline < 0 ? chunk.length : newline
      if (pending.length + end - start > 32768) throw new Error('Recovery command exceeds its limit')
      pending = Buffer.concat([pending, chunk.subarray(start, end)])
      if (newline < 0) break
      yield pending.toString('utf8')
      pending = Buffer.alloc(0)
      start = newline + 1
    }
  }
  if (pending.length) yield pending.toString('utf8')
}

async function main() {
  let session
  try {
    session = new RecoverySession(process.argv[2], Number(process.argv[3]), process.argv[4])
    for await (const line of boundedLines(process.stdin)) {
      const command = JSON.parse(line)
      if (command.command === 'abort') { process.stdout.write('{"ok":true,"aborted":true}\n'); break }
      let data
      if (command.command === 'inspect') data = session.inspect()
      else if (command.command === 'clear') data = session.clear(command.expectedHash, command.session, command.receipt)
      else throw new Error('Only inspect, clear and abort are supported')
      process.stdout.write(JSON.stringify({ ok: true, data }) + '\n')
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n'); process.exitCode = 1
  } finally { session?.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
