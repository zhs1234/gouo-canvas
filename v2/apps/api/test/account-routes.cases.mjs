import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from '../src/server.mjs'

const config = { models: [], authOrigin: 'http://native-fixture.invalid', gateway: 'http://native-fixture.invalid/v1', allowGeneration: false, ledgerPath: ':memory:' }
const headers = owner => ({ authorization: `Bearer fixture-${owner}` })
const rotation = { success: true, message: '', data: { access_token: 'fixture-rotated-secret', token_type: 'Bearer', access_expires_at: 100, session: { sid: 'fixture-sid', current: true }, has_password: true, notification_warning: false } }
function fixture(onPut = async () => Response.json({ success: true, message: '' })) {
  const puts = []
  const fetch = async (url, init) => {
    assert.equal(url.pathname, '/api/user/self')
    const owner = Number(init.headers.Authorization?.slice('Bearer fixture-'.length))
    assert.ok(owner === 7 || owner === 8)
    if (init.method !== 'PUT') return Response.json({ success: true, message: '', data: { id: owner, status: 1 } })
    const call = { owner, init, body: JSON.parse(init.body) }; puts.push(call)
    return onPut(call)
  }
  return { fetch, puts }
}

test('exact account route requires caller auth and rejects setting/owner/login DTOs before Native mutation', async t => {
  const f = fixture(), app = createServer(config, { fetch: f.fetch }); t.after(() => app.close())
  assert.equal((await app.inject({ method: 'PUT', url: '/api/user/self', payload: { display_name: '名称' } })).statusCode, 401)
  for (const payload of [{ id: 8, display_name: '名称' }, { role: 100 }, { language: 'zh' }, { sidebar_modules: '{}' }, { password_encrypted: 'ciphertext', encryption_key_id: 'key' }, { display_name: '名称', password: 'new-password' }]) {
    assert.equal((await app.inject({ method: 'PUT', url: '/api/user/self?original=1', headers: headers(7), payload })).statusCode, 422)
  }
  assert.equal(f.puts.length, 0)
  const response = await app.inject({ method: 'PUT', url: '/api/user/self', headers: { ...headers(7), cookie: 'unrelated=never-forward', 'x-auth-session': 'fixture-sid' }, payload: { display_name: '新名称' } })
  assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store')
  assert.deepEqual(response.json(), { success: true, message: '' })
  assert.equal(f.puts.length, 1); assert.equal(f.puts[0].owner, 7)
  assert.deepEqual(f.puts[0].init.headers, { Authorization: 'Bearer fixture-7', 'X-Auth-Session': 'fixture-sid', 'Content-Type': 'application/json' })
})

test('Native security proof failure, rotation and uncertain password result are forwarded once and never persisted', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-account-route-')), path = join(directory, 'ledger.sqlite')
  let mode = 'proof'
  const f = fixture(async () => {
    if (mode === 'proof') return Response.json({ success: false, message: 'verify', code: 'SECURITY_PROOF_REQUIRED' }, { status: 403 })
    if (mode === 'rotation') return Response.json(rotation)
    throw new Error('connection lost after Native may have committed')
  })
  const app = createServer({ ...config, ledgerPath: path }, { fetch: f.fetch })
  t.after(async () => { await app.close(); assert.equal(resolve(dirname(directory)), resolve(tmpdir())); rmSync(directory, { recursive: true, force: true }) })
  const send = () => app.inject({ method: 'PUT', url: '/api/user/self', headers: { ...headers(7), 'x-security-proof': 'fixture-proof-secret' }, payload: { password: 'fixture-password-secret', original_password: 'fixture-original-secret' } })
  const proof = await send(); assert.equal(proof.statusCode, 403); assert.equal(proof.json().code, 'SECURITY_PROOF_REQUIRED')
  mode = 'rotation'; assert.deepEqual((await send()).json(), rotation)
  mode = 'unknown'; const unknown = await send(); assert.equal(unknown.statusCode, 502); assert.match(unknown.json().message, /结果待确认.*勿重新提交/)
  assert.equal(f.puts.length, 3)
  await app.close()
  const db = new DatabaseSync(path, { readOnly: true })
  try { for (const table of ['requests', 'gateway_attempts', 'model_submissions']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0) } finally { db.close() }
  assert.doesNotMatch(readFileSync(path).toString('latin1'), /fixture-(?:password|original|proof|rotated)-secret/)
})

test('same-owner account mutation excludes new generation and concurrent profile mutation, another owner remains independent', async t => {
  let release, started
  const gate = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { started = resolve })
  const f = fixture(async call => { if (call.owner === 7) { started(); await gate } return Response.json({ success: true, message: '' }) })
  const app = createServer(config, { fetch: f.fetch }); t.after(() => app.close())
  const first = app.inject({ method: 'PUT', url: '/api/user/self', headers: headers(7), payload: { display_name: '处理中' } })
  await entered
  assert.equal((await app.inject({ method: 'PUT', url: '/api/user/self', headers: headers(7), payload: { display_name: '并发' } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'POST', url: '/api/studio/images', headers: { ...headers(7), 'idempotency-key': 'account-busy-image' }, payload: { prompt: 'test' } })).statusCode, 409)
  assert.equal((await app.inject({ method: 'PUT', url: '/api/user/self', headers: headers(8), payload: { display_name: '另一用户' } })).statusCode, 200)
  release(); assert.equal((await first).statusCode, 200)
  assert.deepEqual(f.puts.map(call => call.owner), [7, 8])
  assert.equal((await app.inject({ method: 'GET', url: '/api/studio/requests/image/account-busy-image', headers: headers(7) })).statusCode, 404)
})
