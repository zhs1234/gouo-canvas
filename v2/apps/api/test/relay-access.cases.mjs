import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readStudioToken, proveRetired, createReplacement } from '../src/relay-access.mjs'

const now = 1800000000
const config = { authOrigin: 'http://native.invalid', userTokenQuotaCap: 100, userTokenLifetimeSeconds: 600,
  models: [{ enabled: true, verification: 'live-verified', kind: 'chat', upstreamModelId: 'chat' }] }
const account = { id: 7, status: 1 }
const row = () => ({ id: 9, user_id: 7, name: 'gouo-studio', key: 'masked', status: 1,
  remain_quota: 50, unlimited_quota: false, expired_time: now + 300, model_limits_enabled: true,
  model_limits: 'chat', group: '', cross_group_retry: false, allow_ips: '', auto_groups: null })
const ok = data => new Response(JSON.stringify({ success: true, data }), { headers: { date: new Date(now * 1000).toUTCString() } })
function reader(token, calls = []) {
  return async (url, options) => {
    calls.push({ path: url.pathname, options })
    return ok(url.pathname.endsWith('/search') ? { items: token ? [token] : [], total: token ? 1 : 0 } : token)
  }
}
test('masked exact owner token DTO describes ready/missing/expired/exhausted/disabled without a key', async () => {
  for (const [patch, state] of [[{}, 'ready'], [{ status: 3, expired_time: now - 1 }, 'expired'],
    [{ status: 4, remain_quota: 0 }, 'exhausted'], [{ status: 1, remain_quota: 0 }, 'exhausted'], [{ status: 2 }, 'disabled']]) {
    const result = await readStudioToken(config, 'Bearer account', account, reader({ ...row(), ...patch }))
    assert.equal(result.state, state); assert.equal('key' in result.token, false)
  }
  assert.deepEqual(await readStudioToken(config, 'Bearer account', account, reader(null)), { state: 'missing' })
})
test('strict permission/finite quota/owner fields and incomplete, duplicate, changed bindings fail closed', async () => {
  for (const patch of [{ user_id: 8 }, { unlimited_quota: true }, { remain_quota: 101 }, { expired_time: -1 },
    { model_limits: 'chat,other' }, { model_limits: 'chat,chat' }, { model_limits_enabled: false }, { group: 'auto' },
    { cross_group_retry: true }, { allow_ips: '127.0.0.1' }, { auto_groups: ['default'] }, { status: 99 }]) {
    assert.equal((await readStudioToken(config, 'Bearer account', account, reader({ ...row(), ...patch }))).state, 'incompatible')
  }
  for (const data of [{ items: [row(), row()], total: 2 }, { items: [row()], total: 2 }, { items: [row()], total: 101 }]) {
    await assert.rejects(readStudioToken(config, 'Bearer account', account, async () => ok(data)))
  }
  await assert.rejects(readStudioToken(config, 'Bearer account', account, reader(row()), { id: 10, name: 'gouo-studio' }))
  assert.equal((await readStudioToken(config, 'Bearer account', account, async url =>
    new Response(JSON.stringify({ success: true, data: url.pathname.endsWith('/search') ? { items: [row()], total: 1 } : row() })))).state, 'incompatible')
})
test('retirement uses Native date; disabled and future status3 cannot be revived or blindly rotated', async () => {
  for (const token of [{ ...row(), status: 2 }, { ...row(), status: 3 }, { ...row(), status: 4 },
    { ...row(), expired_time: now }, row()]) {
    const calls = []; await assert.rejects(proveRetired(config, 'Bearer account', account, reader(token, calls), { token }))
    assert.equal(calls.some(c => c.options.method === 'POST'), false)
  }
  for (const token of [{ ...row(), expired_time: now - 1 }, { ...row(), status: 4, remain_quota: 0 }]) {
    const result = await proveRetired(config, 'Bearer account', account, reader(token), { token })
    assert.equal(result.token.id, 9)
  }
})

