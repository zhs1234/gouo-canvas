// F only: real temporary SQLite/BLOBs and explicitly injected Docker inventory,
// copies and binary observation. No real Docker, Native, browser, HTTP or model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { Ledger } from '../apps/api/src/ledger.mjs'
import { Trial } from '../apps/api/src/trial.mjs'
import { History } from '../apps/api/src/history.mjs'
import { Projects } from '../apps/api/src/projects.mjs'
import { FundingState } from '../apps/api/src/funding-state.mjs'
import { RelayRenewals } from '../apps/api/src/relay-renewals.mjs'
import { ImageJobs } from '../apps/api/src/image-jobs.mjs'
import { parseArguments, loadState, validateColdTopology, operate, confined } from '../scripts/backup-restore.mjs'
import { sourceCommit, binarySha256, digest, fileProof, inspectPair, createPairBackup, verifyPair, restorePair } from '../scripts/lib/backup-helper.mjs'

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'gouo-ops-f-')); t.after(() => rm(path, { recursive: true, force: true })); return path
}
async function databases(t) {
  const path = await directory(t), nativePath = join(path, 'new-api.db'), studioPath = join(path, 'requests.sqlite'), instanceId = randomUUID()
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#56738e' } }).png().toBuffer(), pngHash = digest(png)
  const native = new DatabaseSync(nativePath)
  native.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,password TEXT);
    CREATE TABLE channels(id INTEGER PRIMARY KEY,type INTEGER,status INTEGER,base_url TEXT,key TEXT);
    CREATE TABLE tokens(id INTEGER PRIMARY KEY,user_id INTEGER,key TEXT);
    CREATE TABLE user_subscriptions(id INTEGER PRIMARY KEY,user_id INTEGER,amount_used INTEGER);
    CREATE TABLE subscription_pre_consume_records(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT);
    CREATE TABLE logs(id INTEGER PRIMARY KEY,user_id INTEGER,request_id TEXT,quota INTEGER);
    CREATE TABLE options(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO users VALUES(1,'fixture-root','private_password_hash'),(2,'synthetic-owner-a','private_password_hash'),(3,'synthetic-owner-b','private_password_hash');
    INSERT INTO channels VALUES(1,1,1,'http://fixture-provider:19000','fixture-provider-zero-procurement-cost');
    INSERT INTO tokens VALUES(1,2,'private_synthetic_token_key'),(2,3,'private_synthetic_token_key_b'); INSERT INTO user_subscriptions VALUES(1,2,17);
    INSERT INTO subscription_pre_consume_records VALUES(1,2,'consumed'); INSERT INTO logs VALUES(1,2,'original-native-id',17);`)
  native.close()
  // Business constructors create fixture schema ONCE, before data exists. The
  // backup code imports none of them and must never perform restart recovery.
  const ledger = new Ledger(studioPath), db = ledger.db; t.after(() => { try { ledger.close() } catch {} })
  new Trial(db, undefined, instanceId); new FundingState(db); new RelayRenewals(db); new ImageJobs(ledger)
  const history = new History(db), projects = new Projects(db, history), runId = randomUUID(), unknownRun = randomUUID(), job = randomUUID()
  const thread = history.create(2, 'Synthetic fixture A'), otherThread = history.create(3, 'Synthetic fixture B'), assetId = randomUUID(), now = new Date().toISOString()
  const events = [{ type: 'run.started', runId }, { type: 'tool.completed', runId, toolCallId: 'original-tool', artifacts: [{ type: 'image', url: 'data:image/png;base64,' + png.toString('base64') }] },
    { type: 'message.delta', runId, delta: 'private_original_partial' }, { type: 'run.failed', runId, error: { code: 'gateway_failed', message: '模型响应缺少可信完成标记，结果和费用待确认；未自动重试，请检查网关记录。' } }]
  const insertRun = db.prepare('INSERT INTO studio_runs VALUES(?,?,?,?,?,?,?,?,?,?)')
  insertRun.run(2, runId, thread.id, 'private_synthetic_prompt', 'fixture-chat', 'failed', JSON.stringify(events), null, now, now)
  insertRun.run(3, unknownRun, otherThread.id, 'private_synthetic_prompt', 'fixture-chat', 'unknown', '[]', null, now, now)
  db.prepare('INSERT INTO studio_run_events(owner,run_id,event) VALUES(?,?,?)').run(3, unknownRun, JSON.stringify({ type: 'message.delta', delta: 'private_unknown_partial' }))
  db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?)').run(2, 'agent', runId, 'hash', 'completed', JSON.stringify({ events }), now)
  for (const [key, kind] of [[unknownRun, 'agent'], [job, 'image']]) db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?)').run(3, kind, key, 'hash', 'unknown', null, now)
  db.prepare('INSERT INTO trial_grants VALUES(?,?,?,?,?)').run(2, 1, 1, 'active', now)
  db.prepare('INSERT INTO trial_grants VALUES(?,?,?,?,?)').run(3, 1, null, 'unknown', now)
  for (const benefit of ['chat', 'image']) db.prepare('INSERT INTO trial_reservations VALUES(?,?,?,?,?)').run(2, 'agent', runId, benefit, 'unknown')
  db.prepare('INSERT INTO funding_writes VALUES(?,?,?,?)').run(3, 'subscription_only', 'unknown', now)
  db.prepare('INSERT INTO relay_renewals(owner,key,hash,old_id,target,status) VALUES(?,?,?,?,?,?)').run(3, 'original-renewal', 'hash', 2, '{}', 'unknown')
  db.prepare('INSERT INTO relay_bindings VALUES(?,?,?)').run(2, 1, 'synthetic-token')
  db.prepare('INSERT INTO image_jobs(owner,key,payload,hash,approval_hash,model_id,funding_source,status,native_pending,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(3, job, '{}', 'hash', 'approval', 'fixture-image', 'trial', 'unknown', 1, now, now)
  db.prepare('INSERT INTO image_job_reservations VALUES(?,?,?)').run(3, job, 'unknown')
  db.prepare('INSERT INTO image_job_outbox VALUES(?,?,?)').run(3, job, 'deferred')
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='image_job_staging'").get()) db.prepare('INSERT INTO image_job_staging VALUES(?,?,?,?,?)').run(3, job, png, pngHash, now)
  db.prepare('INSERT INTO studio_assets VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(assetId, 2, runId, 'original-tool', 0, 'image/png', 2, 3, png, pngHash, now)
  const project = projects.create(2, 'Private synthetic title', assetId)
  await projects.patch(2, project.id, { expectedRevision: 1, document: { elements: [{ id: 'image', type: 'image', fileId: 'file' }], appState: {},
    files: { file: { id: 'file', assetId, dataURL: 'data:image/png;base64,' + png.toString('base64') } } } })
  ledger.close()
  const proof = { instanceId, sourceCommit, binarySha256, nativeImage: 'sha256:' + 'a'.repeat(64), studioImage: 'sha256:' + 'b'.repeat(64),
    apiSourceHash: 'c'.repeat(64), fixtureSourceHash: 'd'.repeat(64), policyHash: 'e'.repeat(64), nativeConfigHash: 'f'.repeat(64), studioConfigHash: '1'.repeat(64) }
  return { path, nativePath, studioPath, instanceId, pngHash, proof, runId, unknownRun, job, assetId, projectId: project.id }
}
async function backupFixture(t) {
  const f = await databases(t), backupDirectory = join(f.path, 'backup'); await mkdir(backupDirectory)
  const manifest = await createPairBackup({ ...f, directory: backupDirectory, proof: f.proof })
  return { ...f, backupDirectory, manifest }
}
test('real SQLite paired backup/restoration preserves original PNG, revision, unknown held state and all native data without constructors', async t => {
  const f = await backupFixture(t), before = inspectPair(f), nativeTarget = join(f.path, 'restore-native'), studioTarget = join(f.path, 'restore-studio')
  await mkdir(nativeTarget); await mkdir(studioTarget)
  const result = await restorePair({ backupDirectory: f.backupDirectory, nativeTarget, studioTarget, expectedProof: f.proof })
  assert.equal(result.bothDatabasesVerified, true); assert.equal(result.modelsCalled, 0); assert.equal(result.servicesStarted, false)
  assert.deepEqual(inspectPair({ nativePath: join(nativeTarget, 'new-api.db'), studioPath: join(studioTarget, 'requests.sqlite'), instanceId: f.instanceId }), before)
  assert.equal(before.assets[0].sha256, f.pngHash); assert.equal(before.projects[0].revision, 2)
  assert.deepEqual(before.held.map(row => [row.owner, row.benefit, row.status, row.count]), [[2, 'chat', 'unknown', 1], [2, 'image', 'unknown', 1]])
  const db = new DatabaseSync(join(studioTarget, 'requests.sqlite'), { readOnly: true })
  assert.equal(db.prepare('SELECT status FROM requests WHERE key=?').get(f.unknownRun).status, 'unknown')
  assert.equal(db.prepare('SELECT status FROM funding_writes WHERE owner=3').get().status, 'unknown')
  assert.equal(db.prepare('SELECT status FROM relay_renewals WHERE owner=3').get().status, 'unknown')
  assert.equal(db.prepare('SELECT native_pending FROM image_jobs WHERE key=?').get(f.job).native_pending, 1); db.close()
  const metadata = JSON.stringify(f.manifest)
  for (const secret of ['private_password_hash', 'private_synthetic_token_key', 'private_synthetic_prompt', 'private_original_partial', 'Private synthetic title', 'data:image/png']) assert.equal(metadata.includes(secret), false)
  assert.deepEqual(await verifyPair(f.backupDirectory, f.proof), f.manifest)
})
test('SQLite backup includes uncheckpointed source WAL without altering source main/WAL files', async t => {
  const f = await databases(t), writer = new DatabaseSync(f.nativePath)
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO options VALUES('synthetic-uncheckpointed','original_value')")
    const original = [await fileProof(f.nativePath), await fileProof(f.nativePath + '-wal')], out = join(f.path, 'wal-backup'); await mkdir(out)
    const manifest = await createPairBackup({ ...f, directory: out, proof: f.proof })
    assert.deepEqual([await fileProof(f.nativePath), await fileProof(f.nativePath + '-wal')], original)
    assert.equal(manifest.summary.native.tables.find(row => row.table === 'options').rows, 1)
    assert.deepEqual((await readdir(out)).sort(), ['manifest.json', 'native.sqlite', 'studio.sqlite'])
  } finally { writer.close() }
})
test('pin/config/key/instance mismatch, corruption and mixed pairs never write a restore target', async t => {
  const f = await backupFixture(t), a = join(f.path, 'empty-a'), b = join(f.path, 'empty-b'); await mkdir(a); await mkdir(b)
  for (const [key, value] of [['binarySha256', '0'.repeat(64)], ['instanceId', randomUUID()], ['nativeImage', 'sha256:' + '0'.repeat(64)], ['nativeConfigHash', '0'.repeat(64)], ['apiSourceHash', '0'.repeat(64)]]) {
    await assert.rejects(restorePair({ backupDirectory: f.backupDirectory, nativeTarget: a, studioTarget: b, expectedProof: { ...f.proof, [key]: value } }))
    assert.deepEqual(await readdir(a), []); assert.deepEqual(await readdir(b), [])
  }
  const other = await backupFixture(t); await cp(join(other.backupDirectory, 'studio.sqlite'), join(f.backupDirectory, 'studio.sqlite'))
  await assert.rejects(verifyPair(f.backupDirectory), /HASH_REJECTED/)
  await writeFile(join(f.backupDirectory, 'native.sqlite'), 'truncated private bytes'); await assert.rejects(verifyPair(f.backupDirectory), /HASH_REJECTED/)
})
test('restore never overwrites nonempty targets or an existing backup', async t => {
  const f = await backupFixture(t), a = join(f.path, 'nonempty'), b = join(f.path, 'empty'); await mkdir(a); await mkdir(b)
  await writeFile(join(a, 'keep'), 'original'); await assert.rejects(restorePair({ backupDirectory: f.backupDirectory, nativeTarget: a, studioTarget: b }), /NOT_EMPTY/)
  assert.equal(await readFile(join(a, 'keep'), 'utf8'), 'original'); assert.deepEqual(await readdir(b), [])
  await assert.rejects(createPairBackup({ ...f, directory: f.backupDirectory, proof: f.proof }), /NOT_EMPTY/)
})
for (const [table, key, status] of [['requests', 'key', 'running'], ['studio_runs', 'run_id', 'running'], ['trial_grants', 'owner', 'claiming'],
  ['trial_reservations', 'key', 'reserved'], ['funding_writes', 'owner', 'pending'], ['relay_renewals', 'owner', 'pending'],
  ...['accepted', 'ready', 'submission_started', 'submitted', 'output_received', 'output_saved'].map(status => ['image_jobs', 'key', status])]) {
  test(`cold database refuses active ${table}/${status} without changing it`, async t => {
    const f = await databases(t), db = new DatabaseSync(f.studioPath), value = key === 'owner' ? (table === 'trial_grants' ? 2 : 3) : table === 'image_jobs' ? f.job : f.runId
    db.prepare('UPDATE ' + table + ' SET status=? WHERE ' + key + '=?').run(status, value)
    if (table === 'studio_runs') db.prepare('DELETE FROM studio_assets').run()
    db.close(); assert.throws(() => inspectPair(f), /ACTIVE_OPERATION/)
    const unchanged = new DatabaseSync(f.studioPath, { readOnly: true }); assert.equal(unchanged.prepare('SELECT status FROM ' + table + ' WHERE ' + key + '=?').get(value).status, status); unchanged.close()
  })
}
test('foreign Native owner, cross-owner project/image/run and altered BLOB are rejected', async t => {
  for (const [sql, code] of [["UPDATE studio_threads SET owner=999", 'FOREIGN_NATIVE_OWNER'], ["UPDATE studio_runs SET thread_id='foreign'", 'FOREIGN_THREAD'],
    ["UPDATE studio_projects SET owner=3", 'FOREIGN_PROJECT_ASSET'], ["UPDATE studio_assets SET owner=3", 'FOREIGN_ASSET_RUN'],
    ["UPDATE studio_assets SET bytes=x'00'", 'PRIVATE_BLOB_HASH']]) {
    const f = await databases(t), db = new DatabaseSync(f.studioPath); db.exec(sql); db.close(); assert.throws(() => inspectPair(f), new RegExp(code))
  }
})
async function harness(t) {
  const data = await databases(t), root = await directory(t), local = join(root, '.local'); await mkdir(local)
  await mkdir(join(root, 'apps/api/src'), { recursive: true }); await writeFile(join(root, 'apps/api/src/fixture.mjs'), '// F code fingerprint only\n')
  await mkdir(join(root, 'tests/stack'), { recursive: true }); await mkdir(join(root, 'scripts/lib'), { recursive: true })
  for (const name of ['user-acceptance-environment-api.mjs', 'user-acceptance-environment-provider.mjs']) await writeFile(join(root, 'tests/stack', name), '// F code fingerprint only\n')
  await writeFile(join(root, 'scripts/lib/backup-helper.mjs'), '// F mount identity only; injected runner uses real host helper\n')
  const peers = [], nativeId = '1'.repeat(64), studioId = '2'.repeat(64), targetNativeId = '3'.repeat(64), targetStudioId = '4'.repeat(64)
  async function stateFixture(label, nativeContainerId, studioContainerId, port) {
    const directory = join(local, 'user-acceptance-' + label); await mkdir(directory); await mkdir(join(directory, 'config')); await mkdir(join(directory, 'control'))
    const state = { version: 1, project: 'gouo-user-acceptance-123-' + label, directory, compose: join(directory, 'compose.json'), env: join(directory, 'empty.env'), origin: 'http://127.0.0.1:' + port,
      sourceCommit, binarySha256, instanceId: data.instanceId, procurementCost: 0, provider: 'explicit local acceptance fixture', syntheticComplianceFixture: true }
    const nativeEnvironment = { SQLITE_PATH: '/data/new-api.db', SESSION_SECRET: 'synthetic-acceptance-session-only', BATCH_UPDATE_ENABLED: 'false' }
    const studioEnvironment = { GOUO_BACKEND_DEV_TARGET: 'http://new-api:3000', GOUO_GATEWAY_BASE_URL: 'http://new-api:3000/v1', GOUO_ACCOUNT_INSTANCE_ID: data.instanceId,
      GOUO_STUDIO_LEDGER_PATH: '/data/requests.sqlite', GOUO_RELAY_CREDENTIAL_MODE: 'user-token', GOUO_STUDIO_MODELS_FILE: '/fixture-config/models.json',
      GOUO_NORMAL_ROUTING_EVIDENCE_FILE: '/fixture-config/routing.json', GOUO_TRIAL_POLICY_FILE: '/fixture-config/trial.json', GOUO_TOKEN_RENEWAL_POLICY_FILE: '/fixture-config/renewal.json' }
    const binds = [[join(root, 'apps/api/src'), '/app/apps/api/src'], [join(directory, 'config'), '/fixture-config'], [join(root, 'tests/stack/user-acceptance-environment-api.mjs'), '/app/tests/stack/user-acceptance-environment-api.mjs']]
      .map(([source, target]) => ({ type: 'bind', source, target, read_only: true }))
    const compose = { services: { 'new-api': { image: 'gouo-v2-new-api:latest', environment: nativeEnvironment }, 'studio-api': { image: 'gouo-v2-studio-api:latest', environment: studioEnvironment, volumes: binds },
      'fixture-provider': { entrypoint: ['node', '/app/tests/stack/user-acceptance-environment-provider.mjs'] } }, volumes: { 'native-data': {}, 'studio-data': {} } }
    for (const [name, content] of [['trial.json', { instanceId: data.instanceId, sourceCommit, plan: { price_amount: 0 } }], ['renewal.json', { instanceId: data.instanceId, sourceCommit, redisEnabled: false, batchUpdateEnabled: false }],
      ['routing.json', { sourceCommit, gatewayOrigin: 'http://new-api:3000', retryTimes: 0 }], ['models.json', { fixtureOnly: true }]]) await writeFile(join(directory, 'config', name), JSON.stringify(content))
    const statePath = join(directory, 'state.json'), save = async () => { await writeFile(statePath, JSON.stringify(state)); await writeFile(state.compose, JSON.stringify(compose)); await writeFile(state.env, '') }
    await save()
    const volumeDirectories = []
    for (const [service, containerId, volume] of [['new-api', nativeContainerId, 'native-data'], ['studio-api', studioContainerId, 'studio-data']]) {
      const volumeDirectory = join(directory, volume); await mkdir(volumeDirectory); volumeDirectories.push(volumeDirectory)
      peers.push({ Id: containerId, Image: service === 'new-api' ? data.proof.nativeImage : data.proof.studioImage,
        State: { Status: 'created', Running: false, Pid: 0, StartedAt: 'never', FinishedAt: 'never' }, HostConfig: { PortBindings: {}, Init: false },
        Config: { Image: compose.services[service].image, Labels: { 'com.docker.compose.project': state.project, 'com.docker.compose.service': service },
          Env: Object.entries(compose.services[service].environment).map(([key, value]) => key + '=' + value), Entrypoint: service === 'new-api' ? ['/usr/local/bin/new-api'] : ['node', '/app/tests/stack/user-acceptance-environment-api.mjs'], Cmd: [], User: service === 'new-api' ? '' : 'node' },
        Mounts: [{ Type: 'volume', Name: state.project + '_' + volume, Destination: '/data', RW: true }, ...(service === 'studio-api' ? binds.map(bind => ({ Type: 'bind', Source: bind.source, Destination: bind.target, RW: false })) : [])],
        NetworkSettings: { Networks: { [state.project + '_default']: { Aliases: [service] } } }, fVolumeDirectory: volumeDirectory })
    }
    return { state, statePath, compose, save, nativeDirectory: volumeDirectories[0], studioDirectory: volumeDirectories[1] }
  }
  const source = await stateFixture('source', nativeId, studioId, 45678), target = await stateFixture('target', targetNativeId, targetStudioId, 45679)
  await cp(data.nativePath, join(source.nativeDirectory, 'new-api.db')); await cp(data.studioPath, join(source.studioDirectory, 'requests.sqlite'))
  const calls = []
  const docker = async args => {
    calls.push(args)
    if (args[0] === 'ps') return peers.map(peer => peer.Id).join('\n')
    if (args[0] === 'inspect') {
      if (args.includes('--format')) return peers.map(peer => JSON.stringify({ Id: peer.Id, State: { Running: peer.State?.Running }, Mounts: peer.Mounts,
        Config: { Labels: { 'com.docker.compose.project': peer.Config?.Labels?.['com.docker.compose.project'], 'com.docker.compose.service': peer.Config?.Labels?.['com.docker.compose.service'] } }, NetworkSettings: peer.NetworkSettings })).join('\n')
      return JSON.stringify(peers.filter(peer => args.includes(peer.Id)))
    }
    if (args[0] === 'cp') {
      const [containerId, path] = args[1].split(':'), peer = peers.find(peer => peer.Id === containerId)
      if (path === '/usr/local/bin/new-api') await writeFile(args[2], 'F mock binary observer; no actual Native binary claim')
      else { assert.equal(path, '/data/.'); await cp(peer.fVolumeDirectory, args[2], { recursive: true }) }
      return ''
    }
    if (args[0] === 'run') {
      assert.ok(args.includes('--network') && args[args.indexOf('--network') + 1] === 'none'); assert.ok(args.includes('--read-only'))
      const request = JSON.parse(args.at(-1)), result = await restorePair({ backupDirectory: join(local, 'paired-backup'), nativeTarget: target.nativeDirectory,
        studioTarget: target.studioDirectory, expectedProof: request.expectedProof })
      return JSON.stringify({ ok: true, ...result })
    }
    throw Error('F Docker fixture refuses any service, network or account operation')
  }
  const deps = { workspace: root, docker, binaryFileProof: async () => ({ sha256: binarySha256 }) }
  const options = { mode: 'backup', state: source.statePath, 'native-container': nativeId, 'studio-container': studioId, out: join(local, 'paired-backup'), 'confirm-synthetic-private': true }
  return { data, root, local, source, target, peers, calls, deps, options, nativeId, studioId, targetNativeId, targetStudioId }
}
test('F Docker orchestration only copies cold source and restores a distinct empty pair; operator starts nothing', async t => {
  const h = await harness(t), backup = await operate(h.options, h.deps)
  assert.equal(backup.ok, true); assert.equal(backup.servicesStarted, false); assert.equal(backup.modelsCalled, 0)
  const receipt = await operate({ mode: 'restore-empty', state: h.source.statePath, 'native-container': h.nativeId, 'studio-container': h.studioId,
    backup: h.options.out, 'target-state': h.target.statePath, 'target-native-container': h.targetNativeId, 'target-studio-container': h.targetStudioId, 'confirm-synthetic-private': true }, h.deps)
  assert.equal(receipt.operatorMayStartVerifiedPair, true); assert.equal(receipt.bothDatabasesVerified, true)
  assert.ok(h.calls.every(args => ['ps', 'inspect', 'cp', 'run'].includes(args[0])))
  assert.equal(h.calls.filter(args => args[0] === 'run').length, 1)
  assert.deepEqual(inspectPair({ nativePath: join(h.target.nativeDirectory, 'new-api.db'), studioPath: join(h.target.studioDirectory, 'requests.sqlite'), instanceId: h.data.instanceId }), backup.summary)
  const verifyCalls = h.calls.length; assert.equal((await operate({ mode: 'verify', backup: h.options.out, 'confirm-synthetic-private': true }, h.deps)).nativeOperations, 0)
  assert.equal(h.calls.length, verifyCalls)
})
test('full IDs, cold processes, unique volumes, private network and no other RW writers are mandatory before copies', async t => {
  const h = await harness(t), input = await loadState(h.source.statePath, h.root)
  const mutations = [
    peers => { peers[0].State.Running = true; peers[0].State.Pid = 42 }, peers => { peers[1].State.Status = 'running' },
    peers => { peers[0].Config.Labels['com.docker.compose.project'] = 'daily' }, peers => { peers[1].Mounts[0].Name = peers[0].Mounts[0].Name },
    peers => { peers[0].HostConfig.PortBindings = { '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '3000' }] } },
    peers => { peers[0].NetworkSettings.Networks = { public: { Aliases: ['new-api'] } } },
    peers => { peers[0].Config.Env.push('SQL_DSN=external') }, peers => { peers[0].Config.Env.push('SESSION_SECRET=real_secret') },
    peers => { peers.push({ Id: '5'.repeat(64), State: { Running: true }, Mounts: [{ Name: peers[1].Mounts[0].Name, RW: true }] }) },
    peers => { peers.push(structuredClone(peers[0])) },
  ]
  for (const mutate of mutations) { const peers = structuredClone(h.peers); mutate(peers); assert.throws(() => validateColdTopology(input, h.nativeId, h.studioId, peers)) }
  assert.throws(() => validateColdTopology(input, '1'.repeat(12), h.studioId, h.peers), /FULL_CONTAINER/)
  h.peers[0].State.Running = true; await assert.rejects(operate(h.options, h.deps), /COLD_STOP/)
  assert.equal(h.calls.some(args => ['cp', 'run'].includes(args[0])), false)
})
test('synthetic state, origin, pin, instance, config source paths and operator env are checked without Docker', async t => {
  const h = await harness(t), original = structuredClone(h.source.state)
  for (const mutate of [state => { state.origin = 'http://127.0.0.1:8080' }, state => { state.binarySha256 = '0'.repeat(64) }, state => { state.provider = 'real-provider' },
    state => { state.directory = h.target.state.directory }, state => { state.instanceId = randomUUID() }]) {
    Object.assign(h.source.state, original); mutate(h.source.state); await h.source.save(); await assert.rejects(operate(h.options, h.deps)); assert.equal(h.calls.length, 0)
  }
  Object.assign(h.source.state, original); await h.source.save(); await writeFile(h.source.state.env, 'PRIVATE_REAL_KEY=forbidden')
  await assert.rejects(operate(h.options, h.deps), /OPERATOR_ENV/); assert.equal(h.calls.length, 0)
  assert.throws(() => parseArguments(['backup', '--confirm-synthetic-private']), /ARGUMENT/)
  assert.throws(() => parseArguments(['verify', '--backup', h.options.out]), /CONFIRMATION/)
  assert.throws(() => confined(h.data.nativePath, h.local), /OUTSIDE_LOCAL/)
})
test('actual observed binary pin failure precedes database copies, and symlink inputs/outputs are rejected', async t => {
  const h = await harness(t)
  await assert.rejects(operate(h.options, { ...h.deps, binaryFileProof: async () => ({ sha256: '0'.repeat(64) }) }), /ACTUAL_BINARY_PIN/)
  assert.equal(h.calls.some(args => args[0] === 'cp' && args[1].endsWith(':/data/.')), false)
  const link = join(h.local, 'symlink-source')
  // Directory junctions work without Windows developer-mode symlink privileges.
  await symlink(h.source.state.directory, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(loadState(join(link, 'state.json'), h.root), /SYMLINK/)
  assert.throws(() => confined(join(link, 'new-output'), h.local, true), /SYMLINK/)
})
test('source restart during cold copies prevents publishing a backup or starting any service', async t => {
  const h = await harness(t), originalDocker = h.deps.docker
  const docker = async args => {
    const result = await originalDocker(args)
    if (args[0] === 'cp' && args[1] === h.studioId + ':/data/.') h.peers[0].State.StartedAt = 'F unexpected restart boundary'
    return result
  }
  await assert.rejects(operate(h.options, { ...h.deps, docker }), /SOURCE_CHANGED_DURING/)
  await assert.rejects(readdir(h.options.out), { code: 'ENOENT' })
  assert.equal(h.calls.some(args => args[0] === 'run'), false)
})
test('restore requires the original stopped source and unchanged pair, policy and target proof before any target writes', async t => {
  const h = await harness(t); await operate(h.options, h.deps)
  const restore = { mode: 'restore-empty', state: h.source.statePath, 'native-container': h.nativeId, 'studio-container': h.studioId, backup: h.options.out,
    'target-state': h.target.statePath, 'target-native-container': h.targetNativeId, 'target-studio-container': h.targetStudioId, 'confirm-synthetic-private': true }
  h.peers[0].State.Running = true; await assert.rejects(operate(restore, h.deps), /COLD_STOP/); h.peers[0].State.Running = false
  const image = h.peers[2].Image; h.peers[2].Image = 'sha256:' + '0'.repeat(64)
  await assert.rejects(operate(restore, h.deps), /TARGET_VERSION_CONFIG_SECRET/); h.peers[2].Image = image
  const policyPath = join(h.target.state.directory, 'config/models.json'), original = await readFile(policyPath)
  await writeFile(policyPath, '{"fixtureOnly":true,"changed":true}'); await assert.rejects(operate(restore, h.deps), /TARGET_VERSION_CONFIG_SECRET/); await writeFile(policyPath, original)
  const native = new DatabaseSync(join(h.source.nativeDirectory, 'new-api.db')); native.exec("INSERT INTO options VALUES('offline-source-change','do_not_restore_stale_pair')"); native.close()
  await assert.rejects(operate(restore, h.deps), /ORIGINAL_DATABASE_PAIR_CHANGED/)
  assert.equal(h.calls.some(args => args[0] === 'run'), false)
  assert.deepEqual(await readdir(h.target.nativeDirectory), []); assert.deepEqual(await readdir(h.target.studioDirectory), [])
})
test('policy file escape, changed actual source bind and foreign Native subscription/token links are rejected', async t => {
  const h = await harness(t)
  h.source.compose.services['studio-api'].environment.GOUO_STUDIO_MODELS_FILE = '/private/operator-models.json'; await h.source.save()
  await assert.rejects(operate(h.options, h.deps), /POLICY_PATH/); assert.equal(h.calls.length, 0)
  h.source.compose.services['studio-api'].environment.GOUO_STUDIO_MODELS_FILE = '/fixture-config/models.json'; await h.source.save()
  const input = await loadState(h.source.statePath, h.root), peers = structuredClone(h.peers)
  peers[1].Mounts.find(mount => mount.Destination === '/app/apps/api/src').Source = h.data.path
  assert.throws(() => validateColdTopology(input, h.nativeId, h.studioId, peers), /BIND_CHANGED/)
  for (const [sql, code] of [['UPDATE user_subscriptions SET user_id=3 WHERE id=1', 'FOREIGN_SUBSCRIPTION'], ['UPDATE tokens SET user_id=3 WHERE id=1', 'FOREIGN_TOKEN_BINDING']]) {
    const f = await databases(t), native = new DatabaseSync(f.nativePath); native.exec(sql); native.close(); assert.throws(() => inspectPair(f), new RegExp(code))
  }
})
test('global Docker writer inventory never reads unrelated environments or full-inspects a mismatched daily identity', async t => {
  const h = await harness(t), dailyId = '9'.repeat(64)
  h.peers.push({ Id: dailyId, State: { Running: true }, Config: { Labels: { 'com.docker.compose.project': 'daily', 'com.docker.compose.service': 'new-api' }, Env: ['PRIVATE_REAL_KEY=must_not_read'] },
    Mounts: [{ Name: 'daily_native', RW: true, Destination: '/data' }], NetworkSettings: { Networks: { daily_default: { Aliases: ['new-api'] } } } })
  const { out, ...inspectOptions } = h.options
  await operate({ ...inspectOptions, mode: 'inspect' }, h.deps)
  assert.ok(h.calls.filter(args => args[0] === 'inspect' && !args.includes('--format')).every(args => !args.includes(dailyId)))
  h.calls.length = 0
  await assert.rejects(operate({ mode: 'inspect', state: h.source.statePath, 'native-container': dailyId, 'studio-container': h.studioId, 'confirm-synthetic-private': true }, h.deps), /CONTAINER_IDENTITY/)
  assert.equal(h.calls.some(args => args[0] === 'inspect' && !args.includes('--format')), false)
})
