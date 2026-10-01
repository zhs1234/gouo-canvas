import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArguments, validateTopology, operate } from '../scripts/reconcile-renewal.mjs'
import { pinnedBinaryHashes } from '../scripts/reconcile-funding.mjs'

const instance = '11111111-2222-4333-8444-555555555555'
const studioId = 'a'.repeat(64), nativeId = 'b'.repeat(64), imageId = 'sha256:' + 'c'.repeat(64), expectedHash = 'd'.repeat(64)
const binaryHash = [...pinnedBinaryHashes][0]
const approval = { instanceId: instance, quotaCap: 100, lifetimeSeconds: 3600, policyHash: 'e'.repeat(64), modelLimits: 'fixture-chat' }
const options = (mode = 'adopt') => ({ mode, project: 'renewal-fixture', 'studio-container': studioId, 'native-container': nativeId,
  instance, owner: 7, 'expected-row-hash': expectedHash, 'restart-native': true, 'confirm-private-token-ingress': true })
function topology() {
  const network = { NetworkID: 'fixture-network', Aliases: ['new-api'] }
  const native = { Id: nativeId, Image: imageId, State: { Running: true, Pid: 10, StartedAt: 'old', Health: { Status: 'healthy' } },
    Config: { Labels: { 'com.docker.compose.project': 'renewal-fixture', 'com.docker.compose.service': 'new-api' },
      Entrypoint: ['/usr/local/bin/new-api'], Cmd: null, Env: ['SQLITE_PATH=/data/new-api.db', 'BATCH_UPDATE_ENABLED=false'] },
    HostConfig: { PortBindings: {} }, NetworkSettings: { Ports: {}, Networks: { 'renewal-fixture_default': network } },
    Mounts: [{ Type: 'volume', Name: 'native-data', Destination: '/data', RW: true }] }
  const studio = { Id: studioId, Image: imageId, State: { Running: false, Pid: 0 },
    Config: { Labels: { 'com.docker.compose.project': 'renewal-fixture', 'com.docker.compose.service': 'studio-api' },
      Env: ['GOUO_BACKEND_DEV_TARGET=http://new-api:3000', 'GOUO_GATEWAY_BASE_URL=http://new-api:3000/v1', 'GOUO_STUDIO_LEDGER_PATH=/data/requests.sqlite',
        'GOUO_ACCOUNT_INSTANCE_ID=' + instance, 'GOUO_ENABLE_TOKEN_RENEWAL=true', 'GOUO_RELAY_CREDENTIAL_MODE=user-token', 'GOUO_RELAY_ROUTING_MODE=model'] },
    NetworkSettings: { Networks: { 'renewal-fixture_default': { ...network, Aliases: ['studio-api'] } } },
    Mounts: [{ Type: 'volume', Name: 'studio-data', Destination: '/data', RW: true }] }
  return { studio, native, peers: [studio, native] }
}
test('CLI requires separate explicit restart/private-ingress approval and rejects external receipts or duplicate flags', () => {
  const argv = ['adopt', '--project', 'renewal-fixture', '--studio-container', studioId, '--native-container', nativeId,
    '--instance', instance, '--owner', '7', '--expected-row-hash', expectedHash, '--restart-native', '--confirm-private-token-ingress']
  assert.equal(parseArguments(argv).mode, 'adopt')
  for (const bad of [argv.slice(0, -1), argv.filter(x => x !== '--restart-native'), [...argv, '--receipt', '{}'],
    [...argv, '--owner', '8'], argv.map(x => x === studioId ? 'short-id' : x), ['inspect', ...argv.slice(1)]]) assert.throws(() => parseArguments(bad))
})
test('topology rejects public/log/Redis/batch/shared-key deployments and competing Studio writers', () => {
  const good = topology(); assert.equal(validateTopology(options(), good.studio, good.native, good.peers).nativeVolume, 'native-data')
  for (const change of [t => t.native.Config.Env.push('LOG_SQL_DSN=remote'), t => t.native.Config.Env.push('REDIS_CONN_STRING=redis'),
    t => t.native.Config.Env.push('BATCH_UPDATE_ENABLED=true'), t => t.studio.Config.Env.push('GOUO_RELAY_API_KEY=synthetic-secret'),
    t => t.studio.Config.Env.push('GOUO_ACCOUNT_INSTANCE_ID=other'), t => { t.studio.State.Running = true },
    t => { t.native.HostConfig.PortBindings = { '3000/tcp': [{ HostPort: '3000' }] } },
    t => t.peers.push({ Id: 'f'.repeat(64), State: { Running: true }, Mounts: structuredClone(t.studio.Mounts) })]) {
    const bad = topology(); change(bad); assert.throws(() => validateTopology(options(), bad.studio, bad.native, bad.peers))
  }
})
function fixture(failure) {
  const t = topology(), calls = [], commands = [], order = []
  const snapshot = { owner: 7, instanceId: instance, hash: expectedHash, row: { status: 'unknown' }, session: 'fixture-session', proof: { version: 1 },
    target: { version: 2, instanceId: instance, policyHash: approval.policyHash, limits: { quotaCap: 100, lifetimeSeconds: 3600 }, approved: { model_limits: 'fixture-chat' } } }
  const helper = { name: 'fixture-helper', end() {}, async request(command) {
    commands.push(command); order.push(command.command + (command.phase ? ':' + command.phase : ''))
    if (command.command === 'inspect') return snapshot
    if (command.command === 'read-native' && failure === command.phase) throw new Error('Native metadata inconsistent')
    if (command.command === 'resolve') return { status: 'adopted' }
    return {}
  } }
  const docker = async args => {
    calls.push(args); order.push(args[0])
    if (args[0] === 'ps') return studioId + '\n' + nativeId
    if (args[0] === 'inspect') return JSON.stringify(args.length > 4 ? t.peers : [t.native])
    if (args[0] === 'exec') return args[2] === 'sha256sum' ? (failure === 'binary' ? 'f'.repeat(64) : binaryHash) + '  /proc/1/exe' : '1700000000'
    if (args[0] === 'stop') {
      if (failure === 'stop') throw new Error('Stop uncertain')
      t.native.State.Running = failure === 'pid'; t.native.State.Pid = failure === 'pid' ? 10 : 0
      return nativeId
    }
    if (args[0] === 'start') {
      if (failure === 'start') throw new Error('Start failed')
      t.native.State.Running = true; t.native.State.Pid = 20; t.native.State.StartedAt = failure === 'same-boot' ? 'old' : 'new'
      if (failure === 'topology') t.studio.State.Running = true
      return nativeId
    }
    return ''
  }
  let reads = 0
  const readCurrentApproval = async () => (++reads > 1 && failure === 'approval' ? { ...approval, quotaCap: 101 } : approval)
  return { calls, commands, order, snapshot, dependencies: { docker, helper: () => helper, readCurrentApproval } }
}
test('single continuous session observes stopped read then new boot/read before CAS and never starts Studio', async () => {
  const f = fixture(); assert.equal((await operate(options(), f.dependencies)).status, 'adopted')
  const stop = f.order.indexOf('stop'), first = f.order.indexOf('read-native:stopped'), start = f.order.indexOf('start'), second = f.order.indexOf('read-native:started')
  assert.ok(stop < first && first < start && start < second && second < f.order.indexOf('resolve'))
  assert.deepEqual(f.calls.filter(c => c[0] === 'start'), [['start', nativeId]])
  const resolution = f.commands.find(c => c.command === 'resolve')
  assert.equal(resolution.receipt.privateTokenIngressConfirmed, true)
  assert.equal(resolution.receipt.nativeDate, 1700000000)
})
test('read-only inspect makes no stop/start/readNative/resolve request', async () => {
  const f = fixture(); await operate(options('inspect'), f.dependencies)
  assert.equal(f.calls.some(c => ['stop', 'start'].includes(c[0])), false)
  assert.equal(f.commands.some(c => ['read-native', 'resolve'].includes(c.command)), false)
})
test('stale hash, legacy target, absent proof or changed approval fails before stopping Native', async () => {
  for (const change of [s => { s.hash = 'f'.repeat(64) }, s => { s.target.version = 1 }, s => { s.proof = null },
    s => { s.target.approved.model_limits = 'different' }, s => { s.target.limits.quotaCap = 101 }]) {
    const f = fixture(); change(f.snapshot); await assert.rejects(operate(options(), f.dependencies))
    assert.equal(f.calls.some(c => c[0] === 'stop'), false)
  }
})
test('binary/stop/Pid/SQLite/boot/topology/config-drift failures never resolve, mutate funding or resubmit creation', async () => {
  for (const failure of ['binary', 'stop', 'pid', 'stopped', 'start', 'same-boot', 'started', 'topology', 'approval']) {
    const f = fixture(failure)
    await assert.rejects(operate(options(), f.dependencies), error => {
      if (failure !== 'binary') {
        assert.match(error.message, ['stopped', 'start'].includes(failure) ? /Native is stopped/ : /Native is running/)
        assert.match(error.message, /does not restart Studio/)
      }
      return true
    })
    assert.equal(f.commands.some(c => c.command === 'resolve'), false, failure)
    assert.equal(f.calls.some(c => c.includes('/api/token/')), false)
  }
  const f = fixture(); await assert.rejects(operate({ ...options(), 'confirm-private-token-ingress': false }, f.dependencies))
  assert.equal(f.calls.length, 0)
})
