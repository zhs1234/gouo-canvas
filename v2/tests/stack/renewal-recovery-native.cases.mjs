// Opt-in real pinned Native HTTP/SQLite recovery test. All identities, funds,
// finite policy approvals and inaccessible provider permissions are synthetic.
// Private test ingress is not public deployment or live paid-model proof.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const docker = process.env.GOUO_RECOVERY_TEST_DOCKER ?? 'docker'
const directory = await mkdtemp(join(tmpdir(), 'gouo-renewal-recovery-native-'))
const project = 'gouo-renewal-test-' + process.pid + '-' + Date.now().toString(36)
const instance = randomUUID(), sourceCommit = '0aec08fee811ec6136828fda790551b49e410301'
const source = fileURLToPath(new URL('../../apps/api/src', import.meta.url)).replaceAll('\\', '/')
const cli = fileURLToPath(new URL('../../scripts/reconcile-renewal.mjs', import.meta.url))
const file = join(directory, 'compose.yml'), env = join(directory, 'empty.env')
const origin = 'http://new-api:3000'
await writeFile(env, '')
await writeFile(join(directory, 'routing.json'), JSON.stringify({ sourceCommit, gatewayOrigin: origin, retryTimes: 0, operatorVerified: true, verifiedAt: new Date().toISOString() }))
await writeFile(join(directory, 'policy.json'), JSON.stringify({ sourceCommit, gatewayOrigin: origin, instanceId: instance, operatorVerified: true,
  relayIngress: 'studio-only', tokenWrites: 'studio-only', completeKeys: 'studio-only', redisEnabled: false, batchUpdateEnabled: false }))
await writeFile(join(directory, 'models.json'), JSON.stringify({ models: [{ id: 'fixture-chat', displayName: 'Synthetic inaccessible provider fixture', kind: 'chat',
  upstreamModelId: 'fixture-chat', enabled: true, verification: 'live-verified' }] }))
