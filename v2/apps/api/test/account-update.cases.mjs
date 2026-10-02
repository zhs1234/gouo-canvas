import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAccountUpdate, passthroughAccountUpdate, confirmAccountProfile } from '../src/account-update.mjs'
import { StudioError } from '../src/images-error.mjs'

const config = { authOrigin: 'http://native-fixture.invalid', relayKey: 'never-forward' }
const auth = 'Bearer fixture-session'
const rotation = { success: true, message: '', data: { access_token: 'fixture-rotated', token_type: 'Bearer', access_expires_at: 100, session: { sid: 'fixture-sid', current: true, extra: 1 }, has_password: true, notification_warning: false, extra: 'preserved' } }
const status = code => error => error instanceof StudioError && error.status === code
function fixture(body, code = 200) {
  const calls = []
  return { calls, fetcher: async (url, init) => { calls.push({ url, init }); return Response.json(body, { status: code }) } }
}

test('account update uses exact Unicode bounds and separate strict native DTOs', () => {
  for (const n of [1, 20]) assert.equal(validateAccountUpdate({ display_name: '😀'.repeat(n) }).kind, 'profile')
  for (const n of [8, 128]) assert.equal(validateAccountUpdate({ password: '😀'.repeat(n) }).kind, 'password')
  for (const input of [null, [], {}, { display_name: '' }, { display_name: '😀'.repeat(21) }, { password: '短'.repeat(7) }, { password: '长'.repeat(129) }, { password: 123 }, { original_password: 'old' }, { password: 'abcdefgh', original_password: null }, { display_name: '名称', password: 'abcdefgh' }]) assert.throws(() => validateAccountUpdate(input), status(422))
  for (const key of ['id', 'username', 'role', 'status', 'quota', 'group', 'language', 'sidebar_modules', 'setting', 'billing_preference', 'password_encrypted', 'encryption_key_id', 'constructor']) assert.throws(() => validateAccountUpdate({ password: 'abcdefgh', [key]: 'forbidden' }), status(422))
})

test('profile passthrough forwards only original auth and safe headers with one bounded PUT', async () => {
  const body = { success: true, message: '', extra: 'native' }, f = fixture(body)
  assert.deepEqual(await passthroughAccountUpdate(config, auth, { display_name: '名称' }, { authSession: 'fixture-sid' }, f.fetcher), { status: 200, body })
  assert.equal(f.calls.length, 1)
  const { url, init } = f.calls[0]
  assert.equal(url.pathname, '/api/user/self')
  assert.equal(init.method, 'PUT'); assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal)
  assert.deepEqual(init.headers, { Authorization: auth, 'X-Auth-Session': 'fixture-sid', 'Content-Type': 'application/json' })
  assert.equal(init.body, JSON.stringify({ display_name: '名称' }))
  assert.doesNotMatch(JSON.stringify(f.calls), /never-forward|Cookie/)
})

test('password rotation and Native proof errors retain exact envelope/status without retry', async () => {
  const f = fixture(rotation)
  assert.deepEqual(await passthroughAccountUpdate(config, auth, { password: 'new-password', original_password: 'old' }, { securityProof: 'fixture-proof' }, f.fetcher), { status: 200, body: rotation })
  assert.equal(f.calls[0].init.headers['X-Security-Proof'], 'fixture-proof')
  for (const [code, body] of [[403, { success: false, message: 'verify again', code: 'SECURITY_PROOF_CONSUMED' }], [500, { success: false, message: 'try later', code: 'AUTH_INTERNAL_ERROR' }], [401, { success: false, message: 'expired' }]]) {
    const rejected = fixture(body, code)
    assert.deepEqual(await passthroughAccountUpdate(config, auth, { password: 'new-password' }, { securityProof: 'same-proof' }, rejected.fetcher), { status: code, body })
    assert.equal(rejected.calls.length, 1)
  }
})

test('lost, malformed or incomplete password success remains unknown with no resubmission', async () => {
  for (const response of [() => { throw new Error('lost') }, () => new Response('bad json'), () => Response.json({ success: true }), () => Response.json({ success: true, message: '', data: {} }), () => Response.json({ ...rotation, data: { ...rotation.data, token_type: 'unknown' } })]) {
    let calls = 0
    await assert.rejects(passthroughAccountUpdate(config, auth, { password: 'new-password' }, {}, async () => { calls++; return response() }), error => status(502)(error) && /结果待确认.*勿重新提交/.test(error.message))
    assert.equal(calls, 1)
  }
})

test('invalid input/auth/header never reaches Native', async () => {
  const f = fixture(rotation)
  await assert.rejects(passthroughAccountUpdate(config, auth, { role: 100 }, {}, f.fetcher), status(422))
  await assert.rejects(passthroughAccountUpdate(config, '', { password: 'abcdefgh' }, {}, f.fetcher), status(401))
  await assert.rejects(passthroughAccountUpdate(config, auth, { password: 'abcdefgh' }, { securityProof: 'bad\r\nheader' }, f.fetcher), status(422))
  assert.equal(f.calls.length, 0)
})

test('profile confirmation is read-only, checks Native owner and exact updated name', async () => {
  const f = fixture({ success: true, message: '', data: { id: 7, display_name: '名称', quota: 999 } })
  assert.deepEqual(await confirmAccountProfile(config, auth, 7, '名称', f.fetcher), { confirmed: true })
  assert.equal(f.calls[0].init.method, 'GET'); assert.equal(f.calls[0].init.body, undefined)
  await assert.rejects(confirmAccountProfile(config, auth, 8, '名称', f.fetcher), status(403))
  await assert.rejects(confirmAccountProfile(config, auth, 7, '不同', f.fetcher), status(502))
})
