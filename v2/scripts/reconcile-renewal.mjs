// Private offline operator recovery. Never resubmit an unknown Native POST.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { dockerRunner, pinnedBinaryHashes, validateTopology as fundingTopology } from './reconcile-funding.mjs'

const helperPath = fileURLToPath(new URL('./lib/renewal-recovery-helper.mjs', import.meta.url))
const apiPath = fileURLToPath(new URL('../apps/api/src', import.meta.url))
const idPattern = /^[0-9a-f]{64}$/
const envMap = container => Object.fromEntries((container.Config?.Env ?? []).map(value => {
  const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]
}))
export function parseArguments(argv) {
  const mode = argv[0], values = {}
  if (!['inspect', 'adopt', 'close-empty'].includes(mode)) throw new Error('Use inspect, adopt or close-empty')
  const booleans = new Set(['restart-native', 'confirm-private-token-ingress'])
  const allowed = new Set(['project', 'studio-container', 'native-container', 'instance', 'owner', 'expected-row-hash', 'docker', ...booleans])
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index].replace(/^--/, '')
    if (!argv[index].startsWith('--') || !allowed.has(key) || key in values) throw new Error('Unknown or repeated operator argument')
    if (booleans.has(key)) values[key] = true
    else {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Operator argument value is missing')
      values[key] = argv[++index]
    }
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.project ?? '') || !idPattern.test(values['studio-container'] ?? '')
    || !idPattern.test(values['native-container'] ?? '') || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(values.instance ?? '')
    || !/^[1-9][0-9]*$/.test(values.owner ?? '') || !Number.isSafeInteger(Number(values.owner))) throw new Error('Exact project, full container IDs, instance UUID and positive owner are required')
  if (mode !== 'inspect' && (!values['restart-native'] || !values['confirm-private-token-ingress'] || !idPattern.test(values['expected-row-hash'] ?? ''))) throw new Error('Recovery requires explicit restart, private token ingress confirmation and expected row hash')
  if (mode === 'inspect' && (values['restart-native'] || values['confirm-private-token-ingress'] || values['expected-row-hash'])) throw new Error('Inspect accepts no mutation approval')
  return { mode, ...values, owner: Number(values.owner) }
}

export function validateTopology(options, studio, native, peers, helperId) {
  const topology = fundingTopology(options, studio, native, peers)
  const env = envMap(native), studioEnv = envMap(studio)
  if (env.LOG_SQL_DSN || (env.BATCH_UPDATE_ENABLED && env.BATCH_UPDATE_ENABLED !== 'false')) throw new Error('Separate log databases and batch accounting are unsupported')
  if (studioEnv.GOUO_ACCOUNT_INSTANCE_ID !== options.instance || studioEnv.GOUO_ENABLE_TOKEN_RENEWAL !== 'true'
    || studioEnv.GOUO_RELAY_CREDENTIAL_MODE !== 'user-token' || studioEnv.GOUO_RELAY_ROUTING_MODE !== 'model'
    || studioEnv.GOUO_RELAY_API_KEY || studioEnv.GOUO_RELAY_API_KEY_FILE || studioEnv.GOUO_RELAY_OWNER_ID) throw new Error('Current Studio must use the approved instance and finite per-user renewal configuration')
  if (peers.some(peer => peer.Id !== studio.Id && peer.Id !== helperId && peer.State?.Running
    && peer.Mounts?.some(mount => mount.Name === topology.studioVolume && mount.RW))) throw new Error('Another process can write the Studio ledger volume')
  return topology
}

// Read only current mounted configuration. Never forward credential variables.
const configNames = ['GOUO_STUDIO_MODELS_FILE', 'GOUO_BACKEND_DEV_TARGET', 'GOUO_GATEWAY_BASE_URL',
  'GOUO_RELAY_ROUTING_MODE', 'GOUO_RELAY_CREDENTIAL_MODE', 'GOUO_USER_TOKEN_QUOTA_CAP', 'GOUO_USER_TOKEN_LIFETIME_SECONDS',
  'GOUO_NORMAL_ROUTING_EVIDENCE_FILE', 'GOUO_TOKEN_RENEWAL_POLICY_FILE', 'GOUO_ENABLE_TOKEN_RENEWAL', 'GOUO_ACCOUNT_INSTANCE_ID']
