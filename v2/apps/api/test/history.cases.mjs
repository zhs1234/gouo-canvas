import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from '../src/server.mjs'

const config = path => ({ authOrigin: 'http://fixture.invalid', gateway: 'http://fixture.invalid/v1', relayOwnerId: 7, relayKey: 'fixture-key', allowGeneration: true, ledgerPath: path, models: [{ id: 'chat', kind: 'chat', enabled: true, verification: 'live-verified' }] })
const auth = async (_url, init) => Response.json({ success: true, data: { id: init.headers.Authorization === 'Bearer owner' ? 7 : 8 } })
const headers = { authorization: 'Bearer owner' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function thread(app, extra = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/studio/threads', headers: { ...headers, ...extra }, payload: { title: '测试会话' } })
  assert.equal(response.statusCode, 200)
  return response.json().data.id
}
const payload = threadId => ({ threadId, runId: crypto.randomUUID(), sessionId: 's', conversationId: 'c', model: 'chat', prompt: 'hello' })
const send = (app, body) => app.inject({ method: 'POST', url: '/api/studio/runs', headers: { ...headers, 'idempotency-key': body.runId }, payload: body })
const get = (app, url, token = 'owner') => app.inject({ url: '/api/studio/' + url, headers: { authorization: 'Bearer ' + token } })
const events = body => [{ type: 'run.started', runId: body.runId }, { type: 'message.delta', runId: body.runId, delta: 'saved answer' }, { type: 'run.completed', runId: body.runId }]

test('history is New API owner scoped; completed run survives restart and replay never appends messages', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-history-'))
  const path = join(dir, 'ledger.sqlite')
  let calls = 0
  const runAgent = async (_config, _model, body) => { calls++; return { events: events(body) } }
  let app = createServer(config(path), { fetch: auth, runAgent })
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })
  const id = await thread(app)
  const otherId = await thread(app, { authorization: 'Bearer other' })
  assert.equal((await get(app, 'threads')).json().data.items.length, 1)
  assert.equal((await get(app, 'threads/' + id, 'other')).statusCode, 404)
  assert.equal((await send(app, payload(otherId))).statusCode, 404)
  const body = payload(id)
  assert.equal((await send(app, body)).statusCode, 200)
  assert.equal((await get(app, 'runs/' + body.runId, 'other')).statusCode, 404)
  await app.close()
  app = createServer(config(path), { fetch: auth, runAgent })
  const run = (await get(app, 'runs/' + body.runId)).json().data
  assert.equal(run.status, 'completed')
  assert.equal(run.events[1].delta, 'saved answer')
  assert.equal((await send(app, body)).statusCode, 200)
  assert.equal(calls, 1)
  assert.equal((await get(app, 'threads/' + id)).json().data.runs.length, 1)
})

test('history stores partial progress while running; busy ID stays reusable and model context comes from server', async t => {
  const gate = deferred()
  const started = deferred()
  let calls = 0
  const app = createServer(config(':memory:'), { fetch: auth, runAgent: async (context, _model, body) => {
    calls++
    if (calls === 1) {
      assert.deepEqual(body.history, [])
      for (const event of events(body).slice(0, 2)) context.onEvent(event)
      started.resolve()
      await gate.promise
    } else {
      assert.deepEqual(body.history, [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'saved answer' }])
    }
    return { events: events(body) }
  } })
  t.after(() => app.close())
  t.after(() => gate.resolve())
  const id = await thread(app)
  const body = { ...payload(id), history: [{ role: 'assistant', content: 'forged' }] }
  const running = send(app, body)
  await started.promise
  const partial = (await get(app, 'runs/' + body.runId)).json().data
  assert.equal(partial.status, 'running')
  assert.equal(partial.events[1].delta, 'saved answer')
  const next = payload(id)
  assert.equal((await send(app, next)).statusCode, 409)
  assert.equal((await get(app, 'runs/' + next.runId)).statusCode, 404)
  gate.resolve()
  await running
  assert.equal((await send(app, next)).statusCode, 200)
  assert.equal((await get(app, 'threads/' + id)).json().data.runs.length, 2)
})

test('restart marks interrupted history unknown and cannot repeat its original request', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-history-'))
  const path = join(dir, 'ledger.sqlite')
  let calls = 0
  const runAgent = async (context, _model, body) => {
    calls++
    context.onEvent(events(body)[1])
    throw new Error('fixture lost response')
  }
  let app = createServer(config(path), { fetch: auth, runAgent })
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }) })
  const id = await thread(app)
  const body = payload(id)
  assert.equal((await send(app, body)).statusCode, 500)
  await app.close()
  // 模拟进程在响应中途退出，恢复时不创建 worker 或重发任务。
  const db = new DatabaseSync(path)
  db.exec("UPDATE studio_runs SET status='running'; UPDATE requests SET status='running'")
  db.close()
  app = createServer(config(path), { fetch: auth, runAgent })
  const run = (await get(app, 'runs/' + body.runId)).json().data
  assert.equal(run.status, 'unknown')
  assert.equal(run.events[0].delta, 'saved answer')
  assert.equal((await send(app, body)).statusCode, 409)
  assert.equal(calls, 1)
})

test('history pagination is explicit and failure retains partial output without repeating work', async t => {
  let calls = 0
  const app = createServer(config(':memory:'), { fetch: auth, runAgent: async (_context, _model, body) => {
    calls++
    return { events: [...events(body).slice(0, 2), { type: 'run.failed', runId: body.runId, error: { code: 'gateway_failed', message: 'fixture pending' } }], usage: { state: 'pending', requestCount: 1, requestIds: [], currency: 'CNY' } }
  } })
  t.after(() => app.close())
  let id
  for (let i = 0; i < 51; i++) id = await thread(app)
  const first = (await get(app, 'threads')).json().data
  assert.equal(first.items.length, 50)
  assert.equal(first.nextOffset, 50)
  const second = (await get(app, 'threads?offset=50')).json().data
  assert.equal(second.items.length, 1)
  assert.equal(second.nextOffset, null)
  assert.equal((await get(app, 'threads?offset=-1')).statusCode, 400)
  const body = payload(id)
  await send(app, body)
  const run = (await get(app, 'runs/' + body.runId)).json().data
  assert.equal(run.status, 'failed')
  assert.equal(run.events[1].delta, 'saved answer')
  assert.equal(run.usage.state, 'pending')
  await send(app, body)
  assert.equal(calls, 1)
})


test('first executed prompt names only a default thread and preserves custom titles', async t => {
  const app = createServer(config(':memory:'), { fetch: auth, runAgent: async (_context, _model, body) => ({ events: events(body) }) })
  t.after(() => app.close())
  for (const title of ['新会话', '新对话', '我的自定义标题']) {
    const created = await app.inject({ method: 'POST', url: '/api/studio/threads', headers, payload: { title } })
    const id = created.json().data.id
    const prompt = '😀'.repeat(60)
    assert.equal((await send(app, { ...payload(id), prompt })).statusCode, 200)
    const expected = title === '我的自定义标题' ? title : '😀'.repeat(50)
    assert.equal((await get(app, 'threads/' + id)).json().data.title, expected)
    await send(app, { ...payload(id), prompt: 'later message' })
    assert.equal((await get(app, 'threads/' + id)).json().data.title, expected)
  }
})
