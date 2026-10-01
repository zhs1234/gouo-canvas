// Private operator tool. Never run reconcile without explicit restart approval.
// No JWT, native preference write, model call, automatic Studio stop/start,
// exported restart receipt, or elapsed-time inference is accepted here.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const helperPath = fileURLToPath(new URL('./lib/recovery-helper.mjs', import.meta.url))
export const pinnedBinaryHashes = new Set([
  'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529',
  '8689cc98471806eb03093849abdcfe974e582b85571b44da0d1816b21b360227',
])
const idPattern = /^[0-9a-f]{64}$/
export function parseArguments(argv) {
  const mode = argv[0], values = {}
  if (!['inspect', 'reconcile'].includes(mode)) throw new Error('Use inspect or reconcile; reconcile requires --restart-native')
  const allowed = new Set(['project', 'studio-container', 'native-container', 'instance', 'owner', 'expected-row-hash', 'docker', 'restart-native'])
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    if (!argv[i].startsWith('--') || !allowed.has(key) || key in values) throw new Error('Unknown or repeated operator argument')
    if (key === 'restart-native') values[key] = true
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Operator argument value is missing')
      values[key] = argv[++i]
    }
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.project ?? '') || !idPattern.test(values['studio-container'] ?? '')
    || !idPattern.test(values['native-container'] ?? '') || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(values.instance ?? '')
    || !/^[1-9][0-9]*$/.test(values.owner ?? '') || !Number.isSafeInteger(Number(values.owner))) throw new Error('Exact project, full container IDs, instance UUID and positive owner are required')
  if (mode === 'reconcile' && (!values['restart-native'] || !idPattern.test(values['expected-row-hash'] ?? ''))) throw new Error('Reconcile requires explicit --restart-native and --expected-row-hash')
  if (mode === 'inspect' && (values['restart-native'] || values['expected-row-hash'])) throw new Error('Inspect is read-only and does not accept restart approval')
  return { mode, ...values, owner: Number(values.owner) }
}
const envMap = container => Object.fromEntries((container.Config?.Env ?? []).map(value => {
  const equals = value.indexOf('='); return [value.slice(0, equals), value.slice(equals + 1)]
}))
function dataVolume(container) {
  const mounts = container.Mounts?.filter(mount => mount.Destination === '/data') ?? []
  if (mounts.length !== 1 || mounts[0].Type !== 'volume' || !mounts[0].Name || !mounts[0].RW) throw new Error('A persistent writable /data Docker volume is required')
  return mounts[0].Name
}
export function validateTopology(options, studio, native, peers) {
  for (const [container, service, expected] of [[studio, 'studio-api', options['studio-container']], [native, 'new-api', options['native-container']]]) {
    if (container.Id !== expected || container.Config?.Labels?.['com.docker.compose.project'] !== options.project
      || container.Config?.Labels?.['com.docker.compose.service'] !== service) throw new Error('Container identity does not match the exact Compose service')
  }
  if (studio.State?.Running !== false || studio.State?.Pid !== 0) throw new Error('Stop Studio explicitly before recovery; this tool will not stop it')
  if (native.State?.Running !== true || native.State?.Pid <= 0 || !native.State?.StartedAt) throw new Error('Native must be running before the observed restart')
  if (native.Config?.Entrypoint?.length !== 1 || native.Config.Entrypoint[0] !== '/usr/local/bin/new-api'
    || native.Config.Cmd?.length || native.HostConfig?.Init) throw new Error('Unsupported native process entrypoint')
  const nativeEnv = envMap(native), studioEnv = envMap(studio)
  if (nativeEnv.SQL_DSN || nativeEnv.REDIS_CONN_STRING || nativeEnv.SQLITE_PATH !== '/data/new-api.db') throw new Error('Only the local SQLite/no-Redis native deployment can establish this restart barrier')
  if (Object.values(native.HostConfig?.PortBindings ?? {}).some(bindings => bindings?.length)
    || Object.values(native.NetworkSettings?.Ports ?? {}).some(bindings => bindings?.length)) throw new Error('Native host-published ports are not supported')
  const nativeNetworks = Object.entries(native.NetworkSettings?.Networks ?? {})
  if (nativeNetworks.length !== 1) throw new Error('Native must use exactly one private Compose network')
  const [networkName, network] = nativeNetworks[0]
  if (networkName !== options.project + '_default' || !network.NetworkID || !network.Aliases?.includes('new-api')
    || studio.NetworkSettings?.Networks?.[networkName]?.NetworkID !== network.NetworkID) throw new Error('Native origin is not uniquely mapped to the private Compose network')
  if (studioEnv.GOUO_BACKEND_DEV_TARGET !== 'http://new-api:3000' || studioEnv.GOUO_GATEWAY_BASE_URL !== 'http://new-api:3000/v1') throw new Error('Studio origin does not match the approved local native service')
  const ledgerPath = studioEnv.GOUO_STUDIO_LEDGER_PATH
  if (!/^\/data\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.sqlite$/.test(ledgerPath ?? '')) throw new Error('Ledger must be an explicit SQLite path in the Studio data volume')
  if (peers.filter(peer => peer.Config?.Labels?.['com.docker.compose.project'] === options.project && peer.Config?.Labels?.['com.docker.compose.service'] === 'new-api').length !== 1
    || peers.filter(peer => peer.Config?.Labels?.['com.docker.compose.project'] === options.project && peer.Config?.Labels?.['com.docker.compose.service'] === 'studio-api').length !== 1) throw new Error('Multiple or missing Native/Studio service containers are not supported')
  if (peers.some(peer => peer.Id !== native.Id && peer.NetworkSettings?.Networks?.[networkName]?.Aliases?.includes('new-api'))) throw new Error('Another container can receive the native service alias')
  const studioVolume = dataVolume(studio), nativeVolume = dataVolume(native)
  if (studioVolume === nativeVolume) throw new Error('Native and Studio must have separate data volumes')
  if (peers.some(peer => peer.Id !== native.Id && peer.State?.Running && peer.Mounts?.some(mount => mount.Name === nativeVolume && mount.RW))) throw new Error('Another process can write the native SQLite volume')
  if (!/^sha256:[0-9a-f]{64}$/.test(studio.Image ?? '')) throw new Error('Studio helper requires an exact local image identity')
  return { networkName, networkId: network.NetworkID, ledgerPath, studioVolume, nativeVolume, studioImage: studio.Image }
}

