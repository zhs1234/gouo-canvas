// Opt-in isolated real Docker/SQLite/process-restart verification. No native
// accounts, JWTs, channels or model calls. Studio ledger rows are explicit fixtures.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { operate, dockerRunner } from '../../scripts/reconcile-funding.mjs'

const docker = process.env.GOUO_RECOVERY_TEST_DOCKER ?? 'docker'
const directory = await mkdtemp(join(tmpdir(), 'gouo-recovery-native-'))
const project = 'gouo-recovery-test-' + process.pid + '-' + Date.now().toString(36)
const file = join(directory, 'compose.yml'), emptyEnv = join(directory, 'empty.env')
const source = fileURLToPath(new URL('../../apps/api/src', import.meta.url)).replaceAll('\\', '/')
const helperSource = fileURLToPath(new URL('../../scripts/lib/recovery-helper.mjs', import.meta.url))
const cli = fileURLToPath(new URL('../../scripts/reconcile-funding.mjs', import.meta.url))
const instance = '11111111-2222-4333-8444-555555555555', owner = 7
const key = 'fixture-recovery-run', payload = { prompt: 'explicit-recovery-fixture' }
const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
await writeFile(emptyEnv, '')
await writeFile(file, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
    volumes: [native-data:/data]
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 1s
      retries: 60
  studio-api:
    image: gouo-v2-studio-api:latest
    environment:
      GOUO_STUDIO_HOST: 0.0.0.0
      GOUO_BACKEND_DEV_TARGET: http://new-api:3000
      GOUO_GATEWAY_BASE_URL: http://new-api:3000/v1
      GOUO_STUDIO_LEDGER_PATH: /data/requests.sqlite
      GOUO_ENABLE_GENERATION: 'false'
      GOUO_ACCOUNT_INSTANCE_ID: ${instance}
    volumes:
      - studio-data:/data
      - type: bind
        source: ${JSON.stringify(source)}
        target: /app/apps/api/src
        read_only: true
    depends_on:
      new-api: {condition: service_healthy}
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3001/api/studio/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 1s
      retries: 60
volumes:
  native-data:
  studio-data:
`)
function run(binary, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', code => resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.stdin.end(input)
  })
}
async function command(binary, args, input) {
  const result = await run(binary, args, input)
  if (result.code !== 0) throw new Error(result.stderr + '\n' + result.stdout)
  return result.stdout
}
const compose = (...args) => command(docker, ['compose', '--env-file', emptyEnv, '-p', project, '-f', file, ...args])
const inspect = async id => JSON.parse(await command(docker, ['inspect', '--type', 'container', id]))[0]
let studioId, nativeId, studioVolume, studioImage
const baseArguments = () => ['--project', project, '--studio-container', studioId, '--native-container', nativeId,
  '--instance', instance, '--owner', String(owner), '--docker', docker]
const cliCommand = (...args) => run(process.execPath, [cli, ...args])
async function data(code) {
  return command(docker, ['run', '--rm', '--network', 'none', '--entrypoint', 'node',
    '--mount', `type=volume,source=${studioVolume},target=/data`,
    '--mount', `type=bind,source=${source},target=/app/apps/api/src,readonly`, studioImage, '--input-type=module', '-e', code])
}
async function state() {
  return JSON.parse(await data(`import { DatabaseSync } from 'node:sqlite';
    const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});
    console.log(JSON.stringify({funding:db.prepare('SELECT * FROM funding_writes WHERE owner=7').get(),
      request:db.prepare('SELECT status FROM requests WHERE owner=7').get(),
      reservation:db.prepare('SELECT status FROM trial_reservations WHERE owner=7').get(),
      audits:db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='funding_recoveries'").get().n
        ? db.prepare('SELECT COUNT(*) AS n FROM funding_recoveries').get().n : 0})); db.close();`))
}
try {
  await compose('up', '-d', '--wait', '--wait-timeout', '90')
  studioId = (await compose('ps', '-q', 'studio-api')).trim()
  nativeId = (await compose('ps', '-q', 'new-api')).trim()
  const studio = await inspect(studioId), native = await inspect(nativeId)
  studioVolume = studio.Mounts.find(mount => mount.Destination === '/data').Name
  studioImage = studio.Image
  assert.equal(Object.values(native.HostConfig.PortBindings ?? {}).some(value => value?.length), false)
  assert.equal(Object.values(studio.HostConfig.PortBindings ?? {}).some(value => value?.length), false)
  const live = await cliCommand('inspect', ...baseArguments())
  assert.notEqual(live.code, 0); assert.match(live.stderr, /Stop Studio/)
  const locked = await run(docker, ['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'node',
    '--mount', `type=volume,source=${studioVolume},target=/data`,
    '--mount', `type=bind,source=${helperSource},target=/recovery-helper.mjs,readonly`,
    studioImage, '/recovery-helper.mjs', '/data/requests.sqlite', String(owner), instance], '{"command":"inspect"}\n')
  assert.notEqual(locked.code, 0); assert.match(locked.stdout, /locked/)
  await compose('stop', 'studio-api') // Explicit test step; utility must not do it.
  await data(`import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync('/data/requests.sqlite');
    db.prepare('INSERT OR IGNORE INTO trial_installation VALUES(1,?)').run(${JSON.stringify(instance)});
    db.prepare("INSERT INTO funding_writes VALUES(7,'wallet_only','unknown','fixture-old-write')").run();
    db.prepare("INSERT INTO trial_grants VALUES(7,1,42,'active','fixture')").run();
    db.prepare("INSERT INTO requests VALUES(7,'agent',?,?,'unknown',NULL,'fixture')").run(${JSON.stringify(key)},${JSON.stringify(payloadHash)});
    db.prepare("INSERT INTO trial_reservations VALUES(7,'agent',?,'image','unknown')").run(${JSON.stringify(key)}); db.close();`)
  await command(docker, ['exec', nativeId, 'node', '-e', "require('node:fs').writeFileSync('/data/recovery-fixture-marker','persistent native volume')"])
  const before = await state(), oldStartedAt = (await inspect(nativeId)).State.StartedAt
  const inspected = await cliCommand('inspect', ...baseArguments())
  assert.equal(inspected.code, 0, inspected.stderr)
  const snapshot = JSON.parse(inspected.stdout)
  assert.deepEqual(await state(), before)
  assert.equal((await inspect(nativeId)).State.StartedAt, oldStartedAt)
  assert.equal((await inspect(studioId)).State.Running, false)
  const mismatch = await cliCommand('reconcile', ...baseArguments(), '--expected-row-hash', 'e'.repeat(64), '--restart-native')
  assert.notEqual(mismatch.code, 0); assert.match(mismatch.stderr, /snapshot/)
  assert.equal((await inspect(nativeId)).State.StartedAt, oldStartedAt)
  const recovered = await cliCommand('reconcile', ...baseArguments(), '--expected-row-hash', snapshot.hash, '--restart-native')
  assert.equal(recovered.code, 0, recovered.stderr)
  assert.equal(JSON.parse(recovered.stdout).status, 'reconciled')
  const after = await state()
  assert.equal(after.funding.status, 'reconciled'); assert.equal(after.audits, 1)
  assert.equal(after.funding.preference, before.funding.preference)
  assert.deepEqual(after.request, before.request); assert.deepEqual(after.reservation, before.reservation)
  assert.notEqual((await inspect(nativeId)).State.StartedAt, oldStartedAt)
  assert.equal((await inspect(studioId)).State.Running, false)
  assert.equal(await command(docker, ['exec', nativeId, 'node', '-e', "console.log(require('node:fs').readFileSync('/data/recovery-fixture-marker','utf8'))"]), 'persistent native volume')
  const setup = JSON.parse(await command(docker, ['exec', nativeId, 'node', '-e', "fetch('http://127.0.0.1:3000/api/setup').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"]))
  assert.equal(setup.data.status, false); assert.equal(setup.data.root_init, false)
  await data("import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync('/data/requests.sqlite'); db.exec(\"UPDATE funding_writes SET status='unknown',updated_at='fixture-second-write' WHERE owner=7\"); db.close();")
  const second = JSON.parse((await cliCommand('inspect', ...baseArguments())).stdout)
  const actualDocker = dockerRunner(docker)
  let snapshots = 0
  await assert.rejects(operate({ mode: 'reconcile', project, 'studio-container': studioId, 'native-container': nativeId,
    instance, owner, docker, 'restart-native': true, 'expected-row-hash': second.hash }, {
    docker: args => {
      if (args[0] === 'ps' && ++snapshots === 2) throw new Error('explicit fixture: post-restart topology proof unavailable')
      return actualDocker(args)
    },
  }), /post-restart topology proof/)
  const failed = await state()
  assert.equal(failed.funding.status, 'unknown'); assert.equal(failed.audits, 1)
  assert.deepEqual(failed.request, before.request); assert.deepEqual(failed.reservation, before.reservation)
  assert.equal((await inspect(studioId)).State.Running, false)
  const retry = await cliCommand('reconcile', ...baseArguments(), '--expected-row-hash', second.hash, '--restart-native')
  assert.equal(retry.code, 0, retry.stderr)
  await compose('start', 'studio-api') // Explicit test step, never performed by CLI.
  await compose('up', '-d', '--wait', '--wait-timeout', '60', 'studio-api')
  const final = JSON.parse(await data(`import { DatabaseSync } from 'node:sqlite';
    import { FundingState } from '/app/apps/api/src/funding-state.mjs'; import { Ledger } from '/app/apps/api/src/ledger.mjs';
    const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});
    console.log(JSON.stringify({blocked:FundingState.prototype.blocked.call({db},7),
      replay:Ledger.prototype.begin.call({db},7,'agent',${JSON.stringify(key)},${JSON.stringify(payload)})})); db.close();`))
  assert.equal(final.blocked, false)
  assert.deepEqual(final.replay, { blocked: true }, 'recovery never makes the old unknown model request replayable')
  console.log('Real isolated Docker recovery passed: inspect read-only, explicit stop/new native boot under helper lock, persistent volume, CAS audit, post-restart failure remains unknown, Studio stays stopped until explicit test restart. No native accounts or model calls.')
} catch (error) {
  console.error(await compose('logs', '--no-color', '--tail', '15').catch(() => ''))
  throw error
} finally {
  await compose('down', '-v', '--remove-orphans').catch(error => console.error(error.message))
  await rm(directory, { recursive: true, force: true })
}
