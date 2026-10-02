import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Ledger } from '../apps/api/src/ledger.mjs'
import { RecoverySession } from '../scripts/lib/recovery-helper.mjs'
import { parseArguments, validateTopology, operate, observeRestart, pinnedBinaryHashes } from '../scripts/reconcile-funding.mjs'

const instanceId = '11111111-2222-4333-8444-555555555555'
const studioId = 'a'.repeat(64), nativeId = 'b'.repeat(64), imageId = 'sha256:' + 'c'.repeat(64)
const expectedHash = 'd'.repeat(64), binaryHash = [...pinnedBinaryHashes][0]
function options(mode = 'reconcile') {
  return { mode, project: 'recovery-fixture', 'studio-container': studioId, 'native-container': nativeId,
    instance: instanceId, owner: 7, 'expected-row-hash': expectedHash, 'restart-native': true }
}
function topology() {
  const network = { NetworkID: 'fixture-network', Aliases: ['new-api'] }
  const native = { Id: nativeId, Image: imageId, State: { Running: true, Pid: 10, StartedAt: 'old-boot', Health: { Status: 'healthy' } },
    Config: { Labels: { 'com.docker.compose.project': 'recovery-fixture', 'com.docker.compose.service': 'new-api' },
      Entrypoint: ['/usr/local/bin/new-api'], Cmd: null, Env: ['SQLITE_PATH=/data/new-api.db'] },
    HostConfig: { PortBindings: {} }, NetworkSettings: { Ports: {}, Networks: { 'recovery-fixture_default': network } },
    Mounts: [{ Type: 'volume', Name: 'fixture-native-data', Destination: '/data', RW: true }] }
  const studio = { Id: studioId, Image: imageId, State: { Running: false, Pid: 0 },
    Config: { Labels: { 'com.docker.compose.project': 'recovery-fixture', 'com.docker.compose.service': 'studio-api' },
      Env: ['GOUO_BACKEND_DEV_TARGET=http://new-api:3000', 'GOUO_GATEWAY_BASE_URL=http://new-api:3000/v1', 'GOUO_STUDIO_LEDGER_PATH=/data/requests.sqlite'] },
    NetworkSettings: { Networks: { 'recovery-fixture_default': { ...network, Aliases: ['studio-api'] } } },
    Mounts: [{ Type: 'volume', Name: 'fixture-studio-data', Destination: '/data', RW: true }] }
  return { studio, native, peers: [studio, native] }
}
function database(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gouo-recovery-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'requests.sqlite'), db = new DatabaseSync(path)
  db.exec(`CREATE TABLE trial_installation(id INTEGER PRIMARY KEY,instance_id TEXT);
    CREATE TABLE funding_writes(owner INTEGER PRIMARY KEY,preference TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE requests(owner INTEGER,status TEXT)`)
  db.prepare('INSERT INTO trial_installation VALUES(1,?)').run(instanceId)
  db.exec("INSERT INTO funding_writes VALUES(7,'wallet_only','unknown','fixture-old-write'); INSERT INTO requests VALUES(7,'running')")
  db.close()
  return path
}
function receipt(snapshot) {
  return { version: 1, session: snapshot.session, instanceId, containerId: nativeId, imageId, binarySha256: binaryHash,
    oldStartedAt: 'old-boot', stopped: { running: false, pid: 0 }, started: { running: true, healthy: true, startedAt: 'new-boot' } }
}

test('CLI accepts only exact private identities and explicit restart consent; no external JSON receipt or unlock flag', () => {
  const argv = ['reconcile', '--project', 'recovery-fixture', '--studio-container', studioId, '--native-container', nativeId,
    '--instance', instanceId, '--owner', '7', '--expected-row-hash', expectedHash, '--restart-native']
  assert.equal(parseArguments(argv).owner, 7)
  for (const invalid of [argv.slice(0, -1), [...argv, '--receipt', 'pretend.json'], [...argv, '--clear'], [...argv, '--project', 'other'],
    argv.map(value => value === studioId ? 'short-id' : value), argv.map(value => value === '7' ? '0' : value),
    ['inspect', ...argv.slice(1)]]) assert.throws(() => parseArguments(invalid))
})