export function dockerRunner(binary = 'docker') {
  return args => new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(30_000) })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 2 * 1024 * 1024) child.kill() })
    child.stderr.on('data', () => {}) // Do not accidentally print inspect/env data.
    child.on('error', () => reject(new Error('Docker command could not complete')))
    child.on('exit', code => code === 0 ? resolvePromise(output.trim()) : reject(new Error(`Docker ${args[0]} failed; recovery remains blocked`)))
  })
}
async function inspected(docker, containerId) { return JSON.parse(await docker(['inspect', '--type', 'container', containerId]))[0] }

export async function observeRestart(docker, native, session, binaryHash) {
  if (!pinnedBinaryHashes.has(binaryHash)) throw new Error('Native process binary does not match the pinned release')
  // The ordering of this continuously held session is the proof. No timestamp
  // ordering, externally supplied receipt or "wait long enough" is sufficient.
  await docker(['stop', '--timeout', '10', native.Id])
  const stopped = await inspected(docker, native.Id)
  if (stopped.Id !== native.Id || stopped.State?.Running !== false || stopped.State?.Pid !== 0) throw new Error('Old native process termination was not established')
  await docker(['start', native.Id])
  let started
  for (let attempt = 0; attempt < 60; attempt++) {
    started = await inspected(docker, native.Id)
    if (started.Id !== native.Id || started.Image !== native.Image || started.State?.Running !== true
      || started.State?.StartedAt === native.State.StartedAt || started.State?.Pid <= 0) throw new Error('A distinct new native process was not established')
    if (started.State.Health?.Status === 'healthy') break
    if (attempt === 59) throw new Error('New native process did not become healthy')
    await delay(1000)
  }
  const newHash = (await docker(['exec', native.Id, 'sha256sum', '/proc/1/exe'])).split(/\s/)[0]
  if (newHash !== binaryHash) throw new Error('Native binary changed during restart')
  return { version: 1, session, containerId: native.Id, imageId: native.Image, binarySha256: binaryHash,
    oldStartedAt: native.State.StartedAt, stopped: { running: false, pid: 0, finishedAt: stopped.State.FinishedAt },
    started: { running: true, healthy: true, pid: started.State.Pid, startedAt: started.State.StartedAt } }
}