function configArguments(studio) {
  const env = envMap(studio), args = []
  for (const key of configNames) if (env[key] !== undefined) args.push('--env', key + '=' + env[key])
  const mounts = new Map()
  for (const key of ['GOUO_STUDIO_MODELS_FILE', 'GOUO_NORMAL_ROUTING_EVIDENCE_FILE', 'GOUO_TOKEN_RENEWAL_POLICY_FILE']) {
    if (!env[key] || !env[key].startsWith('/') || env[key].split('/').includes('..')) throw new Error('Current approval files require explicit absolute mounted paths')
    const mount = studio.Mounts?.filter(value => env[key] === value.Destination || env[key].startsWith(value.Destination + '/'))
      .sort((a, b) => b.Destination.length - a.Destination.length)[0]
    if (!mount || mount.RW || !['bind', 'volume'].includes(mount.Type) || mount.Destination === '/data'
      || ['/app', '/app/apps', '/app/apps/api', '/app/apps/api/src'].includes(mount.Destination)) throw new Error('Approval files must have separate read-only config mounts')
    mounts.set(mount.Destination, mount)
  }
  for (const mount of mounts.values()) args.push('--mount', `type=${mount.Type},source=${mount.Type === 'volume' ? mount.Name : mount.Source},target=${mount.Destination},readonly`)
  return args
}
export async function readCurrentApproval(docker, studio, topology) {
  const code = `import {loadConfig} from '/app/apps/api/src/config.mjs';
    import {renewalPolicyHash} from '/app/apps/api/src/relay-renewals.mjs';
    const c=loadConfig(); if(!c.tokenRenewalPolicy||c.relayCredentialMode!=='user-token')throw Error('Invalid finite renewal approval');
    console.log(JSON.stringify({instanceId:c.accountInstanceId,quotaCap:c.userTokenQuotaCap,lifetimeSeconds:c.userTokenLifetimeSeconds,
      policyHash:renewalPolicyHash(c.tokenRenewalPolicy),modelLimits:[...new Set(c.models.filter(m=>m.enabled&&m.verification==='live-verified'&&m.kind!=='video').map(m=>m.upstreamModelId))].sort().join(',')}));`
  return JSON.parse(await docker(['run', '--rm', '--network', 'none', '--read-only',
    '--mount', `type=bind,source=${apiPath},target=/app/apps/api/src,readonly`, ...configArguments(studio),
    '--entrypoint', 'node', topology.studioImage, '--input-type=module', '-e', code]))
}

