// Opt-in real Native failure/refund reproduction. Every account, amount and
// supplier is a synthetic isolated fixture; procurement and real paid calls = 0.
// GOUO_RUN_SUBSCRIPTION_REFUND_REPRO=1 node tests/stack/subscription-refund-native.cases.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const baseSourceCommit='0aec08fee811ec6136828fda790551b49e410301'
const baseBinarySha256='a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529'
const pause=ms=>new Promise(done=>setTimeout(done,ms))
if(process.argv[2]==='--fixture-provider'){
  const directory='/fixture';let calls=0,anonymousRejected=0
  createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer fixture-refund-zero-procurement'){
      anonymousRejected++;await writeFile(join(directory,'provider.json'),JSON.stringify({calls,anonymousRejected}));res.writeHead(401);return res.end()
    }
    if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);return res.end()}
    for await(const _ of req){} // No prompt or credential persistence.
    calls++
    if(calls!==1){await writeFile(join(directory,'provider.json'),JSON.stringify({calls,anonymousRejected,outcome:'unexpected-second-request'}));res.writeHead(503);return res.end()}
    await writeFile(join(directory,'provider.json'),JSON.stringify({calls,anonymousRejected,outcome:'received-held'}))
    for(let i=0;i<300;i++){
      try{if(JSON.parse(await readFile(join(directory,'release.json'),'utf8')).release===true)break}catch{}
      await pause(100)
    }
    await writeFile(join(directory,'provider.json'),JSON.stringify({calls,anonymousRejected,outcome:'response-lost'}))
    req.socket.destroy()
  }).listen(19000,'0.0.0.0')
}else if(process.env.GOUO_RUN_SUBSCRIPTION_REFUND_REPRO!=='1'){
  console.log(JSON.stringify({skipped:true,reason:'Explicit GOUO_RUN_SUBSCRIPTION_REFUND_REPRO=1 required; isolated synthetic test only'}))
}else{
  const docker=process.env.GOUO_NATIVE_TEST_DOCKER??'docker'
  let image='gouo-v2-new-api:latest',expectedBinarySha256=baseBinarySha256,candidate=null
  const candidateArgument=process.argv.indexOf('--candidate-meta')
  if(candidateArgument>=0){
    assert.ok(process.argv[candidateArgument+1],'Candidate metadata path required')
    candidate=JSON.parse(await readFile(resolve(process.argv[candidateArgument+1]),'utf8'))
    assert.deepEqual(Object.keys(candidate).sort(),['baseSourceCommit','binarySha256','image','imageId','patchDigest','patchFile','version'].sort())
    assert.equal(candidate.version,1);assert.equal(candidate.baseSourceCommit,baseSourceCommit)
    assert.match(candidate.patchDigest,/^[a-f0-9]{64}$/);assert.match(candidate.binarySha256,/^[a-f0-9]{64}$/);assert.match(candidate.imageId,/^sha256:[a-f0-9]{64}$/)
    const patchPath=resolve(candidate.patchFile),canonicalPatch=resolve('patches/new-api/refund-transaction.patch')
    assert.ok(patchPath===canonicalPatch||patchPath.startsWith(resolve('.local')+'/')||patchPath.startsWith(resolve('.local')+'\\'),'Candidate patch must be the project patch or its immutable local copy')
    assert.equal(createHash('sha256').update(await readFile(canonicalPatch)).digest('hex'),candidate.patchDigest)
    assert.equal(createHash('sha256').update(await readFile(patchPath)).digest('hex'),candidate.patchDigest)
    image=candidate.image;expectedBinarySha256=candidate.binarySha256
  }
  await mkdir(resolve('.local'),{recursive:true})
  const directory=await mkdtemp(resolve('.local/subscription-refund-native-'))
  const project='gouo-subscription-refund-'+process.pid+'-'+Date.now().toString(36)
  const composePath=join(directory,'compose.json'),envPath=join(directory,'empty.env'),control=join(directory,'fixture')
  await mkdir(control);await writeFile(envPath,'');await writeFile(join(control,'release.json'),JSON.stringify({release:false}))
  const bind=(source,target,read_only=true)=>({type:'bind',source:resolve(source).replaceAll('\\','/'),target,read_only})
  await writeFile(composePath,JSON.stringify({services:{
    'new-api':{image,environment:{PORT:'3000',SQLITE_PATH:'/data/new-api.db',TRUSTED_PROXIES:'none',SESSION_SECRET:'synthetic-refund-repro-session-only',PASSWORD_LOGIN_ENCRYPTION_ENABLED:'true',BATCH_UPDATE_ENABLED:'false'},volumes:['native-data:/data',bind(control,'/fixture',false)],healthcheck:{test:['CMD','node','-e',"fetch('http://127.0.0.1:3000/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"],interval:'1s',timeout:'3s',retries:60}},
    'fixture-provider':{image:'gouo-v2-studio-api:latest',entrypoint:['node','/app/tests/stack/subscription-refund-native.cases.mjs','--fixture-provider'],volumes:[bind('tests/stack/subscription-refund-native.cases.mjs','/app/tests/stack/subscription-refund-native.cases.mjs'),bind(control,'/fixture',false)]}
  },volumes:{'native-data':{}}}))
  function run(args){return new Promise((done,reject)=>{const child=spawn(docker,args,{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('exit',code=>{const operation=args[0]==='compose'?args.slice(args.indexOf('-f')+2,args.indexOf('-f')+5).join(' '):args.slice(0,2).join(' ');return code===0?done(output):reject(new Error('Isolated refund Docker command failed ('+code+', '+operation+')'))})})}
  const compose=(...args)=>run(['compose','--env-file',envPath,'-p',project,'-f',composePath,...args])
  const execute=code=>compose('exec','-T','new-api','node','--input-type=module','-e',code)
  const jsonOutput=value=>JSON.parse(value.split('\n').find(line=>line.startsWith('{')))
  const snapshotCode=`import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync('/data/new-api.db',{readOnly:true});db.exec('PRAGMA busy_timeout=5000');console.log(JSON.stringify({users:db.prepare('SELECT id,status,quota,used_quota,request_count FROM users WHERE id=2').all(),subscriptions:db.prepare('SELECT id,user_id,status,amount_total,amount_used FROM user_subscriptions WHERE user_id=2').all(),tokens:db.prepare('SELECT id,user_id,name,status,remain_quota,used_quota,expired_time,unlimited_quota FROM tokens WHERE user_id=2').all(),preconsumes:db.prepare('SELECT id,request_id,user_id,user_subscription_id,pre_consumed,status,created_at,updated_at FROM subscription_pre_consume_records WHERE user_id=2').all(),logs:db.prepare('SELECT type,quota,request_id,token_id,user_id FROM logs WHERE user_id=2').all(),retryTimes:db.prepare('SELECT value FROM options WHERE key=?').get('RetryTimes')?.value}));db.close()`
  const guardedSnapshotCode=snapshotCode.replace("console.log(JSON.stringify({users:","try{console.log(JSON.stringify({users:").replace("}));db.close()","}));}catch(error){if(error.code==='ERR_SQLITE_ERROR'&&Number.isInteger(error.errcode)&&[5,6].includes(error.errcode&255)&&/^(database (is )?(locked|busy)|database table is locked|database schema is locked)(?:[: ].*)?$/i.test(error.message))console.log(JSON.stringify({readError:'sqlite-busy',sqliteCode:error.errcode,sqliteErrorCode:error.code}));else throw Error('Readonly Native snapshot failed')}finally{db.close()}")
  const snapshot=async()=>jsonOutput(await execute(guardedSnapshotCode))
  let relayPromise,evidencePath=join(directory,'evidence.json')
  try{
    const imageInfo=JSON.parse(await run(['image','inspect',image]))[0]
    if(candidate){assert.equal(imageInfo.Id,candidate.imageId);assert.equal(imageInfo.Config.Labels?.['org.gouo.native.base-sha'],baseSourceCommit);assert.equal(imageInfo.Config.Labels?.['org.gouo.native.patch-sha256'],candidate.patchDigest)}
    await compose('up','-d','--wait','--wait-timeout','90')
    const binarySha256=(await compose('exec','-T','new-api','sha256sum','/usr/local/bin/new-api')).split(' ')[0]
    assert.equal(binarySha256,expectedBinarySha256)
    // Authoritative published-port check, independent from the compose source.
    for(const service of ['new-api','fixture-provider']){
      const id=(await compose('ps','-q',service)).trim();const container=JSON.parse(await run(['inspect',id]))[0]
      assert.equal(Object.values(container.NetworkSettings.Ports??{}).some(value=>Array.isArray(value)&&value.length>0),false)
    }
    await execute(`const r=await fetch('http://127.0.0.1:3000/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'fixture-root',password:'Synthetic_refund_fixture_2026!',confirmPassword:'Synthetic_refund_fixture_2026!',SelfUseModeEnabled:false,DemoSiteEnabled:false})});if(!(await r.json()).success)throw Error('Synthetic setup rejected')`)
    await execute(`import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync('/data/new-api.db');const rows=${JSON.stringify({'payment_setting.compliance_confirmed':'true','payment_setting.compliance_terms_version':'v1',RetryTimes:'0',QuotaForNewUser:'0',ModelPrice:'{"fixture-refund":0.00004}',GroupRatio:'{"default":1}'})};for(const[key,value]of Object.entries(rows))db.prepare('INSERT OR REPLACE INTO options(key,value)VALUES(?,?)').run(key,value);db.close()`)
    await compose('restart','new-api');await compose('up','-d','--wait','--wait-timeout','90','new-api')
    // All real owner credentials stay inside this temporary Native process.
    relayPromise=execute(`import{publicEncrypt,constants}from'node:crypto';import{writeFile}from'node:fs/promises';const base='http://127.0.0.1:3000';const call=async(path,body,token,method)=>{const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});const v=await r.json();if(!r.ok||v.success!==true)throw Error('Synthetic Native contract rejected');return v.data};const login=async username=>{const key=await call('/api/user/login/encryption-key');return call('/api/user/login',{username,password_encrypted:publicEncrypt({key:key.public_key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from('Synthetic_refund_fixture_2026!')).toString('base64'),encryption_key_id:key.kid})};const admin=await login('fixture-root');await call('/api/channel/',{mode:'single',channel:{type:1,name:'EXPLICIT LOCAL REFUND FIXTURE; procurement 0',key:'fixture-refund-zero-procurement',base_url:'http://fixture-provider:19000',models:'fixture-refund',group:'default',auto_ban:0}},admin.access_token);await call('/api/channel/',{id:1,type:1,name:'EXPLICIT LOCAL REFUND FIXTURE; procurement 0',auto_ban:0},admin.access_token,'PUT');if((await call('/api/channel/1',undefined,admin.access_token)).auto_ban!==0)throw Error('Fixture auto-ban readback failed');await call('/api/subscription/admin/plans',{plan:{title:'SYNTHETIC zero-price finite refund fixture',price_amount:0,currency:'USD',enabled:true,total_amount:500000,duration_unit:'day',duration_value:1,custom_seconds:0,quota_reset_period:'never',quota_reset_custom_seconds:0,max_purchase_per_user:1,allow_balance_pay:true,allow_wallet_overflow:false,upgrade_group:'',downgrade_group:''}},admin.access_token);await call('/api/user/register',{username:'fixture-refund-owner',password:'Synthetic_refund_fixture_2026!'});const user=await login('fixture-refund-owner');if(user.user.id!==2||user.user.quota!==0)throw Error('Synthetic zero-wallet owner mismatch');const plan=(await call('/api/subscription/plans',undefined,user.access_token))[0].plan;if(plan.price_amount!==0||plan.total_amount!==500000||plan.allow_wallet_overflow!==false)throw Error('Finite fixture plan mismatch');await call('/api/subscription/balance/pay',{plan_id:plan.id},user.access_token);await call('/api/subscription/self/preference',{billing_preference:'subscription_only'},user.access_token,'PUT');if((await call('/api/subscription/self',undefined,user.access_token)).billing_preference!=='subscription_only')throw Error('Funding preference mismatch');await call('/api/token/',{name:'fixture-refund-finite',remain_quota:500000,expired_time:Math.floor(Date.now()/1000)+3600,unlimited_quota:false,model_limits_enabled:true,model_limits:'fixture-refund',group:'',cross_group_retry:false,allow_ips:''},user.access_token);const item=(await call('/api/token/search?keyword=fixture-refund-finite&p=1&page_size=100',undefined,user.access_token)).items[0];const key=(await call('/api/token/'+item.id+'/key',{},user.access_token)).key;const anonymous=await fetch('http://fixture-provider:19000/v1/chat/completions',{method:'POST',body:'{}'});if(anonymous.status!==401)throw Error('Anonymous fixture provider admitted');await writeFile('/fixture/prepared.json',JSON.stringify({owner:user.user.id,tokenId:item.id,planId:plan.id,preference:'subscription_only'}));let permitted=false;for(let i=0;i<300;i++){try{if(JSON.parse(await(await import('node:fs/promises')).readFile('/fixture/send.json','utf8')).send===true){permitted=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!permitted)throw Error('Isolated relay was not explicitly released');const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'fixture-refund',messages:[{role:'user',content:'EXPLICIT LOCAL REFUND FIXTURE; exactly one received request; procurement zero'}],stream:false,max_tokens:32}),signal:AbortSignal.timeout(45000),redirect:'error'});const payload=await response.json().catch(()=>null);const requestIdHeader=response.headers.get('x-request-id');await writeFile('/fixture/relay.json',JSON.stringify({status:response.status,requestIdHeader:requestIdHeader&&/^[A-Za-z0-9_-]{1,128}$/.test(requestIdHeader)?requestIdHeader:null,errorResponse:Boolean(payload?.error)}));`)
    // Attach the rejection immediately; the unique relay is never retried.
    let relayError=null;relayPromise.catch(error=>{relayError=error})
    for(let i=0;i<120;i++){try{await readFile(join(control,'prepared.json'));break}catch{}if(relayError)throw relayError;await pause(250)}
    const prepared=JSON.parse(await readFile(join(control,'prepared.json'),'utf8'));assert.equal(prepared.owner,2)
    const before=await snapshot();assert.equal(before.users[0].quota,0);assert.equal(before.subscriptions[0].amount_used,0);assert.equal(before.tokens[0].used_quota,0);assert.equal(before.preconsumes.length,0);assert.equal(before.retryTimes,'0')
    await writeFile(join(control,'before.json'),JSON.stringify(before))
    await writeFile(join(control,'send.json'),JSON.stringify({send:true}))
    let supplier
    for(let i=0;i<120;i++){try{supplier=JSON.parse(await readFile(join(control,'provider.json'),'utf8'));if(supplier.calls===1)break}catch{}if(relayError)throw relayError;await pause(100)}
    assert.equal(supplier?.calls,1);assert.equal(supplier.outcome,'received-held')
    const inflight=await snapshot();assert.equal(inflight.preconsumes.length,1);const requestId=inflight.preconsumes[0].request_id
    assert.match(requestId,/^[A-Za-z0-9_-]{1,128}$/);assert.equal(inflight.preconsumes[0].status,'consumed');assert.equal(inflight.preconsumes[0].pre_consumed,20);assert.equal(inflight.subscriptions[0].amount_used,20);assert.equal(inflight.tokens[0].used_quota,20)
    await writeFile(join(control,'inflight.json'),JSON.stringify(inflight))
    await writeFile(join(control,'release.json'),JSON.stringify({release:true}));await relayPromise
    const relay=JSON.parse(await readFile(join(control,'relay.json'),'utf8'));assert.ok(relay.status>=400);if(relay.requestIdHeader)assert.equal(relay.requestIdHeader,requestId)
    const polls=[];let after,fullyRefunded=false;const started=Date.now()
    do{
      const read=await snapshot();if(read.readError){polls.push({elapsedMs:Date.now()-started,readError:read.readError,sqliteCode:read.sqliteCode,sqliteErrorCode:read.sqliteErrorCode});await pause(500);continue}
      after=read;const record=after.preconsumes.find(row=>row.request_id===requestId);assert.ok(record);assert.equal(after.preconsumes.length,1)
      polls.push({elapsedMs:Date.now()-started,recordStatus:record.status,subscriptionUsed:after.subscriptions[0].amount_used,tokenUsed:after.tokens[0].used_quota,tokenRemain:after.tokens[0].remain_quota})
      fullyRefunded=record.status==='refunded'&&after.subscriptions[0].amount_used===0&&after.tokens[0].used_quota===0&&after.tokens[0].remain_quota===500000
      if(fullyRefunded)break
      await pause(500)
    }while(Date.now()-started<30000)
    const finalSupplier=JSON.parse(await readFile(join(control,'provider.json'),'utf8'));assert.equal(finalSupplier.calls,1);assert.equal(finalSupplier.anonymousRejected,1);assert.equal(finalSupplier.outcome,'response-lost');if(after)assert.equal(after.users[0].quota,0)
    let stoppedSnapshot=null,nativeStopObservation=null
    if(!after){
      await compose('stop','new-api')
      const id=(await compose('ps','-a','-q','new-api')).trim(),container=JSON.parse(await run(['inspect',id]))[0]
      assert.equal(container.State.Running,false);assert.equal(container.State.Pid,0)
      nativeStopObservation={containerId:container.Id,running:false,pid:0,finishedAt:container.State.FinishedAt}
      stoppedSnapshot=jsonOutput(await compose('run','--rm','--no-deps','--entrypoint','node','new-api','--input-type=module','-e',guardedSnapshotCode))
      assert.equal(stoppedSnapshot.readError,undefined)
      assert.equal(stoppedSnapshot.preconsumes.length,1);assert.equal(stoppedSnapshot.preconsumes[0].request_id,requestId)
      assert.equal(stoppedSnapshot.users[0].quota,0)
    }
    const result=fullyRefunded?'refund-observed':'observed-blocker'
    const report={version:1,result,baseSourceCommit,candidatePatchDigest:candidate?.patchDigest??null,imageId:imageInfo.Id,binarySha256,project,privateNative:true,sourceEvidenceVerified:Boolean(candidate)||binarySha256===baseBinarySha256,syntheticComplianceFixture:true,syntheticNativePerRequestQuota:20,procurementCost:0,realPaidProviderCalls:0,keysExcluded:true,modelRequestCount:1,requestId,relay,supplier:finalSupplier,before,inflight,after,polls,refundFullyObserved:fullyRefunded,settlementState:'unconfirmed',pollBoundMs:30000,sourceEvidence:['model/subscription.go#L1402','service/billing_session.go#L86','service/funding_source.go#L121'].map(path=>'https://github.com/QuantumNous/new-api/blob/'+baseSourceCommit+'/'+path)}
    await writeFile(evidencePath,JSON.stringify({...report,finalSnapshotAvailable:Boolean(after),stoppedSnapshot,nativeStopObservation,stoppedSnapshotMeaning:'Durable data read only after actual Native process stop; this is not an online terminal state or a refund assertion',readonlyLockTimeoutMs:5000},null,2));console.log(JSON.stringify({result,evidence:evidencePath,requestId,modelRequestCount:1,finalSnapshotPhase:after?'running':stoppedSnapshot?'stopped':'unavailable',finalRecordStatus:(after??stoppedSnapshot)?.preconsumes[0].status??'unavailable',subscriptionUsed:(after??stoppedSnapshot)?.subscriptions[0].amount_used??null,tokenUsed:(after??stoppedSnapshot)?.tokens[0].used_quota??null,procurementCost:0,realPaidProviderCalls:0}))
  }finally{
    // Unblock only this fixture on failure; never issue another model request.
    await writeFile(join(control,'release.json'),JSON.stringify({release:true}))
    await compose('down','--volumes','--remove-orphans')
    if(relayPromise)await relayPromise.catch(()=>{})
  }
}
