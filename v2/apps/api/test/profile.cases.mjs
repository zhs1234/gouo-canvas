import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/server.mjs'
import { profileBody, updateStudioProfile } from '../src/profile.mjs'

const config = { models: [], authOrigin: 'http://native.invalid', gateway: 'http://native.invalid/v1', ledgerPath: ':memory:', allowGeneration: false }
const headers = { authorization: 'Bearer owner7' }
const ok = data => Response.json({ success: true, message: '', ...(data ? { data } : {}) })
function fixture() {
  const state = { name: '旧名称', calls: [], failure: null, hold: null }
  state.fetch = async (url, init) => {
    assert.equal(new URL(url).origin, config.authOrigin)
    assert.equal(new URL(url).pathname, '/api/user/self')
    assert.equal(init.headers.Authorization, headers.authorization)
    state.calls.push(init)
    if (init.method === 'PUT') {
      assert.deepEqual(Object.keys(JSON.parse(init.body)), ['display_name'])
      assert.deepEqual(Object.keys(init.headers).sort(), ['Authorization', 'Content-Type'])
      state.name = JSON.parse(init.body).display_name
      if (state.hold) await state.hold
      if (state.failure === 'lost') throw new Error('secret must not leak')
      if (state.failure === 'malformed') return new Response('secret malformed')
      if (state.failure === 'cache') return Response.json({ success: false, message: 'secret cache failure' }, { status: 500 })
      return ok()
    }
    const afterPut = state.calls.some(call => call.method === 'PUT')
    return ok({ id: afterPut && state.failure === 'owner' ? 8 : 7, status: 1, display_name: afterPut && state.failure === 'mismatch' ? '旧名称' : state.name, setting: 'secret-setting', quota: 999, access_token: 'secret-key' })
  }
  return state
}

test('profile accepts only a trimmed 1–20 Unicode display name', () => {
  assert.deepEqual(profileBody({ display_name: '  😀名称  ' }), { display_name: '😀名称' })
  assert.equal([...profileBody({ display_name: '😀'.repeat(20) }).display_name].length, 20)
  for (const input of [null, [], {}, { display_name: 1 }, { display_name: '   ' }, { display_name: '😀'.repeat(21) }]) assert.throws(() => profileBody(input), error => error.status === 422)
  for (const key of ['id', 'owner', 'username', 'role', 'status', 'quota', 'group', 'setting', 'billing_preference', 'language', 'sidebar_modules', 'password', 'original_password', 'constructor']) assert.throws(() => profileBody({ display_name: '名称', [key]: 'forbidden' }), error => error.status === 422)
})

test('private profile route authenticates then performs one strict PUT and read confirmation without secrets', async () => {
  const f = fixture(), app = createServer(config, { fetch: f.fetch })
  try {
    const result = await app.inject({ method: 'PUT', url: '/api/studio/profile', headers, payload: { display_name: '  新名称  ' } })
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.json(), { success: true, data: { id: 7, display_name: '新名称', confirmed: true } })
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(f.calls.length, 3)
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
    assert.equal(f.calls[1].redirect, 'error'); assert.ok(f.calls[1].signal instanceof AbortSignal)
    assert.doesNotMatch(result.body, /secret|quota|setting|access_token/)
  } finally { await app.close() }
})

test('unauthenticated or forbidden profile requests never write Native', async () => {
  const f = fixture(), app = createServer(config, { fetch: f.fetch })
  try {
    assert.equal((await app.inject({ method: 'PUT', url: '/api/studio/profile', payload: { display_name: '名称' } })).statusCode, 401)
    for (const payload of [{ display_name: '名称', id: 8 }, { password: 'new-password' }, { display_name: '名称', setting: '{}' }]) assert.equal((await app.inject({ method: 'PUT', url: '/api/studio/profile', headers, payload })).statusCode, 422)
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0)
  } finally { await app.close() }
})

test('post-commit loss, invalid envelope, Native cache error and confirmation mismatch remain unknown without retry', async () => {
  for (const failure of ['lost', 'malformed', 'cache', 'owner', 'mismatch']) {
    const f = fixture(); f.failure = failure
    await assert.rejects(updateStudioProfile(config, headers.authorization, 7, { display_name: '新名称' }, f.fetch), error => error.status === 502 && /结果待确认.*勿再次提交/.test(error.message) && !/secret/.test(error.message))
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
    assert.equal(f.name, '新名称')
  }
})

test('fresh authentication failure remains a pre-write failure with no Native mutation', async () => {
  const calls = []
  const app = createServer(config, { fetch: async (_url, init) => {
    calls.push(init)
    return Response.json({ success: false, message: 'private backend detail' }, { status: 503 })
  } })
  try {
    const result = await app.inject({ method: 'PUT', url: '/api/studio/profile', headers, payload: { display_name: '名称' } })
    assert.equal(result.statusCode, 502)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, undefined)
    assert.match(result.json().message, /账号服务暂不可用/)
    assert.doesNotMatch(result.body, /结果待确认|private backend detail/)
  } finally { await app.close() }
})

test('owner busy rejects a concurrent profile submission before a second Native PUT', async () => {
  const f = fixture(), app = createServer(config, { fetch: f.fetch })
  let release; f.hold = new Promise(resolve => { release = resolve })
  try {
    const first = app.inject({ method: 'PUT', url: '/api/studio/profile', headers, payload: { display_name: '第一名称' } })
    await new Promise(resolve => { const check = () => f.calls.some(call => call.method === 'PUT') ? resolve() : setImmediate(check); check() })
    const second = await app.inject({ method: 'PUT', url: '/api/studio/profile', headers, payload: { display_name: '第二名称' } })
    assert.equal(second.statusCode, 409)
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
    release(); assert.equal((await first).statusCode, 200)
  } finally { release(); await app.close() }
})