function helperSession(binary, topology, options) {
  const name = 'gouo-renewal-recovery-' + randomUUID()
  const child = spawn(binary, ['run', '--rm', '-i', '--name', name, '--network', 'none', '--read-only',
    '--mount', `type=volume,source=${topology.studioVolume},target=/data`,
    '--mount', `type=volume,source=${topology.nativeVolume},target=/native,readonly`,
    '--mount', `type=bind,source=${helperPath},target=/app/scripts/lib/renewal-recovery-helper.mjs,readonly`,
    '--mount', `type=bind,source=${apiPath},target=/app/apps/api/src,readonly`,
    '--entrypoint', 'node', topology.studioImage, '/app/scripts/lib/renewal-recovery-helper.mjs', topology.ledgerPath, String(options.owner), options.instance],
  { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = '', pending
  const fail = () => { pending?.reject(new Error('Renewal recovery helper failed; unresolved barrier retained')); pending = undefined }
  child.stderr.on('data', () => {}); child.stdin.on('error', fail)
  child.on('error', fail); child.on('exit', fail)
  child.stdout.on('data', chunk => {
    buffer += chunk
    if (Buffer.byteLength(buffer) > 65536) { child.kill(); fail(); return }
    const newline = buffer.indexOf('\n'); if (newline < 0) return
    try {
      const result = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
      if (!pending) { child.kill(); return }
      const waiting = pending; pending = undefined
      if (!result.ok) waiting.reject(new Error(result.error)); else waiting.resolve(result.data ?? result)
    } catch { fail() }
  })
  return { name, request(command) {
    if (pending || child.exitCode !== null) return Promise.reject(new Error('Recovery helper session unavailable'))
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => { fail(); child.kill() }, 10_000)
      pending = { resolve: value => { clearTimeout(timeout); resolvePromise(value) }, reject: error => { clearTimeout(timeout); reject(error) } }
      child.stdin.write(JSON.stringify(command) + '\n')
    })
  }, end() { child.stdin.end() } }
}
const inspected = async (docker, id) => JSON.parse(await docker(['inspect', '--type', 'container', id]))[0]
async function peersOf(docker) {
  const ids = (await docker(['ps', '-aq'])).split(/\s+/).filter(Boolean)
  return ids.length ? JSON.parse(await docker(['inspect', '--type', 'container', ...ids])) : []
}
export async function operate(options, dependencies = {}) {
  if (!['inspect', 'adopt', 'close-empty'].includes(options.mode) || (options.mode !== 'inspect'
    && (options['restart-native'] !== true || options['confirm-private-token-ingress'] !== true))) throw new Error('Explicit operator restart and private ingress approval required')
  const binary = options.docker ?? 'docker', docker = dependencies.docker ?? dockerRunner(binary)
  const peers = await peersOf(docker), studio = peers.find(peer => peer.Id === options['studio-container']), native = peers.find(peer => peer.Id === options['native-container'])
  if (!studio || !native) throw new Error('Exact Studio and Native container IDs not found')
  const topology = validateTopology(options, studio, native, peers)
  const binaryHash = (await docker(['exec', native.Id, 'sha256sum', '/proc/1/exe'])).split(/\s/)[0]
  if (!pinnedBinaryHashes.has(binaryHash)) throw new Error('Native binary does not match pinned release')
  const approvalReader = dependencies.readCurrentApproval ?? readCurrentApproval
  const currentApproval = await approvalReader(docker, studio, topology)
  const helper = (dependencies.helper ?? helperSession)(binary, topology, options)
  let nativeStopAttempted = false
  try {
    const snapshot = await helper.request({ command: 'inspect', currentApproval })
    if (options.mode === 'inspect') return { owner: snapshot.owner, instanceId: snapshot.instanceId, row: snapshot.row,
      hash: snapshot.hash, target: snapshot.target, proof: snapshot.proof, oldBinding: snapshot.oldBinding, currentApproval,
      nativeContainer: native.Id, message: 'Read-only inspection. No Native restart or ledger change.' }
    if (snapshot.hash !== options['expected-row-hash'] || !['unknown', 'pending'].includes(snapshot.row.status)) throw new Error('Renewal does not match approved unresolved snapshot')
    if (snapshot.target?.version !== 2 || !snapshot.proof || snapshot.target.instanceId !== currentApproval.instanceId
      || snapshot.target.limits?.quotaCap !== currentApproval.quotaCap || snapshot.target.limits?.lifetimeSeconds !== currentApproval.lifetimeSeconds
      || snapshot.target.policyHash !== currentApproval.policyHash || snapshot.target.approved?.model_limits !== currentApproval.modelLimits) throw new Error('Version 2 persisted proof and unchanged current approval required before restart')
    nativeStopAttempted = true
    await docker(['stop', '--timeout', '10', native.Id])
    const stopped = await inspected(docker, native.Id)
    if (stopped.Id !== native.Id || stopped.Image !== native.Image || stopped.State?.Running !== false || stopped.State?.Pid !== 0) throw new Error('Old Native process termination not established')
    const receipt = { version: 1, session: snapshot.session, containerId: native.Id, imageId: native.Image, binarySha256: binaryHash,
      oldStartedAt: native.State.StartedAt, stopped: { running: false, pid: 0, finishedAt: stopped.State.FinishedAt },
      instanceId: options.instance, project: options.project, networkId: topology.networkId, privateTokenIngressConfirmed: true }
    await helper.request({ command: 'read-native', phase: 'stopped', expectedHash: snapshot.hash, session: snapshot.session, receipt })
    await docker(['start', native.Id])
    let started
    for (let attempt = 0; attempt < 60; attempt++) {
      started = await inspected(docker, native.Id)
      if (started.Id !== native.Id || started.Image !== native.Image || started.State?.Running !== true
        || started.State.Pid <= 0 || started.State.StartedAt === native.State.StartedAt) throw new Error('Distinct new Native process not established')
      if (started.State.Health?.Status === 'healthy') break
      if (attempt === 59) throw new Error('New Native process did not become healthy')
      await delay(1000)
    }
    if ((await docker(['exec', native.Id, 'sha256sum', '/proc/1/exe'])).split(/\s/)[0] !== binaryHash) throw new Error('Native binary changed during restart')
    const dateCode = `const r=await fetch('http://127.0.0.1:3000/api/status',{redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Native status failed');const n=Date.parse(r.headers.get('date'))/1000;if(!Number.isSafeInteger(n)||n<=0)throw Error('Native Date invalid');console.log(n);`
    receipt.nativeDate = Number(await docker(['exec', native.Id, 'node', '--input-type=module', '-e', dateCode]))
    receipt.started = { running: true, healthy: true, pid: started.State.Pid, startedAt: started.State.StartedAt }
    await helper.request({ command: 'read-native', phase: 'started', expectedHash: snapshot.hash, session: snapshot.session, receipt })
    const current = await peersOf(docker), currentNative = current.find(peer => peer.Id === native.Id), currentStudio = current.find(peer => peer.Id === studio.Id)
    const helperId = current.find(peer => peer.Name === '/' + helper.name)?.Id
    const finalTopology = validateTopology(options, currentStudio, currentNative, current, helperId)
    if (JSON.stringify(finalTopology) !== JSON.stringify(topology) || currentNative.State.StartedAt !== receipt.started.startedAt
      || currentNative.Image !== native.Image || JSON.stringify(await approvalReader(docker, currentStudio, finalTopology)) !== JSON.stringify(currentApproval)) throw new Error('Deployment or approval changed during recovery')
    return await helper.request({ command: 'resolve', action: options.mode, expectedHash: snapshot.hash, session: snapshot.session, receipt })
  } catch (error) {
    if (nativeStopAttempted) {
      const current = await inspected(docker, native.Id).catch(() => undefined)
      const state = current?.State?.Running === false ? 'stopped' : current?.State?.Running === true ? 'running' : 'state unknown'
      throw new Error(`${error.message}. Native is ${state}; unresolved recovery must be reviewed. This tool does not restart Studio.`)
    }
    throw error
  } finally {
    await helper.request({ command: 'abort' }).catch(() => {})
    helper.end(); await docker(['rm', '-f', helper.name]).catch(() => {})
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await operate(parseArguments(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