function helperSession(binary, topology, options) {
  const name = 'gouo-funding-recovery-' + randomUUID()
  const child = spawn(binary, ['run', '--rm', '-i', '--name', name, '--network', 'none', '--read-only',
    '--mount', `type=volume,source=${topology.studioVolume},target=/data`,
    '--mount', `type=bind,source=${helperPath},target=/recovery-helper.mjs,readonly`,
    '--entrypoint', 'node', topology.studioImage, '/recovery-helper.mjs', topology.ledgerPath, String(options.owner), options.instance],
  { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = '', pending
  const fail = () => { pending?.reject(new Error('Recovery helper failed; the barrier was not cleared')); pending = undefined }
  child.stderr.on('data', () => {})
  child.on('error', fail); child.on('exit', fail)
  child.stdout.on('data', chunk => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > 32768) { child.kill(); fail(); return }
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    try {
      const result = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
      if (!pending) { child.kill(); return }
      const waiting = pending; pending = undefined
      if (!result.ok) waiting.reject(new Error(result.error)); else waiting.resolve(result.data ?? result)
    } catch { fail() }
  })
  return {
    name,
    request(command) {
      if (pending || child.exitCode !== null) return Promise.reject(new Error('Recovery helper session is unavailable'))
      return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => { fail(); child.kill() }, 10_000)
        pending = { resolve: value => { clearTimeout(timeout); resolvePromise(value) }, reject: error => { clearTimeout(timeout); reject(error) } }
        child.stdin.write(JSON.stringify(command) + '\n')
      })
    },
    end() { child.stdin.end() },
  }
}

export async function operate(options, dependencies = {}) {
  if (!['inspect', 'reconcile'].includes(options.mode) || (options.mode === 'reconcile' && options['restart-native'] !== true)) throw new Error('Observed restart requires explicit operator approval')
  const binary = options.docker ?? 'docker', docker = dependencies.docker ?? dockerRunner(binary)
  const ids = (await docker(['ps', '-aq'])).split(/\s+/).filter(Boolean)
  const peers = ids.length ? JSON.parse(await docker(['inspect', '--type', 'container', ...ids])) : []
  const studio = peers.find(peer => peer.Id === options['studio-container']), native = peers.find(peer => peer.Id === options['native-container'])
  if (!studio || !native) throw new Error('Exact Studio and Native container IDs were not found')
  const topology = validateTopology(options, studio, native, peers)
  const binaryHash = (await docker(['exec', native.Id, 'sha256sum', '/proc/1/exe'])).split(/\s/)[0]
  if (!pinnedBinaryHashes.has(binaryHash)) throw new Error('Native process binary does not match the pinned release')
  const helper = (dependencies.helper ?? helperSession)(binary, topology, options)
  try {
    const snapshot = await helper.request({ command: 'inspect' })
    if (options.mode === 'inspect') return { owner: snapshot.owner, instanceId: snapshot.instanceId, row: snapshot.row, hash: snapshot.hash,
      nativeContainer: native.Id, nativeBinarySha256: binaryHash, message: 'Read-only inspection. No restart, preference write or barrier change occurred.' }
    if (snapshot.hash !== options['expected-row-hash'] || !['unknown', 'pending'].includes(snapshot.row.status)) throw new Error('Funding row does not match the approved unresolved snapshot')
    const receipt = await observeRestart(docker, native, snapshot.session, binaryHash)
    // Revalidate identity/topology and offline Studio before CAS, still holding
    // the helper lock; another service instance never makes a valid proof.
    const currentIds = (await docker(['ps', '-aq'])).split(/\s+/).filter(Boolean)
    const current = JSON.parse(await docker(['inspect', '--type', 'container', ...currentIds]))
    const currentNative = current.find(peer => peer.Id === native.Id)
    const finalTopology = validateTopology(options, current.find(peer => peer.Id === studio.Id), currentNative, current)
    if (JSON.stringify(finalTopology) !== JSON.stringify(topology) || currentNative.State.StartedAt !== receipt.started.startedAt
      || currentNative.Image !== native.Image) throw new Error('Deployment identity changed during recovery')
    receipt.instanceId = options.instance; receipt.project = options.project; receipt.networkId = topology.networkId
    return await helper.request({ command: 'clear', expectedHash: snapshot.hash, session: snapshot.session, receipt })
  } finally {
    await helper.request({ command: 'abort' }).catch(() => {})
    helper.end()
    await docker(['rm', '-f', helper.name]).catch(() => {}) // Only this transient helper.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await operate(parseArguments(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
