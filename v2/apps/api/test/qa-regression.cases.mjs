import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../src/server.mjs'
import { loadConfig } from '../src/config.mjs'

const config = {
  models: ['image', 'chat'].map(kind => ({ id: kind, displayName: kind, kind, upstreamModelId: 'fixture-' + kind, enabled: true, verification: 'live-verified' })),
  relayKey: 'fixture-only-secret', relayOwnerId: 7, allowGeneration: true,
  gateway: 'http://fixture.invalid/v1', authOrigin: 'http://fixture.invalid', ledgerPath: ':memory:',
}
const authFetch = async (url, init) => {
  assert.equal(new URL(url).pathname, '/api/user/self')
  return new Response(JSON.stringify({ success: true, data: { id: Number(init.headers.Authorization.split('-').at(-1)) } }))
}
function send(app, endpoint, id, owner = 7, prompt = 'fixture') {
  return app.inject({ method: 'POST', url: '/api/studio/' + endpoint,
    headers: { authorization: 'Bearer fixture-user-' + owner, 'idempotency-key': id, 'new-api-user': '7' },
    payload: endpoint === 'images' ? { prompt, model: 'image' }
      : { prompt, model: 'chat', runId: id, sessionId: 'fixture-session', conversationId: 'fixture-canvas' },
  })
}

test('personal relay generation requires an explicit owner at startup, while previews remain safe', () => {
  const env = { GOUO_ENABLE_GENERATION: 'true', GOUO_RELAY_API_KEY: 'fixture-only-secret' }
  assert.throws(() => loadConfig(env), /GOUO_RELAY_OWNER_ID/)
  assert.throws(() => loadConfig({ ...env, GOUO_RELAY_OWNER_ID: '' }), /GOUO_RELAY_OWNER_ID/)
  for (const value of ['0', '-1', '1.5', 'NaN', '9007199254740992']) {
    assert.throws(() => loadConfig({ ...env, GOUO_RELAY_OWNER_ID: value }), /所属账号/)
  }
  assert.equal(loadConfig({ ...env, GOUO_RELAY_OWNER_ID: '7' }).relayOwnerId, 7)
  assert.equal(loadConfig({}).allowGeneration, false)
  assert.equal(loadConfig({ ...env, GOUO_ENABLE_GENERATION: 'false' }).allowGeneration, false)
})

test('missing or invalid relay owner disables the catalog and both generation routes without executing', async () => {
  for (const relayOwnerId of [undefined, 0, NaN]) {
    let calls = 0
    const app = createServer({ ...config, relayOwnerId }, { fetch: authFetch,
      generateImage: async () => { calls++; return {} }, runAgent: async () => { calls++; return {} },
    })
    try {
      assert.equal((await app.inject('/api/studio/health')).statusCode, 200)
      const catalog = (await app.inject('/api/studio/models')).json().data
      assert.equal(catalog.generationEnabled, false)
      assert.equal(catalog.conversationMode, 'unavailable')
      assert.ok(catalog.models.every(model => !model.accessible))
      for (const owner of [7, 8]) for (const endpoint of ['images', 'runs']) {
        const result = await send(app, endpoint, crypto.randomUUID(), owner)
        assert.equal(result.statusCode, 503)
        assert.match(result.json().message, /GOUO_RELAY_OWNER_ID/)
      }
      assert.equal(calls, 0)
    } finally { await app.close() }
  }
})

test('configured personal relay owner guards images and Agent even when another account spoofs its ID', async () => {
  let calls = 0
  const app = createServer(config, { fetch: authFetch,
    generateImage: async () => { calls++; return {} }, runAgent: async () => { calls++; return { events: [] } },
  })
  try {
    for (const endpoint of ['images', 'runs']) {
      assert.equal((await send(app, endpoint, crypto.randomUUID(), 8)).statusCode, 403)
      assert.equal((await send(app, endpoint, crypto.randomUUID(), 7)).statusCode, 200)
    }
    assert.equal(calls, 2)
  } finally { await app.close() }
})

for (const endpoint of ['images', 'runs']) test(`${endpoint}: busy rejection does not reserve a fresh ID, while started requests and completed replays stay protected`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-busy-regression-'))
  const c = { ...config, ledgerPath: join(directory, 'requests.sqlite') }
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { started = resolve })
  let calls = 0
  const action = async () => {
    calls++
    if (calls === 2) { started(); await gate }
    return endpoint === 'images' ? { url: 'fixture-result-' + calls } : { events: [], fixtureCall: calls }
  }
  const overrides = { fetch: authFetch, generateImage: action, runAgent: action }
  let app = createServer(c, overrides)
  let pending
  try {
    const completedId = crypto.randomUUID(), activeId = crypto.randomUUID(), rejectedId = crypto.randomUUID()
    const completed = await send(app, endpoint, completedId)
    assert.equal(completed.statusCode, 200)
    pending = send(app, endpoint, activeId)
    await ready
    assert.equal((await send(app, endpoint, activeId)).statusCode, 409)
    assert.equal((await send(app, endpoint, activeId, 7, 'changed')).statusCode, 409)
    const rejected = await send(app, endpoint, rejectedId)
    assert.equal(rejected.statusCode, 409)
    assert.deepEqual((await send(app, endpoint, completedId)).json(), completed.json())
    assert.equal(calls, 2)
    release()
    assert.equal((await pending).statusCode, 200)
    await app.close()
    app = createServer(c, overrides)
    const retry = await send(app, endpoint, rejectedId)
    assert.equal(retry.statusCode, 200)
    assert.match(rejected.json().message, /尚未执行/)
    assert.equal(calls, 3)
    assert.deepEqual((await send(app, endpoint, rejectedId)).json(), retry.json())
    assert.equal((await send(app, endpoint, rejectedId, 7, 'changed')).statusCode, 409)
    assert.equal(calls, 3)
  } finally {
    release()
    await pending
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