test('only stopped Studio and one private pinned native SQLite topology can establish proof', () => {
  const good = topology()
  assert.equal(validateTopology(options(), good.studio, good.native, good.peers).studioVolume, 'fixture-studio-data')
  const changes = [
    t => { t.studio.State.Running = true; t.studio.State.Pid = 12 },
    t => { t.native.Config.Env.push('SQL_DSN=fixture-remote-database') },
    t => { t.native.Config.Env.push('REDIS_CONN_STRING=fixture-redis') },
    t => { t.native.HostConfig.PortBindings = { '3000/tcp': [{ HostPort: '3000' }] } },
    t => { t.native.Mounts[0].Type = 'tmpfs' },
    t => { t.studio.Config.Env[0] = 'GOUO_BACKEND_DEV_TARGET=https://remote.invalid' },
    t => { t.native.NetworkSettings.Networks.extra = { NetworkID: 'other' } },
    t => { t.peers.push({ ...structuredClone(t.native), Id: 'e'.repeat(64) }) },
    t => { t.peers.push({ Id: 'e'.repeat(64), NetworkSettings: structuredClone(t.native.NetworkSettings) }) },
    t => { t.native.Config.Entrypoint = ['fixture-wrapper'] },
    t => { t.native.Mounts[0].Name = 'fixture-studio-data' },
    t => { t.peers.push({ Id: 'e'.repeat(64), State: { Running: true }, Mounts: structuredClone(t.native.Mounts) }) },
  ]
  for (const change of changes) {
    const altered = topology(); change(altered)
    assert.throws(() => validateTopology(options(), altered.studio, altered.native, altered.peers))
  }
})

test('helper inspection is read-only and live Ledger lock forbids another recovery session', t => {
  const path = database(t), session = new RecoverySession(path, 7, instanceId)
  try {
    assert.equal(session.inspect().row.status, 'unknown')
    const reader = new DatabaseSync(path, { readOnly: true })
    try { assert.equal(reader.prepare('SELECT status FROM requests').get().status, 'running') }
    finally { reader.close() }
    assert.throws(() => new RecoverySession(path, 7, instanceId), /locked/)
  } finally { session.close() }
  // Real Ledger's guard holds the same process-lock; recovery cannot enter it.
  const ledger = new Ledger(path)
  try { assert.throws(() => new RecoverySession(path, 7, instanceId), /locked/) }
  finally { ledger.close() }
})

test('helper rejects oversized unterminated stdin before EOF and releases its lock without changing the barrier', async t => {
  const path = database(t)
  const helper = fileURLToPath(new URL('../scripts/lib/recovery-helper.mjs', import.meta.url))
  const child = spawn(process.execPath, [helper, path, '7', instanceId], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.resume()
  child.stdin.on('error', () => {})
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Helper waited for EOF after oversized input')) }, 5000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('exit', code => { clearTimeout(timeout); resolve(code) })
  })
  // Keep stdin open. The byte cap must reject input without a newline or EOF.
  child.stdin.write(Buffer.alloc(32769, 120))
  assert.equal(await exited, 1)
  assert.deepEqual(JSON.parse(output), { ok: false, error: 'Recovery command exceeds its limit' })
  const session = new RecoverySession(path, 7, instanceId)
  try { assert.equal(session.inspect().row.status, 'unknown') }
  finally { session.close() }
})

test('recovery CAS audits reconciled only, rejects stale row/session/proof and never confirms preference or clears request', t => {
  const path = database(t), session = new RecoverySession(path, 7, instanceId)
  try {
    const snapshot = session.inspect(), proof = receipt(snapshot)
    for (const invalid of [{ ...proof, session: 'old-session' }, { ...proof, instanceId: 'other' },
      { ...proof, binarySha256: 'e'.repeat(64) }, { ...proof, stopped: { running: true, pid: 10 } },
      { ...proof, started: { running: true, healthy: false, startedAt: 'new-boot' } },
      { ...proof, started: { ...proof.started, startedAt: 'old-boot' } }]) {
      assert.throws(() => session.clear(snapshot.hash, snapshot.session, invalid), /receipt/)
    }
    assert.throws(() => session.clear(expectedHash, snapshot.session, proof), /changed/)
    const result = session.clear(snapshot.hash, snapshot.session, proof)
    assert.equal(result.status, 'reconciled')
    assert.throws(() => session.clear(snapshot.hash, snapshot.session, proof), /consumed/)
    assert.equal(session.inspect().row.preference, 'wallet_only', 'no native preference is changed or claimed confirmed')
    assert.equal(session.inspect().row.status, 'reconciled')
    assert.equal(session.db.prepare('SELECT status FROM requests').get().status, 'running')
    const audit = session.db.prepare('SELECT * FROM funding_recoveries').get()
    assert.equal(audit.original_hash, snapshot.hash)
    assert.equal(JSON.parse(audit.evidence).session, snapshot.session)
  } finally { session.close() }
  const next = new RecoverySession(path, 7, instanceId)
  try { assert.throws(() => next.clear(next.inspect().hash, next.inspect().session, proofForOldSession()), /receipt/) }
  finally { next.close() }
  function proofForOldSession() { return { ...receipt({ session: 'previous-process-session' }) } }
})

