import { StudioError } from './images.mjs'
import { normalizeResultUsage } from './billing.mjs'

// 与幂等账本共用数据库；只保存业务会话，不复制账号或网关凭据。
export class History {
  constructor(db) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS studio_threads (
      id TEXT PRIMARY KEY, owner INTEGER NOT NULL, title TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_runs (
      owner INTEGER NOT NULL, run_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      prompt TEXT NOT NULL, model TEXT, status TEXT NOT NULL, events TEXT NOT NULL,
      usage TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner, run_id));
      CREATE TABLE IF NOT EXISTS studio_run_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner INTEGER NOT NULL, run_id TEXT NOT NULL, event TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_events_run ON studio_run_events(owner, run_id, sequence);
      CREATE INDEX IF NOT EXISTS studio_threads_owner ON studio_threads(owner, updated_at);
      CREATE INDEX IF NOT EXISTS studio_runs_thread ON studio_runs(owner, thread_id, created_at);`)
    db.prepare("UPDATE studio_runs SET status='unknown', updated_at=? WHERE status='running'").run(new Date().toISOString())
  }
  thread(row) { return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at } }
  list(owner, offset = 0, search = '') {
    const pattern = '%' + search.replace(/[\\%_]/g, character => '\\' + character) + '%'
    return (search ? this.db.prepare("SELECT * FROM studio_threads WHERE owner=? AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC, id DESC LIMIT 51 OFFSET ?").all(owner, pattern, offset)
      : this.db.prepare('SELECT * FROM studio_threads WHERE owner=? ORDER BY updated_at DESC, id DESC LIMIT 51 OFFSET ?').all(owner, offset)).map(row => this.thread(row))
  }
  create(owner, title) {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    this.db.prepare('INSERT INTO studio_threads VALUES(?,?,?,?,?)').run(id, owner, title, now, now)
    return { id, title, createdAt: now, updatedAt: now }
  }
  require(owner, id) {
    const row = this.db.prepare('SELECT * FROM studio_threads WHERE owner=? AND id=?').get(owner, id)
    if (!row) throw new StudioError('会话不存在或无权访问', 404)
    return this.thread(row)
  }
  run(row) {
    return normalizeResultUsage({ runId: row.run_id, threadId: row.thread_id, prompt: row.prompt, model: row.model,
      status: row.status, events: row.status === 'running' || row.status === 'unknown' ? this.db.prepare('SELECT event FROM studio_run_events WHERE owner=? AND run_id=? ORDER BY sequence').all(row.owner, row.run_id).map(event => JSON.parse(event.event)) : JSON.parse(row.events), ...(row.usage ? { usage: JSON.parse(row.usage) } : {}),
      createdAt: row.created_at, updatedAt: row.updated_at })
  }
  getRun(owner, id) {
    const row = this.db.prepare('SELECT * FROM studio_runs WHERE owner=? AND run_id=?').get(owner, id)
    if (!row) throw new StudioError('任务不存在或无权访问', 404)
    return this.run(row)
  }
  detail(owner, id, offset = 0) {
    const thread = this.require(owner, id)
    const runs = this.db.prepare('SELECT * FROM studio_runs WHERE owner=? AND thread_id=? ORDER BY created_at DESC, rowid DESC LIMIT 51 OFFSET ?').all(owner, id, offset)
    return { ...thread, runs: runs.slice(0, 50).reverse().map(row => this.run(row)), nextOffset: runs.length > 50 ? offset + 50 : null }
  }
  context(owner, id) {
    // 只把已保存的用户与助手文本传给模型，不接受客户端伪造会话历史。
    const runs = this.db.prepare("SELECT * FROM studio_runs WHERE owner=? AND thread_id=? AND status='completed' ORDER BY created_at DESC, rowid DESC LIMIT 6").all(owner, id).reverse()
    return runs.flatMap(row => {
      const text = JSON.parse(row.events).filter(event => event.type === 'message.delta').map(event => event.delta).join('')
      return [{ role: 'user', content: row.prompt }, ...(text ? [{ role: 'assistant', content: text.slice(0, 8000) }] : [])]
    })
  }
  begin(owner, payload) {
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO studio_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner, payload.runId, payload.threadId, payload.prompt, payload.model ?? null, 'running', '[]', null, now, now)
    // 只用首条真正执行的消息命名默认会话，保留用户自定义标题。
    this.db.prepare(`UPDATE studio_threads SET title=? WHERE owner=? AND id=?
      AND title IN ('新会话','新对话')
      AND (SELECT COUNT(*) FROM studio_runs WHERE owner=? AND thread_id=?)=1`)
      .run(Array.from(payload.prompt.trim()).slice(0, 50).join(''), owner, payload.threadId, owner, payload.threadId)
    this.touch(owner, payload.threadId, now)
  }
  touch(owner, threadId, now) {
    this.db.prepare('UPDATE studio_threads SET updated_at=? WHERE owner=? AND id=?').run(now, owner, threadId)
  }
  event(owner, id, event) {
    // 终态和费用在账本完成后一起发布，流中只落盘进度。
    if (['run.completed', 'run.failed'].includes(event.type)) return
    const row = this.db.prepare('SELECT thread_id FROM studio_runs WHERE owner=? AND run_id=?').get(owner, id)
    if (!row) throw new StudioError('任务不存在或无权访问', 404)
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO studio_run_events(owner,run_id,event) VALUES(?,?,?)').run(owner, id, JSON.stringify(event))
    this.db.prepare('UPDATE studio_runs SET updated_at=? WHERE owner=? AND run_id=?').run(now, owner, id)
    this.touch(owner, row.thread_id, now)
  }

  finish(owner, id, result) {
    const status = result.events.at(-1)?.type === 'run.completed' ? 'completed' : 'failed'
    const now = new Date().toISOString()
    this.db.prepare('UPDATE studio_runs SET events=?,usage=?,status=?,updated_at=? WHERE owner=? AND run_id=?').run(JSON.stringify(result.events), result.usage ? JSON.stringify(result.usage) : null, status, now, owner, id)
    this.touch(owner, this.getRun(owner, id).threadId, now)
    this.db.prepare('DELETE FROM studio_run_events WHERE owner=? AND run_id=?').run(owner, id)
  }
  unknown(owner, id) {
    this.db.prepare("UPDATE studio_runs SET status='unknown',updated_at=? WHERE owner=? AND run_id=?").run(new Date().toISOString(), owner, id)
  }
}