await writeFile(file, `services:
  new-api:
    image: gouo-v2-new-api:latest
    environment:
      PORT: '3000'
      SQLITE_PATH: /data/new-api.db
      TRUSTED_PROXIES: none
      SESSION_SECRET: synthetic-private-renewal-test-only
      BATCH_UPDATE_ENABLED: 'false'
    volumes: [native-data:/data]
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 1s
      retries: 60
  studio-api:
    image: gouo-v2-studio-api:latest
    environment:
      GOUO_STUDIO_HOST: 0.0.0.0
      GOUO_BACKEND_DEV_TARGET: ${origin}
      GOUO_GATEWAY_BASE_URL: ${origin}/v1
      GOUO_STUDIO_LEDGER_PATH: /data/requests.sqlite
      GOUO_ACCOUNT_INSTANCE_ID: ${instance}
      GOUO_RELAY_CREDENTIAL_MODE: user-token
      GOUO_RELAY_ROUTING_MODE: model
      GOUO_USER_TOKEN_QUOTA_CAP: '100'
      GOUO_USER_TOKEN_LIFETIME_SECONDS: '3600'
      GOUO_ENABLE_GENERATION: 'true'
      GOUO_ENABLE_TOKEN_RENEWAL: 'true'
      GOUO_NORMAL_ROUTING_EVIDENCE_FILE: /fixture/routing.json
      GOUO_TOKEN_RENEWAL_POLICY_FILE: /fixture/policy.json
      GOUO_STUDIO_MODELS_FILE: /fixture/models.json
    volumes:
      - studio-data:/data
      - type: bind
        source: ${JSON.stringify(source)}
        target: /app/apps/api/src
        read_only: true
      - type: bind
        source: ${JSON.stringify(directory.replaceAll('\\', '/'))}
        target: /fixture
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
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', value => { stdout += value }); child.stderr.on('data', value => { stderr += value })
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.stdin.end(input)
  })
}
async function command(binary, args, input) {
  const result = await run(binary, args, input)
  if (result.code !== 0) throw new Error(`Isolated ${args[0]} command failed (${result.code}); no credentials printed`)
  return result.stdout
}
const compose = (...args) => command(docker, ['compose', '--env-file', env, '-p', project, '-f', file, ...args])
const inspect = async id => JSON.parse(await command(docker, ['inspect', '--type', 'container', id]))[0]
const json = output => JSON.parse(output)
const nativeCode = code => compose('exec', '-T', 'new-api', 'node', '--input-type=module', '-e', code)
const nativePrelude = `import assert from 'node:assert/strict'; import {DatabaseSync} from 'node:sqlite';
  async function native(path,auth,body) {
    const response=await fetch('http://127.0.0.1:3000'+path,{method:body===undefined?'GET':'POST',
      headers:{Origin:'http://127.0.0.1:3000',...(auth?{Authorization:'Bearer '+auth}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const value=await response.json();assert.equal(value.success,true,'Synthetic Native request failed: '+path);return value.data;
  }`
let studioId, nativeId, studioVolume, studioImage, containerEnv
async function offline(code) {
  const args = ['run', '--rm', '-i', '--network', project + '_default', '--entrypoint', 'node',
    '--mount', `type=volume,source=${studioVolume},target=/data`,
    '--mount', `type=bind,source=${source},target=/app/apps/api/src,readonly`,
    '--mount', `type=bind,source=${directory.replaceAll('\\', '/')},target=/fixture,readonly`]
  for (const value of containerEnv) if (value.startsWith('GOUO_')) args.push('--env', value)
  return json(await command(docker, [...args, studioImage, '--input-type=module', '-e', code]))
}
const baseArguments = owner => ['--project', project, '--studio-container', studioId, '--native-container', nativeId,
  '--instance', instance, '--owner', String(owner), '--docker', docker]
const cliCommand = (...args) => run(process.execPath, [cli, ...args])
async function nativeSnapshot() {
  return json(await nativeCode(`import {DatabaseSync} from 'node:sqlite'; import {createHash} from 'node:crypto'; const db=new DatabaseSync('/data/new-api.db',{readOnly:true});
    const columns=table=>db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name);
    console.log(JSON.stringify({schema:{tokens:columns('tokens'),logs:columns('logs'),users:columns('users')},
      tokens:db.prepare('SELECT id,user_id,name,status,created_time,accessed_time,expired_time,remain_quota,used_quota,unlimited_quota,model_limits_enabled,model_limits,allow_ips,"group",cross_group_retry,deleted_at FROM tokens ORDER BY id').all(),
      keyFingerprints:db.prepare('SELECT id,key FROM tokens ORDER BY id').all().map(row=>({id:row.id,sha256:createHash('sha256').update(row.key).digest('hex')})),
      users:db.prepare('SELECT id,quota,used_quota,request_count FROM users ORDER BY id').all(),
      subscriptions:db.prepare('SELECT * FROM user_subscriptions ORDER BY id').all(),
      logs:db.prepare('SELECT id,type,user_id,token_id,quota,model_name FROM logs ORDER BY id').all()}));db.close();`))
}
async function ledgerSnapshot() {
  return offline(`import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/data/requests.sqlite',{readOnly:true});
    const rows=table=>db.prepare('SELECT * FROM '+table+' ORDER BY owner').all();
    console.log(JSON.stringify({renewals:rows('relay_renewals'),bindings:rows('relay_bindings'),requests:rows('requests'),
      held:rows('trial_reservations'),funding:rows('funding_writes'),submissions:rows('model_submissions')}));db.close();`)
}
const evidence = []
try {
  await compose('up', '-d', '--wait', '--wait-timeout', '90')
  studioId = await compose('ps', '-q', 'studio-api'); nativeId = await compose('ps', '-q', 'new-api')
  const studio = await inspect(studioId), native = await inspect(nativeId)
  studioVolume = studio.Mounts.find(mount => mount.Destination === '/data').Name
  studioImage = studio.Image; containerEnv = studio.Config.Env
  for (const container of [studio, native]) assert.equal(Object.values(container.HostConfig.PortBindings ?? {}).some(value => value?.length), false)
  assert.equal((await compose('exec', '-T', 'new-api', 'sha256sum', '/usr/local/bin/new-api')).split(' ')[0], 'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529')
  await nativeCode(nativePrelude + `await native('/api/setup',undefined,{username:'fixture-root',password:'Synthetic_renewal_2026!',confirmPassword:'Synthetic_renewal_2026!',SelfUseModeEnabled:false,DemoSiteEnabled:false});
    const db=new DatabaseSync('/data/new-api.db'); for(const [key,value] of Object.entries({QuotaForNewUser:'0',RetryTimes:'0','payment_setting.compliance_confirmed':'true','payment_setting.compliance_terms_version':'v1'}))db.prepare('INSERT OR REPLACE INTO options(key,value) VALUES(?,?)').run(key,value);db.close();`)
  await compose('restart', 'new-api'); await compose('up', '-d', '--wait', '--wait-timeout', '60', 'new-api')
  // The only initial money mutation is an explicit synthetic SQLite fixture.
  // Recovery itself uses Native read-only SQLite and never this setup primitive.
  const fixtures = json(await nativeCode(nativePrelude + `const admin=await native('/api/user/login',undefined,{username:'fixture-root',password:'Synthetic_renewal_2026!'});
    await native('/api/channel/',admin.access_token,{mode:'single',channel:{type:1,name:'Never called synthetic permission fixture',key:'synthetic-unused-key',status:1,base_url:'http://127.0.0.1:1',models:'fixture-chat',group:'default'}});
    const cases=[];for(const action of ['adopt','close-empty']){
      const username='fixture-'+action;await native('/api/user/register',undefined,{username,password:'Synthetic_renewal_2026!'});
      const login=await native('/api/user/login',undefined,{username,password:'Synthetic_renewal_2026!'});
      const db=new DatabaseSync('/data/new-api.db');db.prepare('UPDATE users SET quota=1000 WHERE id=?').run(login.user.id);db.close();
      await native('/api/token/',login.access_token,{name:'gouo-studio',remain_quota:50,expired_time:Math.floor(Date.now()/1000)-120,
        unlimited_quota:false,model_limits_enabled:true,model_limits:'fixture-chat',group:'',cross_group_retry:false,allow_ips:''});
      const old=(await native('/api/token/search?keyword=gouo-studio&p=1&page_size=100',login.access_token)).items[0];
      cases.push({action,owner:login.user.id,auth:login.access_token,oldId:old.id});
    }console.log(JSON.stringify({cases}));`))
  await writeFile(join(directory, 'accounts.json'), JSON.stringify(fixtures), { mode: 0o600 })
  for (const fixture of fixtures.cases) {
    const live = await cliCommand('inspect', ...baseArguments(fixture.owner))
    assert.notEqual(live.code, 0); assert.match(live.stderr, /Stop Studio/)
    await compose('stop', 'studio-api') // The CLI must never do this itself.
    const attempt = await offline(`import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
      import {createServer} from '/app/apps/api/src/server.mjs';import {loadConfig} from '/app/apps/api/src/config.mjs';
      const fixture=JSON.parse(readFileSync('/fixture/accounts.json')).cases.find(row=>row.owner===${fixture.owner});
      let creates=0,modelCalls=0;const app=createServer(loadConfig(process.env),{fetch:async(url,options)=>{
        if(url.pathname.startsWith('/v1/')&&url.pathname!='/v1/models'){modelCalls++;throw new Error('Model calls forbidden');}
        if(url.pathname==='/api/token/'&&options?.method==='POST'){
          creates++;if(fixture.action==='adopt'){const response=await fetch(url,options);assert.equal((await response.json()).success,true);}
          throw new Error('Explicit fixture: Native create response lost or request never delivered');
        }return fetch(url,options);
      }});const headers={authorization:'Bearer '+fixture.auth};
      const access=await app.inject({url:'/api/studio/access',headers});assert.equal(access.json().data.canRenew,true,access.body);
      const key=randomUUID(),payload={version:access.json().data.version,confirm:true};
      const response=await app.inject({method:'POST',url:'/api/studio/access/renew',headers:{...headers,'idempotency-key':key},payload});
      assert.notEqual(response.statusCode,200);assert.equal(creates,1);assert.equal(modelCalls,0);
      assert.equal((await app.inject({url:'/api/studio/access',headers})).json().data.state,'unknown');
      writeFileSync('/data/attempt-'+fixture.owner+'.json',JSON.stringify({key,payload}),{mode:0o600});await app.close();
      console.log(JSON.stringify({creates,modelCalls}));`)
    assert.equal(attempt.modelCalls, 0)
    // These unrelated fixtures must survive both recovery decisions untouched.
    await offline(`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/data/requests.sqlite');
      db.prepare("INSERT OR IGNORE INTO requests VALUES(999,'agent','old-unknown','fixture-hash','unknown',NULL,'fixture')").run();
      db.prepare("INSERT OR IGNORE INTO trial_reservations VALUES(999,'agent','old-unknown','image','unknown')").run();
      db.prepare("INSERT OR IGNORE INTO funding_writes VALUES(999,'wallet_only','unknown','fixture')").run();
      console.log('{}');db.close();`)
    const beforeNative = await nativeSnapshot(), beforeLedger = await ledgerSnapshot()
    const inspected = await cliCommand('inspect', ...baseArguments(fixture.owner))
    assert.equal(inspected.code, 0, inspected.stderr)
    const snapshot = json(inspected.stdout)
    assert.deepEqual(await nativeSnapshot(), beforeNative); assert.deepEqual(await ledgerSnapshot(), beforeLedger)
    const oldStartedAt = (await inspect(nativeId)).State.StartedAt
    const mismatch = await cliCommand(fixture.action, ...baseArguments(fixture.owner), '--expected-row-hash', 'e'.repeat(64),
      '--restart-native', '--confirm-private-token-ingress')
    assert.notEqual(mismatch.code, 0)
    assert.equal((await inspect(nativeId)).State.StartedAt, oldStartedAt)
    assert.deepEqual(await ledgerSnapshot(), beforeLedger)
    assert.equal(beforeLedger.submissions.length, 0)
    const result = await cliCommand(fixture.action, ...baseArguments(fixture.owner), '--expected-row-hash', snapshot.hash,
      '--restart-native', '--confirm-private-token-ingress')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(json(result.stdout).status, fixture.action === 'adopt' ? 'adopted' : 'reconciled_empty')
    assert.notEqual((await inspect(nativeId)).State.StartedAt, oldStartedAt)
    assert.equal((await inspect(studioId)).State.Running, false); assert.equal((await inspect(studioId)).State.Pid, 0)
    assert.deepEqual(await nativeSnapshot(), beforeNative, 'Recovery never writes Native token quota, wallet, subscriptions or logs')
    const afterLedger = await ledgerSnapshot()
    for (const field of ['requests', 'held', 'funding', 'submissions']) assert.deepEqual(afterLedger[field], beforeLedger[field], field)
    if (fixture.action === 'close-empty') assert.deepEqual(afterLedger.bindings, beforeLedger.bindings)
    await compose('start', 'studio-api') // Explicit test restart, never CLI behavior.
    await compose('up', '-d', '--wait', '--wait-timeout', '60', 'studio-api')
    const checked = json(await compose('exec', '-T', 'studio-api', 'node', '--input-type=module', '-e', `
      import {readFileSync} from 'node:fs';const fixture=JSON.parse(readFileSync('/fixture/accounts.json')).cases.find(row=>row.owner===${fixture.owner});
      const attempt=JSON.parse(readFileSync('/data/attempt-'+fixture.owner+'.json'));const headers={authorization:'Bearer '+fixture.auth};
      const access=await fetch('http://127.0.0.1:3001/api/studio/access',{headers}).then(r=>r.json());
      const replay=await fetch('http://127.0.0.1:3001/api/studio/access/renew',{method:'POST',headers:{...headers,'content-type':'application/json','idempotency-key':attempt.key},body:JSON.stringify(attempt.payload)});
      console.log(JSON.stringify({access:access.data,replay:replay.status}));`))
    assert.equal(checked.replay, 409, 'Original ambiguous key remains permanently non-replayable')
    assert.equal(checked.access.state, fixture.action === 'adopt' ? 'ready' : 'expired')
    assert.equal(checked.access.canRenew, fixture.action === 'close-empty')
    assert.deepEqual(await nativeSnapshot(), beforeNative)
    evidence.push({ action: fixture.action, owner: fixture.owner, oldKey409: true, nativeWritesDuringRecovery: 0, modelCalls: 0,
      accessState: checked.access.state, explicitStudioRestart: true, stoppedPidZero: true })
  }
  console.log(JSON.stringify({ sourceCommit, privateNativeNoHostPublish: true, realPaidCost: 0,
    syntheticFinitePolicyOnly: true, publicDeploymentProof: false, cases: evidence }, null, 2))
} finally {
  await compose('down', '-v', '--remove-orphans').catch(error => console.error(error.message))
  await rm(directory, { recursive: true, force: true })
}
