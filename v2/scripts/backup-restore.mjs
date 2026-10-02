// OPS-1 opt-in SYNTHETIC PRIVATE ONLY. Run from v2. Operators stop both
// services themselves; never use user-acceptance-environment.mjs stop (it deletes volumes).
// inspect|backup: --state <.local/state.json> --native-container <full64hex>
//   --studio-container <full64hex> --confirm-synthetic-private [--out <new .local/dir>]
// verify: --backup <.local/backup-dir> --confirm-synthetic-private (no Docker)
// restore-empty adds --backup, --target-state, --target-native-container and
// --target-studio-container. Manually compose create a DIFFERENT random project
// with empty volumes, the SAME instance/config/secrets/images/source binds. Do
// not use acceptance start, initialize accounts, or start the restored pair first.
// All JSON is metadata; the private SQLite backup itself contains synthetic keys.
import { readFile, mkdir, mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { resolve, relative, isAbsolute, dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dockerRunner, pinnedBinaryHashes } from './reconcile-funding.mjs'
import { sourceCommit, binarySha256, guard, digest, safePath, fileProof, createPairBackup, verifyPair, inspectPair, BackupError } from './lib/backup-helper.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
const id = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value)
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)
const env = container => Object.fromEntries((container.Config?.Env ?? []).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)] }))
const envHash = container => digest(Object.entries(env(container)).sort(([a], [b]) => a.localeCompare(b)))
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
export function parseArguments(argv) {
  const [mode, ...args] = argv, options = { mode }
  guard(['inspect', 'backup', 'verify', 'restore-empty'].includes(mode), 'MODE_REJECTED')
  const allowed = ['state', 'native-container', 'studio-container', 'out', 'backup', 'target-state', 'target-native-container', 'target-studio-container', 'confirm-synthetic-private']
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '')
    guard(args[index].startsWith('--') && allowed.includes(key) && !Object.hasOwn(options, key), 'ARGUMENT_REJECTED')
    options[key] = key === 'confirm-synthetic-private' ? true : args[++index]
    guard(options[key] === true || typeof options[key] === 'string' && options[key] && !options[key].startsWith('--'), 'ARGUMENT_REJECTED')
  }
  guard(options['confirm-synthetic-private'] === true, 'SYNTHETIC_CONFIRMATION_REQUIRED')
  const required = mode === 'verify' ? ['backup'] : ['state', 'native-container', 'studio-container',
    ...(mode === 'backup' ? ['out'] : []), ...(mode === 'restore-empty' ? ['backup', 'target-state', 'target-native-container', 'target-studio-container'] : [])]
  guard(required.every(key => typeof options[key] === 'string') && Object.keys(options).every(key => ['mode', 'confirm-synthetic-private', ...required].includes(key)), 'MODE_ARGUMENT_REJECTED')
  for (const key of required.filter(key => key.endsWith('container'))) guard(id(options[key]), 'FULL_CONTAINER_ID_REQUIRED')
  return options
}
export function confined(path, root, missingFinal = false) {
  guard(typeof path === 'string' && path, 'LOCAL_PATH_REQUIRED'); safePath(root)
  const absolute = safePath(path, missingFinal), suffix = relative(resolve(root), absolute)
  guard(suffix && !suffix.startsWith('..') && !isAbsolute(suffix), 'PATH_OUTSIDE_LOCAL_REJECTED')
  return absolute
}
async function treeHash(directory) {
  safePath(directory); const entries = []
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name); safePath(file)
      if (entry.isDirectory()) await visit(file)
      else { guard(entry.isFile(), 'SOURCE_FILE_REJECTED'); entries.push([relative(directory, file).replaceAll('\\', '/'), await fileProof(file)]) }
    }
  }
  await visit(directory); guard(entries.length > 0, 'EMPTY_SOURCE_TREE_REJECTED'); return digest(entries)
}
export async function loadState(path, rootWorkspace = workspace) {
  const local = join(rootWorkspace, '.local'), statePath = confined(path, local), state = await json(statePath)
  guard(state.version === 1 && /^gouo-user-acceptance-\d+-[a-z\d]+$/.test(state.project ?? '') && uuid(state.instanceId)
    && state.sourceCommit === sourceCommit && state.binarySha256 === binarySha256 && state.procurementCost === 0
    && state.syntheticComplianceFixture === true && state.provider === 'explicit local acceptance fixture' && state.stopped !== true, 'NON_SYNTHETIC_STATE_REJECTED')
  let origin; try { origin = new URL(state.origin) } catch { throw new BackupError('ORIGIN_REJECTED') }
  guard(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && /^\d+$/.test(origin.port) && Number(origin.port) <= 65535
    && !['8080', '53238', '58438'].includes(origin.port) && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash, 'ORIGIN_REJECTED')
  guard(confined(state.directory, local) === dirname(statePath) && confined(state.compose, local) === join(state.directory, 'compose.json')
    && confined(state.env, local) === join(state.directory, 'empty.env'), 'STATE_DIRECTORY_REJECTED')
  guard((await readFile(state.env, 'utf8')).trim() === '', 'OPERATOR_ENV_REJECTED')
  const compose = await json(state.compose), services = compose.services, native = services?.['new-api'], studio = services?.['studio-api']
  guard(native?.image === 'gouo-v2-new-api:latest' && studio?.image === 'gouo-v2-studio-api:latest'
    && native.environment?.SQLITE_PATH === '/data/new-api.db' && native.environment.SESSION_SECRET === 'synthetic-acceptance-session-only'
    && native.environment.BATCH_UPDATE_ENABLED === 'false' && !native.environment.SQL_DSN && !native.environment.LOG_SQL_DSN && !native.environment.REDIS_CONN_STRING
    && (!native.environment.CRYPTO_SECRET || native.environment.CRYPTO_SECRET === native.environment.SESSION_SECRET), 'NATIVE_CONFIG_REJECTED')
  guard(studio.environment?.GOUO_BACKEND_DEV_TARGET === 'http://new-api:3000' && studio.environment.GOUO_GATEWAY_BASE_URL === 'http://new-api:3000/v1'
    && studio.environment.GOUO_ACCOUNT_INSTANCE_ID === state.instanceId && studio.environment.GOUO_STUDIO_LEDGER_PATH === '/data/requests.sqlite'
    && studio.environment.GOUO_RELAY_CREDENTIAL_MODE === 'user-token' && !studio.environment.GOUO_RELAY_API_KEY && !studio.environment.GOUO_RELAY_API_KEY_FILE, 'STUDIO_CONFIG_REJECTED')
  for (const [key, file] of [['GOUO_STUDIO_MODELS_FILE', 'models.json'], ['GOUO_NORMAL_ROUTING_EVIDENCE_FILE', 'routing.json'],
    ['GOUO_TRIAL_POLICY_FILE', 'trial.json'], ['GOUO_TOKEN_RENEWAL_POLICY_FILE', 'renewal.json']]) guard(studio.environment[key] === '/fixture-config/' + file, 'POLICY_PATH_REJECTED')
  guard(!native.ports && !studio.ports && !services?.['fixture-provider']?.ports
    && services?.['fixture-provider']?.entrypoint?.join(' ') === 'node /app/tests/stack/user-acceptance-environment-provider.mjs', 'PRIVATE_FIXTURE_TOPOLOGY_REJECTED')
  guard(Object.keys(compose.volumes ?? {}).sort().join(',') === 'native-data,studio-data'
    && Object.values(compose.volumes).every(volume => !volume?.external && !volume?.name), 'DATA_VOLUME_REJECTED')
  const apiSource = join(rootWorkspace, 'apps/api/src'), policyDirectory = confined(join(state.directory, 'config'), local)
  for (const [target, source] of [['/app/apps/api/src', apiSource], ['/fixture-config', policyDirectory],
    ['/app/tests/stack/user-acceptance-environment-api.mjs', join(rootWorkspace, 'tests/stack/user-acceptance-environment-api.mjs')]]) {
    safePath(source)
    guard(studio.volumes?.some(mount => mount.type === 'bind' && mount.target === target && resolve(mount.source) === resolve(source) && mount.read_only === true), 'SOURCE_BIND_REJECTED')
  }
  const policy = await json(join(policyDirectory, 'trial.json')), renewal = await json(join(policyDirectory, 'renewal.json')), routing = await json(join(policyDirectory, 'routing.json'))
  guard(policy.instanceId === state.instanceId && policy.sourceCommit === sourceCommit && policy.plan?.price_amount === 0
    && renewal.instanceId === state.instanceId && renewal.sourceCommit === sourceCommit && renewal.redisEnabled === false && renewal.batchUpdateEnabled === false
    && routing.sourceCommit === sourceCommit && routing.gatewayOrigin === 'http://new-api:3000' && routing.retryTimes === 0, 'SYNTHETIC_POLICY_REJECTED')
  return { state, statePath, compose, local, rootWorkspace, apiSource, policyDirectory,
    artifacts: { apiSourceHash: await treeHash(apiSource), policyHash: await treeHash(policyDirectory),
      fixtureSourceHash: digest(await Promise.all(['user-acceptance-environment-api.mjs', 'user-acceptance-environment-provider.mjs'].map(name => fileProof(join(rootWorkspace, 'tests/stack', name))))) } }
}
function overlapsProtectedPath(path, target) {
  return typeof path === 'string' && (path === target || path === '/' || path.startsWith(target + '/') || target.startsWith(path + '/'))
}
function dataVolume(container, project, name) {
  const mounts = container.Mounts?.filter(mount => mount.Destination === '/data') ?? []
  guard(mounts.length === 1 && mounts[0].Type === 'volume' && mounts[0].RW === true && mounts[0].Name === project + '_' + name
    && !container.Mounts.some(mount => mount.Destination !== '/data' && overlapsProtectedPath(mount.Destination, '/data')), 'DATA_VOLUME_REJECTED')
  return mounts[0].Name
}
export function readonlyBindMatches(mount, expected, platform = process.platform) {
  if (mount.Type !== 'bind' || mount.Destination !== expected.target || mount.RW !== false) return false
  if (resolve(mount.Source) === resolve(expected.source)) return true
  // Desktop may expose a Windows bind as its internal Linux drive path before
  // the container has ever started. Restrict this alias to the API source;
  // operate() additionally copies and hashes the actual cold bound contents.
  if (platform !== 'win32' || expected.target !== '/app/apps/api/src') return false
  const windows = win32.resolve(expected.source).replaceAll('\\', '/')
  if (!/^[A-Za-z]:\//.test(windows)) return false
  return mount.Source === '/run/desktop/mnt/host/' + windows[0].toLowerCase() + windows.slice(2)
}
export function validateColdTopology(input, nativeId, studioId, peers) {
  guard(id(nativeId) && id(studioId) && nativeId !== studioId, 'FULL_CONTAINER_ID_REQUIRED')
  const containers = {}
  for (const [service, expected] of [['new-api', nativeId], ['studio-api', studioId]]) {
    const container = peers.find(peer => peer.Id === expected), declared = input.compose.services[service]
    guard(container?.Config?.Labels?.['com.docker.compose.project'] === input.state.project && container.Config.Labels['com.docker.compose.service'] === service
      && container.Config.Image === declared.image && /^sha256:[a-f\d]{64}$/.test(container.Image ?? ''), 'CONTAINER_IDENTITY_REJECTED')
    guard(container.State?.Running === false && container.State.Pid === 0 && ['created', 'exited'].includes(container.State.Status), 'COLD_STOP_REQUIRED')
    guard(![container.HostConfig?.PortBindings, container.NetworkSettings?.Ports].some(ports => Object.values(ports ?? {}).some(value => value?.length)), 'HOST_PORT_REJECTED')
    const networks = Object.keys(container.NetworkSettings?.Networks ?? {})
    guard(networks.length === 1 && networks[0] === input.state.project + '_default' && !container.HostConfig?.Init, 'PRIVATE_NETWORK_REJECTED')
    guard(service !== 'new-api' || container.NetworkSettings.Networks[networks[0]].Aliases?.includes('new-api'), 'NATIVE_ALIAS_REJECTED')
    const actual = env(container)
    guard(Object.entries(declared.environment).every(([key, value]) => actual[key] === value), 'CONTAINER_CONFIG_CHANGED')
    guard(peers.filter(peer => peer.Config?.Labels?.['com.docker.compose.project'] === input.state.project && peer.Config.Labels['com.docker.compose.service'] === service).length === 1, 'DUPLICATE_SERVICE_REJECTED')
    containers[service] = container
  }
  const native = containers['new-api'], studio = containers['studio-api'], nativeEnv = env(native)
  guard(native.Config.Entrypoint?.join(' ') === '/usr/local/bin/new-api' && !native.Config.Cmd?.length && ['', 'root', '0', '0:0'].includes(native.Config.User ?? '')
    && !nativeEnv.SQL_DSN && !nativeEnv.LOG_SQL_DSN && !nativeEnv.REDIS_CONN_STRING && nativeEnv.SESSION_SECRET === 'synthetic-acceptance-session-only'
    && nativeEnv.BATCH_UPDATE_ENABLED === 'false' && (!nativeEnv.CRYPTO_SECRET || nativeEnv.CRYPTO_SECRET === nativeEnv.SESSION_SECRET), 'NATIVE_CONFIG_REJECTED')
  guard(studio.Config.Entrypoint?.join(' ') === 'node /app/tests/stack/user-acceptance-environment-api.mjs' && ['node', '1000', '1000:1000'].includes(studio.Config.User), 'STUDIO_PROCESS_REJECTED')
  for (const expected of input.compose.services['studio-api'].volumes.filter(mount => mount?.type === 'bind' && mount.read_only)) {
    const matches = studio.Mounts?.filter(mount => mount.Destination === expected.target) ?? []
    guard(matches.length === 1 && readonlyBindMatches(matches[0], expected)
      && !studio.Mounts.some(mount => mount.Destination !== expected.target && overlapsProtectedPath(mount.Destination, expected.target)), 'CONTAINER_BIND_CHANGED')
  }
  const nativeVolume = dataVolume(native, input.state.project, 'native-data'), studioVolume = dataVolume(studio, input.state.project, 'studio-data')
  guard(nativeVolume !== studioVolume && !peers.some(peer => peer.State?.Running && peer.Mounts?.some(mount => mount.RW && [nativeVolume, studioVolume].includes(mount.Name))), 'OTHER_VOLUME_WRITER_REJECTED')
  guard(!peers.some(peer => peer.Id !== native.Id && peer.NetworkSettings?.Networks?.[input.state.project + '_default']?.Aliases?.includes('new-api')), 'NATIVE_ALIAS_REJECTED')
  return { native, studio, nativeVolume, studioVolume, seal: digest([native, studio].map(container => ({ id: container.Id, image: container.Image,
    state: container.State, env: envHash(container), mounts: container.Mounts, network: container.NetworkSettings?.Networks }))) }
}
async function peersOf(docker, input, nativeId, studioId) {
  const ids = (await docker(['ps', '-aq', '--no-trunc'])).split(/\s+/).filter(Boolean)
  guard(ids.every(id), 'DOCKER_INVENTORY_REJECTED')
  guard(ids.length > 0, 'CONTAINER_IDENTITY_REJECTED')
  // Other projects contribute only writer/alias metadata. Never retrieve their
  // environment, command, credentials or account data during global checks.
  const format = '{"Id":{{json .Id}},"State":{"Running":{{json .State.Running}}},"Mounts":{{json .Mounts}},"Config":{"Labels":{' +
    '"com.docker.compose.project":{{json (index .Config.Labels "com.docker.compose.project")}},' +
    '"com.docker.compose.service":{{json (index .Config.Labels "com.docker.compose.service")}}}},"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}}}}'
  const peers = (await docker(['inspect', '--type', 'container', '--format', format, ...ids])).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  for (const [service, expected] of [['new-api', nativeId], ['studio-api', studioId]]) {
    const metadata = peers.find(peer => peer.Id === expected)
    guard(metadata?.Config?.Labels?.['com.docker.compose.project'] === input.state.project && metadata.Config.Labels['com.docker.compose.service'] === service, 'CONTAINER_IDENTITY_REJECTED')
  }
  const owned = JSON.parse(await docker(['inspect', '--type', 'container', nativeId, studioId]))
  return peers.map(peer => owned.find(container => container.Id === peer.Id) ?? peer)
}
function proofOf(input, topology) {
  return { sourceCommit, binarySha256, instanceId: input.state.instanceId, nativeImage: topology.native.Image, studioImage: topology.studio.Image,
    ...input.artifacts, nativeConfigHash: envHash(topology.native), studioConfigHash: envHash(topology.studio) }
}
function bindingOf(input, topology) { return { project: input.state.project, nativeContainer: topology.native.Id, studioContainer: topology.studio.Id,
  nativeVolume: topology.nativeVolume, studioVolume: topology.studioVolume, coldSeal: topology.seal } }
async function copyColdPair(docker, topology, scratch, name) {
  const directory = join(scratch, name); await mkdir(directory); await mkdir(join(directory, 'native')); await mkdir(join(directory, 'studio'))
  await docker(['cp', topology.native.Id + ':/data/.', join(directory, 'native')])
  await docker(['cp', topology.studio.Id + ':/data/.', join(directory, 'studio')])
  return { nativePath: join(directory, 'native/new-api.db'), studioPath: join(directory, 'studio/requests.sqlite') }
}
async function binaryProof(docker, container, scratch, name, observeFile = fileProof) {
  const path = join(scratch, name); await docker(['cp', container.Id + ':/usr/local/bin/new-api', path])
  const proof = await observeFile(path); guard(proof.sha256 === binarySha256 && pinnedBinaryHashes.has(proof.sha256), 'ACTUAL_BINARY_PIN_REJECTED')
}
async function boundSourcesProof(docker, container, scratch, name, input) {
  for (const [suffix, source, expected] of [['api', '/app/apps/api/src/.', input.artifacts.apiSourceHash],
    ['policy', '/fixture-config/.', input.artifacts.policyHash]]) {
    const directory = join(scratch, name + '-' + suffix); await mkdir(directory)
    await docker(['cp', container.Id + ':' + source, directory])
    guard(await treeHash(directory) === expected, 'ACTUAL_BOUND_SOURCE_CHANGED')
  }
  const entrypoint = join(scratch, name + '-entrypoint.mjs')
  await docker(['cp', container.Id + ':/app/tests/stack/user-acceptance-environment-api.mjs', entrypoint])
  guard(digest(await fileProof(entrypoint)) === digest(await fileProof(join(input.rootWorkspace, 'tests/stack/user-acceptance-environment-api.mjs'))), 'ACTUAL_BOUND_SOURCE_CHANGED')
}
export async function operate(rawOptions, dependencies = {}) {
  const options = parseArguments([rawOptions.mode, ...Object.entries(rawOptions).filter(([key]) => key !== 'mode').flatMap(([key, value]) => value === true ? ['--' + key] : ['--' + key, value])])
  const rootWorkspace = dependencies.workspace ?? workspace, local = join(rootWorkspace, '.local')
  if (options.mode === 'verify') {
    const manifest = await verifyPair(confined(options.backup, local))
    return { ok: true, mode: 'verify', scope: manifest.scope, backupId: manifest.backupId, pairHash: manifest.pairHash, summary: manifest.summary, nativeOperations: 0, modelsCalled: 0 }
  }
  const input = await loadState(options.state, rootWorkspace), docker = dependencies.docker ?? dockerRunner(process.env.GOUO_NATIVE_TEST_DOCKER ?? 'docker')
  let topology = validateColdTopology(input, options['native-container'], options['studio-container'], await peersOf(docker, input, options['native-container'], options['studio-container']))
  const proof = proofOf(input, topology), binding = bindingOf(input, topology)
  let target, targetTopology, manifest, output
  if (options.mode === 'backup') output = confined(options.out, local, true)
  if (options.mode === 'restore-empty') {
    manifest = await verifyPair(confined(options.backup, local), proof)
    guard(digest(manifest.sourceBinding) === digest(binding), 'ORIGINAL_COLD_SOURCE_CHANGED')
    target = await loadState(options['target-state'], rootWorkspace)
    guard(target.state.project !== input.state.project && target.state.origin !== input.state.origin && target.state.directory !== input.state.directory, 'RESTORE_SOURCE_TARGET_REJECTED')
    targetTopology = validateColdTopology(target, options['target-native-container'], options['target-studio-container'], await peersOf(docker, target, options['target-native-container'], options['target-studio-container']))
    guard(targetTopology.nativeVolume !== topology.nativeVolume && targetTopology.studioVolume !== topology.studioVolume
      && digest(proofOf(target, targetTopology)) === digest(proof), 'TARGET_VERSION_CONFIG_SECRET_CHANGED')
  }
  const scratch = await mkdtemp(join(local, 'ops-backup-private-'))
  try {
    await binaryProof(docker, topology.native, scratch, 'source-binary', dependencies.binaryFileProof)
    if (targetTopology) await binaryProof(docker, targetTopology.native, scratch, 'target-binary', dependencies.binaryFileProof)
    await boundSourcesProof(docker, topology.studio, scratch, 'source-initial', input)
    if (targetTopology) await boundSourcesProof(docker, targetTopology.studio, scratch, 'target-initial', target)
    const pair = await copyColdPair(docker, topology, scratch, 'source'), summary = inspectPair({ ...pair, instanceId: input.state.instanceId })
    let verification = 0
    async function recheck() {
      const currentInput = await loadState(options.state, rootWorkspace), current = validateColdTopology(currentInput, options['native-container'], options['studio-container'], await peersOf(docker, currentInput, options['native-container'], options['studio-container']))
      guard(current.seal === topology.seal && digest(proofOf(currentInput, current)) === digest(proof), 'SOURCE_CHANGED_DURING_OPERATION')
      if (target) {
        const currentTarget = await loadState(options['target-state'], rootWorkspace), cold = validateColdTopology(currentTarget, options['target-native-container'], options['target-studio-container'], await peersOf(docker, currentTarget, options['target-native-container'], options['target-studio-container']))
        guard(cold.seal === targetTopology.seal && digest(proofOf(currentTarget, cold)) === digest(proof), 'TARGET_CHANGED_DURING_OPERATION')
      }
      verification++
      await boundSourcesProof(docker, topology.studio, scratch, 'source-verified-' + verification, currentInput)
      if (target) await boundSourcesProof(docker, targetTopology.studio, scratch, 'target-verified-' + verification, target)
    }
    await recheck()
    if (options.mode === 'inspect') return { ok: true, mode: 'inspect', scope: 'synthetic-private-only', proof, sourceBinding: binding, summary, servicesStarted: false, modelsCalled: 0 }
    if (options.mode === 'backup') {
      guard(!lstatSync(output, { throwIfNoEntry: false }), 'BACKUP_OUTPUT_EXISTS')
      await mkdir(output, { mode: 0o700 })
      const result = await createPairBackup({ ...pair, directory: output, proof, sourceBinding: binding }); await recheck()
      return { ok: true, mode: 'backup', backup: output, backupId: result.backupId, pairHash: result.pairHash, summary: result.summary, servicesStarted: false, modelsCalled: 0 }
    }
    guard(digest(summary) === digest(manifest.summary), 'ORIGINAL_DATABASE_PAIR_CHANGED')
    const receiptPath = join(target.state.directory, 'restore-ready-' + manifest.backupId + '.json')
    guard(!lstatSync(receiptPath, { throwIfNoEntry: false }), 'RESTORE_RECEIPT_EXISTS')
    const helper = join(rootWorkspace, 'scripts/lib/backup-helper.mjs'); safePath(helper)
    const result = JSON.parse(await docker(['run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
      '--mount', 'type=bind,source=' + confined(options.backup, local) + ',target=/backup,readonly',
      '--mount', 'type=bind,source=' + helper + ',target=/ops/backup-helper.mjs,readonly',
      '--mount', 'type=volume,source=' + targetTopology.nativeVolume + ',target=/native-target',
      '--mount', 'type=volume,source=' + targetTopology.studioVolume + ',target=/studio-target',
      '--entrypoint', 'node', targetTopology.studio.Image, '/ops/backup-helper.mjs', 'restore', JSON.stringify({ backupDirectory: '/backup',
        nativeTarget: '/native-target', studioTarget: '/studio-target', expectedProof: proof, studioUid: 1000 })]))
    guard(result.ok === true && result.bothDatabasesVerified === true && result.pairHash === manifest.pairHash && result.instanceId === proof.instanceId
      && result.logicalHash === digest(manifest.summary) && result.servicesStarted === false && result.modelsCalled === 0, 'RESTORE_HELPER_REJECTED')
    await recheck()
    const receipt = { ...result, sourceBinding: binding, targetProject: target.state.project, targetNativeContainer: targetTopology.native.Id,
      targetStudioContainer: targetTopology.studio.Id, scope: 'synthetic-private-only', operatorMayStartVerifiedPair: true, createdAt: new Date().toISOString() }
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 })
    return { ...receipt, mode: 'restore-empty', receipt: receiptPath }
  } finally { confined(scratch, local); await rm(scratch, { recursive: true, force: true }) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await operate(parseArguments(process.argv.slice(2))))) }
  catch (error) { console.error(JSON.stringify({ ok: false, code: error instanceof BackupError ? error.message : 'BACKUP_OPERATION_FAILED', rawErrorExcluded: true,
    servicesStarted: false, modelsCalled: 0, note: 'Retain a partial new backup/target after failure; never overwrite original volumes or start a partial pair' })); process.exitCode = 1 }
}
