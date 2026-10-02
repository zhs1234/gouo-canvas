import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, catalog } from '../src/config.mjs'

test('mounted unified relay secret is server-only, owner-bound and never silently falls back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gouo-config-'))
  const path = join(dir, 'relay')
  try {
    writeFileSync(path, 'fixture-mounted-relay\n', { mode: 0o600 })
    const env = { GOUO_RELAY_API_KEY_FILE: path, GOUO_RELAY_OWNER_ID: '7', GOUO_ENABLE_GENERATION: 'true' }
    const c = loadConfig(env)
    assert.equal(c.relayKey, 'fixture-mounted-relay')
    assert.doesNotMatch(JSON.stringify(catalog(c)), /fixture-mounted-relay/)
    assert.throws(() => loadConfig({ ...env, GOUO_RELAY_OWNER_ID: '' }), /GOUO_RELAY_OWNER_ID/)
    assert.throws(() => loadConfig({ ...env, GOUO_RELAY_API_KEY: 'fixture-second-key' }), /其中一种/)
    assert.throws(() => loadConfig({ ...env, GOUO_RELAY_API_KEY_FILE: join(dir, 'missing') }), /挂载和权限/)
    writeFileSync(path, 'first\nsecond')
    assert.throws(() => loadConfig(env), /内容无效/)
    writeFileSync(path, '')
    assert.throws(() => loadConfig(env), /内容无效/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