test('changed snapshot and SQL audit failure leave unresolved barrier unchanged', t => {
  const path = database(t), session = new RecoverySession(path, 7, instanceId), snapshot = session.inspect()
  try {
    const other = new DatabaseSync(path)
    other.exec("UPDATE funding_writes SET updated_at='new-operator-change' WHERE owner=7")
    other.close()
    assert.throws(() => session.clear(snapshot.hash, snapshot.session, receipt(snapshot)), /changed/)
    const fresh = session.inspect()
    const writer = new DatabaseSync(path)
    writer.exec(`CREATE TABLE funding_recoveries (id TEXT PRIMARY KEY, owner INTEGER, original_hash TEXT,
      original_preference TEXT, original_status TEXT, original_updated_at TEXT, evidence TEXT, reconciled_at TEXT);
      CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON funding_recoveries BEGIN SELECT RAISE(ABORT,'fixture audit rejected'); END`)
    writer.close()
    assert.throws(() => session.clear(fresh.hash, fresh.session, receipt(fresh)), /audit rejected/)
    assert.equal(session.inspect().row.status, 'unknown')
    assert.equal(session.db.prepare('SELECT COUNT(*) AS n FROM funding_recoveries').get().n, 0)
  } finally { session.close() }
})

function dockerFixture(failure) {
  const t = topology(), calls = [], snapshot = { owner: 7, instanceId, hash: expectedHash, row: { status: 'unknown' }, session: 'fixture-session' }
  const commands = [], helper = { name: 'fixture-helper', end() {}, request: async command => {
    commands.push(command)
    if (command.command === 'inspect') return snapshot
    if (command.command === 'clear') return { status: 'reconciled' }
    return { aborted: true }
  } }
  const docker = async args => {
    calls.push(args)
    if (args[0] === 'ps') return studioId + '\n' + nativeId
    if (args[0] === 'inspect') return JSON.stringify(args.length > 4 ? t.peers : [t.native])
    if (args[0] === 'exec') return (failure === 'binary' ? 'f'.repeat(64) : binaryHash) + '  /proc/1/exe'
    if (args[0] === 'stop') {
      if (failure === 'stop') throw new Error('fixture stop uncertain')
      t.native.State.Running = failure === 'pid'; t.native.State.Pid = failure === 'pid' ? 10 : 0
      return nativeId
    }
    if (args[0] === 'start') {
      if (failure === 'start') throw new Error('fixture start failed')
      t.native.State.Running = true; t.native.State.Pid = 20
      t.native.State.StartedAt = failure === 'same-boot' ? 'old-boot' : 'new-boot'
      if (failure === 'topology') t.studio.State.Running = true
      return nativeId
    }
    return ''
  }
  return { t, calls, commands, helper, docker }
}

test('host observes stop/Pid0/start/healthy under one helper session; inspect never stops or clears', async () => {
  const f = dockerFixture()
  assert.equal((await operate(options(), { docker: f.docker, helper: () => f.helper })).status, 'reconciled')
  assert.ok(f.calls.findIndex(call => call[0] === 'stop') < f.calls.findIndex(call => call[0] === 'start'))
  assert.equal(f.commands.find(command => command.command === 'clear').receipt.session, 'fixture-session')
  const readOnly = dockerFixture()
  await operate(options('inspect'), { docker: readOnly.docker, helper: () => readOnly.helper })
  assert.equal(readOnly.calls.some(call => ['stop', 'start'].includes(call[0])), false)
  assert.equal(readOnly.commands.some(command => command.command === 'clear'), false)
})

test('binary/stop/termination/start/boot/topology failures never clear; a mismatch never restarts', async () => {
  const unapproved = dockerFixture()
  await assert.rejects(operate({ ...options(), 'restart-native': false }, { docker: unapproved.docker, helper: () => unapproved.helper }), /approval/)
  assert.equal(unapproved.calls.length, 0)
  for (const failure of ['binary', 'stop', 'pid', 'start', 'same-boot', 'topology']) {
    const f = dockerFixture(failure)
    await assert.rejects(operate(options(), { docker: f.docker, helper: () => f.helper }))
    assert.equal(f.commands.some(command => command.command === 'clear'), false, failure)
  }
  const stale = dockerFixture()
  await assert.rejects(operate({ ...options(), 'expected-row-hash': 'e'.repeat(64) }, { docker: stale.docker, helper: () => stale.helper }), /snapshot/)
  assert.equal(stale.calls.some(call => call[0] === 'stop'), false)
  assert.equal(stale.commands.some(command => command.command === 'clear'), false)
})
