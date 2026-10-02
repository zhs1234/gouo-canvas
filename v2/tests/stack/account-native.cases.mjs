// Actual pinned Native, isolated synthetic accounts, no models/providers/funds.
// Run from v2: node tests/stack/account-native.cases.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { publicEncrypt, constants, createHash } from 'node:crypto'
import { createServer } from '../../apps/api/src/server.mjs'
import { loadConfig } from '../../apps/api/src/config.mjs'

await mkdir(resolve('.local'), { recursive: true })
const directory = await mkdtemp(resolve('.local/native-account-'))
const project = 'gouo-native-account-' + process.pid + '-' + Date.now().toString(36)
const docker = process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker'
const file = join(directory, 'compose.yml'), env = join(directory, 'empty.env')
await mkdir(join(directory, 'data')); await writeFile(env, '')
await writeFile(file, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
      PASSWORD_LOGIN_ENCRYPTION_ENABLED: 'true'
      SESSION_SECRET: synthetic-account-test-session-secret
    ports: ['127.0.0.1::3000']
    volumes:
      - type: bind
        source: ${JSON.stringify(join(directory, 'data').replaceAll('\\', '/'))}
        target: /data
`)
function compose(...args) {
  return new Promise((res, reject) => {
    const child = spawn(docker, ['compose', '--env-file', env, '-p', project, '-f', file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject); child.on('exit', code => code === 0 ? res(output) : reject(new Error('Isolated Docker operation failed: ' + code)))
  })
}
let origin, studio, nativePuts = 0
const oldPassword = 'Synthetic_old_2026!', newPassword = 'Synthetic_new_2026!'
async function native(path, token, body, options = {}) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Origin: origin, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) })
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
}
function successful(result) { assert.equal(result.body.success, true, 'Native operation must succeed'); return result.body.data }
async function encryptedPassword(password) {
  const key = successful(await native('/api/user/login/encryption-key'))
  assert.equal(key.enabled, true)
  return { password_encrypted: publicEncrypt({ key: key.public_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(password)).toString('base64'), encryption_key_id: key.kid }
}
async function login(password) { return native('/api/user/login', undefined, { username: 'fixture-account', ...await encryptedPassword(password) }) }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const preservedProfileFields = ['id', 'username', 'has_password', 'role', 'status', 'group', 'quota', 'used_quota', 'request_count', 'setting', 'sidebar_modules', 'permissions']
function profileSnapshot(account) {
  return Object.fromEntries(preservedProfileFields.map(key => { assert.ok(Object.hasOwn(account, key), `Native self DTO must expose ${key}`); return [key, account[key]] }))
}
async function tokenSnapshot(token) {
  const data = successful(await native('/api/token/?page=1&page_size=100', token))
  assert.ok(Array.isArray(data.items)); assert.equal(data.total, data.items.length)
  const fields = ['id', 'user_id', 'status', 'name', 'created_time', 'accessed_time', 'expired_time', 'remain_quota', 'unlimited_quota', 'model_limits_enabled', 'model_limits', 'allow_ips', 'used_quota', 'group', 'cross_group_retry', 'auto_groups']
  return data.items.map(row => Object.fromEntries(fields.map(key => { assert.ok(Object.hasOwn(row, key), `Native token DTO must expose ${key}`); return [key, row[key]] }))).sort((a, b) => a.id - b.id)
}
try {
  await compose('up', '-d')
  const published = (await compose('port', 'new-api', '3000')).trim()
  assert.match(published, /^127\.0\.0\.1:\d+$/); assert.notEqual(published, '127.0.0.1:8080'); origin = 'http://' + published
  for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/status')).ok) break } catch {} await new Promise(res => setTimeout(res, 500)) }
  const checksum = (await compose('exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api')).split(' ')[0]
  assert.equal(checksum, 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529')
  successful(await native('/api/setup', undefined, { username: 'fixture-root', password: oldPassword, confirmPassword: oldPassword, SelfUseModeEnabled: false, DemoSiteEnabled: false }))
  successful(await native('/api/user/register', undefined, { username: 'fixture-account', password: oldPassword }))
  const first = await login(oldPassword), current = successful(first), other = successful(await login(oldPassword))
  const owner = current.user.id, pref = successful(await native('/api/subscription/self', current.access_token)).billing_preference
  const config = loadConfig({ GOUO_BACKEND_DEV_TARGET: origin, GOUO_GATEWAY_BASE_URL: origin + '/v1', GOUO_STUDIO_LEDGER_PATH: join(directory, 'studio.sqlite') })
  assert.equal(config.allowGeneration, false); assert.equal(config.trial, undefined)
  studio = createServer(config, { fetch: async (url, init) => { if (init?.method === 'PUT') nativePuts++; return fetch(url, init) } })
  const update = (token, payload, proof) => studio.inject({ method: 'PUT', url: '/api/user/self', headers: { authorization: 'Bearer ' + token, ...(proof ? { 'x-security-proof': proof } : {}) }, payload })
  assert.equal((await update(current.access_token, { display_name: '隔离账户验收' })).statusCode, 200)
  assert.equal(successful(await native('/api/user/self', current.access_token)).display_name, '隔离账户验收')
  assert.equal(successful(await native('/api/subscription/self', current.access_token)).billing_preference, pref)
  const profileBefore = profileSnapshot(successful(await native('/api/user/self', current.access_token)))
  const tokensBefore = await tokenSnapshot(current.access_token)
  const studioProfile = (payload) => studio.inject({ method: 'PUT', url: '/api/studio/profile', headers: { authorization: 'Bearer ' + current.access_token }, payload })
  const privateUpdated = await studioProfile({ display_name: '  私有显示名验收  ' })
  assert.equal(privateUpdated.statusCode, 200)
  assert.deepEqual(privateUpdated.json(), { success: true, data: { id: owner, display_name: '私有显示名验收', confirmed: true } })
  assert.equal(privateUpdated.headers['cache-control'], 'no-store')
  const profileAfter = successful(await native('/api/user/self', current.access_token))
  assert.equal(profileAfter.display_name, '私有显示名验收')
  assert.equal(digest(profileSnapshot(profileAfter)), digest(profileBefore), 'Native profile, settings and financial fields must remain unchanged')
  const tokensAfter = await tokenSnapshot(current.access_token)
  assert.equal(digest(tokensAfter), digest(tokensBefore), 'Native token metadata must remain unchanged')
  assert.equal(successful(await native('/api/subscription/self', current.access_token)).billing_preference, pref)
  const privatePutsBeforeRejected = nativePuts
  for (const payload of [{ display_name: ' ', }, { display_name: '名称', id: owner + 1 }, { display_name: '名称', setting: '{}' }, { password: newPassword }, { display_name: '名称', billing_preference: 'wallet_only' }]) assert.equal((await studioProfile(payload)).statusCode, 422)
  assert.equal(nativePuts, privatePutsBeforeRejected)
  const putsBeforeRejected = nativePuts
  for (const payload of [{ language: 'zh' }, { display_name: 'x', role: 100 }, { password_encrypted: 'x' }]) assert.equal((await update(current.access_token, payload)).statusCode, 422)
  assert.equal(nativePuts, putsBeforeRejected)
  const missing = await update(current.access_token, { password: newPassword, original_password: oldPassword })
  assert.equal(missing.statusCode, 403); assert.equal(missing.json().code, 'SECURITY_PROOF_REQUIRED')
  const proof = successful(await native('/api/verify', current.access_token, { method: 'password', scope: 'account.password.change', ...await encryptedPassword(oldPassword) }))
  const changed = await update(current.access_token, { password: newPassword, original_password: oldPassword }, proof.proof_token)
  assert.equal(changed.statusCode, 200); const rotated = changed.json().data
  assert.ok(rotated.access_token); assert.equal(rotated.session.sid, current.session.sid)
  assert.equal(successful(await native('/api/user/self', rotated.access_token)).id, owner)
  const reused = await update(rotated.access_token, { password: oldPassword, original_password: newPassword }, proof.proof_token)
  assert.equal(reused.statusCode, 403); assert.ok(/^SECURITY_PROOF_/.test(reused.json().code))
  assert.equal((await native('/api/user/self', other.access_token)).status, 401)
  assert.equal((await native('/api/user/self', current.access_token)).status, 401)
  const refreshed = successful(await native('/api/user/auth/refresh', undefined, {}, { headers: { Cookie: first.cookies, 'X-Auth-Session': current.session.sid } }))
  assert.equal(successful(await native('/api/user/self', refreshed.access_token)).id, owner)
  assert.equal((await login(oldPassword)).body.success, false)
  assert.equal(successful(await login(newPassword)).user.id, owner)
  assert.equal(successful(await native('/api/subscription/self', refreshed.access_token)).billing_preference, pref)
  assert.equal(nativePuts, 5)
  const evidence = { sourceCommit: '0aec08fee811ec6136828fda790551b49e410301', binarySha256: checksum, owner, generationEnabled: false, trialEnabled: false, modelCalls: 0, realPaidCost: 0, profileConfirmed: true, billingPreferenceUnchanged: true, unknownFieldsRejected: true, missingProofStatus: missing.statusCode, missingProofCode: missing.json().code, actualEncryptedVerification: true, passwordRotated: true, sameProofRejectedStatus: reused.statusCode, sameProofRejectedCode: reused.json().code, currentRefreshPreserved: true, oldAccessAndOtherSessionRevoked: true, oldPasswordRejected: true, newPasswordAccepted: true, nativePuts }
  Object.assign(evidence, { studioProfileConfirmed: true, studioProfileUnknownFieldsRejectedWithoutWrites: true, preservedProfileFields, nativeSettingsAndFinancialFieldsUnchanged: true, nativeTokenMetadataUnchanged: true, nativeTokenCount: tokensBefore.length, nativeTokenCoverage: tokensBefore.length ? 'existing token metadata' : 'empty token list remains empty; populated token case not exercised', completeTokenKeyFetched: false, tokenKeysPersistedOrOutput: false })
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + join(directory, 'evidence.json'))
} finally { if (studio) await studio.close(); await compose('down', '--volumes', '--remove-orphans') }
