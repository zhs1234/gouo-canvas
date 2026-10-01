import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Ledger } from '../src/ledger.mjs'

const moduleURL = new URL('../src/ledger.mjs', import.meta.url).href
const source = `import { Ledger } from ${JSON.stringify(moduleURL)};
  const ledger = new Ledger(process.env.LEDGER_LOCK_TEST_PATH);
  if (process.send) {
    ledger.begin(7, 'agent', 'lock-test-key', {});
    process.send('ready');
    process.on('message', () => { ledger.close(); process.exit(0) });
  } else { ledger.close() }`
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-ledger-lock-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, 'ledger.sqlite')
}
function contender(path) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, LEDGER_LOCK_TEST_PATH: path }, encoding: 'utf8', timeout: 10_000,
  })
}

test('second process cannot open a live ledger or mark its running request unknown; close releases ownership', t => {
  const path = temporary(t), ledger = new Ledger(path)
  try {
    ledger.begin(7, 'agent', 'lock-test-key', {})
    const second = contender(path)
    assert.equal(second.status, 1, second.stderr)
    assert.match(second.stderr, /already owned by another API process/)
    assert.equal(ledger.detail(7, 'agent', 'lock-test-key').status, 'running')
  } finally { ledger.close() }
  const restarted = new Ledger(path)
  try { assert.equal(restarted.detail(7, 'agent', 'lock-test-key').status, 'unknown') }
  finally { restarted.close() }
})

test('terminated owner releases its SQLite process lock and restart recovers running as unknown', { timeout: 15_000 }, async t => {
  const path = temporary(t)
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, LEDGER_LOCK_TEST_PATH: path }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill() })
  const ready = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(([code]) => { throw new Error(`owner exited before ready: ${code}`) }),
  ])
  assert.equal(ready[0], 'ready')
  const rejected = contender(path)
  assert.equal(rejected.status, 1, rejected.stderr)
  const reader = new DatabaseSync(path)
  try { assert.equal(reader.prepare('SELECT status FROM requests').get().status, 'running') }
  finally { reader.close() }
  const exited = once(child, 'exit')
  child.kill()
  await exited
  const restarted = new Ledger(path)
  try { assert.equal(restarted.detail(7, 'agent', 'lock-test-key').status, 'unknown') }
  finally { restarted.close() }
})

test('constructor failure releases the acquired lock; memory ledgers remain independent', t => {
  const path = temporary(t)
  writeFileSync(path, 'invalid SQLite database')
  assert.throws(() => new Ledger(path))
  unlinkSync(path)
  const repaired = new Ledger(path)
  repaired.close()
  const first = new Ledger(':memory:'), second = new Ledger(':memory:')
  try {
    first.begin(7, 'agent', 'lock-test-key', {})
    assert.equal(first.detail(7, 'agent', 'lock-test-key').status, 'running')
    assert.equal(second.detail(7, 'agent', 'lock-test-key'), null)
  } finally { first.close(); second.close() }
})