test('strict Native expiry second and inconsistent stored states fail closed; DTO discards unknown secrets', async () => {
  const equal = await readStudioToken(config, 'Bearer account', account, reader({ ...row(), expired_time: now }))
  assert.equal(equal.state, 'ready', 'Native only rejects expiry strictly less than its current second')
  for (const token of [{ ...row(), status: 3, expired_time: now }, { ...row(), status: 3 }, { ...row(), status: 4 }]) {
    assert.equal((await readStudioToken(config, 'Bearer account', account, reader(token))).state, 'incompatible')
  }
  const result = await readStudioToken(config, 'Bearer account', account, reader({ ...row(), secret: 'fixture-secret',
    provider_key: 'fixture-provider-secret', nested: { key: 'fixture-nested-secret' } }))
  assert.equal(JSON.stringify(result).includes('secret'), false)
  assert.equal('key' in result.token, false)
})
test('enabled zero token requires actual Native authentication rejection and exact exhausted readback; no provider path', async () => {
  let token = { ...row(), remain_quota: 0 }; const calls = []
  const fetcher = async (url, options) => {
    calls.push({ path: url.pathname, options })
    if (url.pathname.endsWith('/key')) return ok({ key: 'x'.repeat(48) })
    if (url.pathname === '/v1/models') { token = { ...token, status: 4 }; return new Response('{}', { status: 401 }) }
    return reader(token)(url, options)
  }
  assert.equal((await proveRetired(config, 'Bearer account', account, fetcher, { token })).token.status, 4)
  assert.deepEqual(calls.map(c => c.path), ['/api/token/search', '/api/token/9', '/api/token/9/key', '/v1/models', '/api/token/search', '/api/token/9'])
  assert.equal(calls.find(c => c.path === '/v1/models').options.headers.Authorization, 'Bearer ' + 'x'.repeat(48))
  assert.equal(calls.some(c => c.options.method === 'PUT'), false)
})
test('unknown retirement proof or unconfirmed exhaustion does not authorize replacement', async () => {
  const token = { ...row(), remain_quota: 0 }
  for (const mode of ['timeout', 'success', 'unchanged', 'readlost']) {
    let proof = false
    const fetcher = async (url, options) => {
      if (url.pathname.endsWith('/key')) return ok({ key: 'x'.repeat(48) })
      if (url.pathname === '/v1/models') {
        proof = true; if (mode === 'timeout') throw new Error('fixture timeout')
        return new Response('{}', { status: mode === 'success' ? 200 : 401 })
      }
      if (proof && mode === 'readlost') throw new Error('fixture read lost')
      return reader(token)(url, options)
    }
    await assert.rejects(proveRetired(config, 'Bearer account', account, fetcher, { token }), error => error.unknown === true)
  }
})
test('replacement sends one finite POST and exact confirms approved metadata without touching old token', async () => {
  const target = { name: 'gouo-studio-op123', quota: 70, expiredTime: now + 400 }, calls = []
  const token = { ...row(), id: 10, name: target.name, remain_quota: target.quota, expired_time: target.expiredTime }
  const fetcher = async (url, options) => {
    calls.push({ path: url.pathname, options })
    if (options.method === 'POST') return ok(undefined)
    return reader(token)(url, options)
  }
  assert.deepEqual(await createReplacement(config, 'Bearer account', account, fetcher, target), { id: 10, name: target.name })
  assert.deepEqual(calls.map(c => c.path), ['/api/token/', '/api/token/search', '/api/token/10'])
  const sent = JSON.parse(calls[0].options.body)
  assert.equal(sent.unlimited_quota, false); assert.equal(sent.remain_quota, 70); assert.equal(sent.expired_time, now + 400)
  assert.equal(sent.model_limits, 'chat'); assert.equal(sent.group, ''); assert.equal(sent.allow_ips, '')
  assert.equal('id' in sent, false); assert.equal('status' in sent, false)
})
test('lost POST outcome performs no search/retry; explicit negative or readback mismatch remains unknown', async () => {
  const target = { name: 'gouo-studio-op123', quota: 70, expiredTime: now + 400 }
  for (const mode of ['lost', 'badjson', 'negative', 'mismatch']) {
    const calls = []
    const fetcher = async (url, options) => {
      calls.push(url.pathname)
      if (options.method === 'POST') {
        if (mode === 'lost') throw new Error('fixture: created but response lost')
        if (mode === 'badjson') return new Response('{')
        if (mode === 'negative') return new Response(JSON.stringify({ success: false }))
        return ok(undefined)
      }
      return reader({ ...row(), name: target.name })(url, options)
    }
    await assert.rejects(createReplacement(config, 'Bearer account', account, fetcher, target), error => error.unknown === true)
    if (mode !== 'mismatch') assert.deepEqual(calls, ['/api/token/'])
  }
})
