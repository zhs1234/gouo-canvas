import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RenewalRecoverySession } from '../scripts/lib/renewal-recovery-helper.mjs'
import { RelayRenewals } from '../apps/api/src/relay-renewals.mjs'

const instanceId='11111111-2222-4333-8444-555555555555', now=1900000000
const old={id:1,user_id:7,name:'gouo-studio',status:3,remain_quota:5,used_quota:0,expired_time:now-10,created_time:now-100,accessed_time:0,unlimited_quota:false,model_limits_enabled:true,model_limits:'fixture-chat,fixture-image',allow_ips:'',group:'',cross_group_retry:false,auto_groups:[]}
const approved={name:'gouo-studio-'+ 'a'.repeat(32),remain_quota:500,expired_time:now+3600,unlimited_quota:false,model_limits_enabled:true,model_limits:old.model_limits,allow_ips:'',group:'',cross_group_retry:false,auto_groups:[]}
const target={version:2,instanceId,sourceCommit:'0aec08fee811ec6136828fda790551b49e410301',gatewayOrigin:'http://new-api:3000',owner:7,oldBinding:{id:1,name:old.name},oldMetadata:old,approvedNativeNow:now,approved,limits:{quotaCap:500,lifetimeSeconds:3600},policyHash:'d'.repeat(64)}
const proof={version:1,nativeNow:now,kind:'hard-expired',metadata:old}
const currentApproval={instanceId,quotaCap:500,lifetimeSeconds:3600,policyHash:target.policyHash,modelLimits:approved.model_limits}
function fixture(t,{empty=false,version=2}={}) {
  const directory=mkdtempSync(join(tmpdir(),'gouo-renewal-recovery-'))
  const path=join(directory,'studio.db'),nativePath=join(directory,'native.db'),db=new DatabaseSync(path)
  db.exec(`CREATE TABLE trial_installation(id INTEGER PRIMARY KEY,instance_id TEXT);
    CREATE TABLE relay_bindings(owner INTEGER PRIMARY KEY,token_id INTEGER,token_name TEXT);
    CREATE TABLE relay_renewals(owner INTEGER,key TEXT,hash TEXT,old_id INTEGER,target TEXT,status TEXT,result TEXT,proof TEXT,PRIMARY KEY(owner,key));
    CREATE TABLE requests(owner INTEGER,status TEXT,result TEXT);
    CREATE TABLE trial_grants(owner INTEGER,receipt TEXT);
    CREATE TABLE funding_writes(owner INTEGER,preference TEXT,status TEXT);`)
  db.prepare('INSERT INTO trial_installation VALUES(1,?)').run(instanceId)
  db.prepare('INSERT INTO relay_bindings VALUES(7,1,?)').run(old.name)
  db.prepare('INSERT INTO relay_renewals VALUES(7,?,?,1,?,?,NULL,?)').run('original-renewal-key','e'.repeat(64),JSON.stringify(version===2?target:{name:approved.name,quota:500,expiredTime:now+3600}),'unknown',version===2?JSON.stringify(proof):null)
  db.exec("INSERT INTO requests VALUES(7,'completed','unchanged original result'); INSERT INTO trial_grants VALUES(7,'unchanged trial'); INSERT INTO funding_writes VALUES(7,'wallet_only','unknown')")
  const untouched=()=>JSON.stringify({requests:db.prepare('SELECT * FROM requests').all(),trial:db.prepare('SELECT * FROM trial_grants').all(),funding:db.prepare('SELECT * FROM funding_writes').all()})
  const before=untouched()
  const native=new DatabaseSync(nativePath)
  native.exec(`CREATE TABLE tokens(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,status INTEGER,remain_quota INTEGER,used_quota INTEGER,expired_time INTEGER,created_time INTEGER,accessed_time INTEGER,unlimited_quota INTEGER,model_limits_enabled INTEGER,model_limits TEXT,allow_ips TEXT,"group" TEXT,cross_group_retry INTEGER,auto_groups TEXT,deleted_at TEXT,key TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,status INTEGER,"group" TEXT,password TEXT,quota INTEGER);
    CREATE TABLE logs(token_id INTEGER,type INTEGER,quota INTEGER);
    CREATE TABLE options(key TEXT,value TEXT);
    INSERT INTO users VALUES(7,1,'default','forbidden secret',999); INSERT INTO options VALUES('RetryTimes','0');`)
  const insert=value=>native.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...['id','user_id','name','status','remain_quota','used_quota','expired_time','created_time','accessed_time','unlimited_quota','model_limits_enabled','model_limits','allow_ips','group','cross_group_retry','auto_groups','deleted_at','key'].map(field=>['unlimited_quota','model_limits_enabled','cross_group_retry'].includes(field)?Number(value[field]):field==='auto_groups'?JSON.stringify(value[field]):value[field]??null))
  insert({...old,deleted_at:null,key:'never select or output this secret'})
  if(!empty) insert({...old,...approved,id:2,status:1,created_time:now,expired_time:approved.expired_time,deleted_at:null,key:'never select or output target secret'})
  const session=new RenewalRecoverySession(path,7,instanceId,{nativePath,currentApproval})
  t.after(()=>{session.close();native.close();db.close();rmSync(directory,{recursive:true,force:true})})
  return {path,nativePath,db,native,insert,session,untouched,before}
}
function receipt(snapshot,started=false) {
  return {version:1,session:snapshot.session,containerId:'a'.repeat(64),imageId:'sha256:'+'b'.repeat(64),binarySha256:'a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529',oldStartedAt:'old-boot',stopped:{running:false,pid:0,finishedAt:'stopped'},...(started?{instanceId,project:'isolated-fixture',networkId:'private-network',privateTokenIngressConfirmed:true,started:{running:true,healthy:true,pid:20,startedAt:'new-boot'},nativeDate:now+1}:{})}
}
function readBoth(f) {
  const snapshot=f.session.inspect(), stopped=receipt(snapshot),started=receipt(snapshot,true)
  f.session.readNative(snapshot.hash,snapshot.session,'stopped',stopped)
  f.session.readNative(snapshot.hash,snapshot.session,'started',started)
  return {snapshot,started}
}
test('inspection holds continuous Ledger lock and reveals no credentials; Native files remain read-only',t=>{
  const f=fixture(t),snapshot=f.session.inspect(),native=f.session.readNative(snapshot.hash,snapshot.session,'stopped',receipt(snapshot))
  assert.equal(snapshot.target.version,2)
  assert.equal(JSON.stringify({snapshot,native}).includes('secret'),false)
  assert.equal(Object.hasOwn(snapshot,'key'),false)
  assert.equal(Object.hasOwn(native.metadata.account,'quota'),false)
  assert.throws(()=>new RenewalRecoverySession(f.path,7,instanceId,{nativePath:f.nativePath}),/locked/)
  assert.equal(f.untouched(),f.before)
})
test('adopt requires identical stopped/newboot Native evidence and atomically audits/binds without altering business history',t=>{
  const f=fixture(t),{snapshot,started}=readBoth(f)
  const result=f.session.resolve(snapshot.hash,snapshot.session,'adopt',started)
  assert.deepEqual(result.binding,{id:2,name:approved.name})
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'adopted')
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM renewal_recoveries').get().n,1)
  assert.equal(f.untouched(),f.before)
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'adopt',started),/nonce/)
  const renewals=Object.create(RelayRenewals.prototype);renewals.db=f.db
  assert.throws(()=>renewals.replay(7,'original-renewal-key',{}),/同一续用标识|待确认/)
})
test('close-empty supports only completely absent target and retains original binding/key',t=>{
  const f=fixture(t,{empty:true}),{snapshot,started}=readBoth(f)
  assert.equal(f.session.resolve(snapshot.hash,snapshot.session,'close-empty',started).action,'close-empty')
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'reconciled_empty')
  assert.equal(f.db.prepare('SELECT token_id FROM relay_bindings').get().token_id,1)
  assert.equal(f.db.prepare('SELECT key FROM relay_renewals').get().key,'original-renewal-key')
  assert.equal(f.untouched(),f.before)
})
test('legacy unversioned snapshot is inspectable without exposing its unknown fields but cannot be adopted or closed',t=>{
  const f=fixture(t,{version:1}),snapshot=f.session.inspect()
  assert.deepEqual(snapshot.target,{version:1})
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'stopped',receipt(snapshot)),/target name/)
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'unknown')
})
test('original legacy table without proof column can be inspected read-only without schema repair',t=>{
  const f=fixture(t,{version:1});f.db.exec('ALTER TABLE relay_renewals DROP COLUMN proof')
  assert.deepEqual(f.session.inspect().target,{version:1})
  assert.equal(f.db.prepare('PRAGMA table_info(relay_renewals)').all().some(column=>column.name==='proof'),false)
})
for(const [name,mutation] of [
  ['soft-deleted target',f=>f.native.exec("UPDATE tokens SET deleted_at='deleted' WHERE id=2")],
  ['cross-owner target',f=>f.native.exec('UPDATE tokens SET user_id=8 WHERE id=2')],
  ['duplicate target',f=>f.insert({...old,...approved,id:3,status:1,deleted_at:null})],
  ['used target',f=>f.native.exec('UPDATE tokens SET used_quota=1 WHERE id=2')],
  ['consumption log',f=>f.native.exec('INSERT INTO logs VALUES(2,2,0)')],
  ['disabled target',f=>f.native.exec('UPDATE tokens SET status=2 WHERE id=2')],
  ['expired target',f=>f.native.exec(`UPDATE tokens SET expired_time=${now-1} WHERE id=2`)],
  ['permission drift',f=>f.native.exec("UPDATE tokens SET model_limits='other' WHERE id=2")],
  ['already-bound target',f=>f.db.prepare('INSERT INTO relay_bindings VALUES(8,2,?)').run(approved.name)],
  ['old proof drift',f=>f.native.exec('UPDATE tokens SET remain_quota=4 WHERE id=1')],
]) test(`${name} fails closed and close-empty never hides an existing target`,t=>{
  const f=fixture(t);mutation(f);const {snapshot,started}=readBoth(f)
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'adopt',started))
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'close-empty',started))
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'unknown')
  assert.equal(f.untouched(),f.before)
})
test('native hash change, nonce reuse, wrong process receipt, unknown fields and row rotation fail closed',t=>{
  const f=fixture(t),snapshot=f.session.inspect(),stopped=receipt(snapshot),started=receipt(snapshot,true)
  assert.throws(()=>f.session.readNative(snapshot.hash,'other','stopped',stopped))
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'stopped',{...stopped,extra:true}))
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'stopped',{...stopped,stopped:{running:true,pid:1}}))
  f.session.readNative(snapshot.hash,snapshot.session,'stopped',stopped)
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'stopped',stopped))
  f.native.exec('UPDATE tokens SET accessed_time=1 WHERE id=2')
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'started',started),/metadata changed/)
  f.db.exec("UPDATE relay_renewals SET hash='changed'")
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'started',started),/row or binding changed/)
})
test('audit failure rolls back both binding and barrier; no unrelated histories change',t=>{
  const f=fixture(t),{snapshot,started}=readBoth(f)
  f.db.exec("CREATE TABLE renewal_recoveries(id TEXT PRIMARY KEY,owner INTEGER,original_hash TEXT,action TEXT,evidence TEXT,reconciled_at TEXT); CREATE TRIGGER reject_audit BEFORE INSERT ON renewal_recoveries BEGIN SELECT RAISE(ABORT,'audit denied'); END")
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'adopt',started),/audit denied/)
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'unknown')
  assert.equal(f.db.prepare('SELECT token_id FROM relay_bindings').get().token_id,1)
  assert.equal(f.untouched(),f.before)
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'adopt',started),/nonce/)
})
test('current policy and private-ingress confirmation are required; approval cannot be replaced inside a session',t=>{
  const f=fixture(t),{snapshot,started}=readBoth(f)
  assert.throws(()=>f.session.inspect({...currentApproval,quotaCap:501}),/already fixed/)
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'adopt',{...started,privateTokenIngressConfirmed:false}),/receipt/)
  f.session.currentApproval={...currentApproval,quotaCap:501}
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'adopt',started),/row or binding changed/)
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'unknown')
})
test('unknown approval fields and proof drift are rejected without exposing unknown values',t=>{
  const f=fixture(t)
  assert.throws(()=>f.session.inspect({...currentApproval,key:'do not print'}),/Current approval invalid/)
  f.db.prepare('UPDATE relay_renewals SET proof=?').run(JSON.stringify({...proof,metadata:{...old,used_quota:1}}))
  assert.throws(()=>f.session.inspect(),/Retirement proof differs/)
})
test('first renewal without a persisted binding adopts through null-binding CAS, without claiming one previously existed',t=>{
  const f=fixture(t);f.db.exec('DELETE FROM relay_bindings')
  const {snapshot,started}=readBoth(f)
  assert.equal(snapshot.oldBinding,null)
  const result=f.session.resolve(snapshot.hash,snapshot.session,'adopt',started)
  assert.equal(result.status,'adopted')
  assert.equal(f.db.prepare('SELECT token_id FROM relay_bindings').get().token_id,2)
})
test('missing retirement proof and damaged JSON remain blocked, without echoing stored fragments',t=>{
  const f=fixture(t,{empty:true});f.db.exec('UPDATE relay_renewals SET proof=NULL')
  const {snapshot,started}=readBoth(f)
  assert.throws(()=>f.session.resolve(snapshot.hash,snapshot.session,'close-empty',started),/retirement/)
  f.db.prepare('UPDATE relay_renewals SET target=?').run('a secret credential fragment')
  assert.throws(()=>f.session.inspect(),error=>!error.message.includes('secret credential')&&error.message.includes('JSON is invalid'))
})
test('missing SQLite columns and unsupported Native retry configuration are rejected without repair',t=>{
  const f=fixture(t),snapshot=f.session.inspect()
  f.native.exec("UPDATE options SET value='1'")
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'stopped',receipt(snapshot)),/RetryTimes/)
  f.native.exec("UPDATE options SET value='0'; ALTER TABLE tokens DROP COLUMN deleted_at")
  assert.throws(()=>f.session.readNative(snapshot.hash,snapshot.session,'stopped',receipt(snapshot)),/column/)
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'unknown')
})
test('CLI rejects command-specific unknown fields and oversized input without disclosing raw values or writing renewal state',async t=>{
  const f=fixture(t);f.session.close()
  const run=input=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/lib/renewal-recovery-helper.mjs',import.meta.url)),f.path,'7',instanceId],{stdio:['pipe','pipe','pipe']})
    let output='';child.stdout.on('data',chunk=>{output+=chunk});child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.end(input)
  })
  for(const input of [JSON.stringify({command:'inspect',phase:'not allowed'})+'\n','sensitive credential fragment'+ 'x'.repeat(32768)]) {
    const result=await run(input)
    assert.equal(result.code,1)
    assert.equal(result.output.includes('sensitive credential'),false)
    assert.equal(JSON.parse(result.output).ok,false)
  }
  assert.equal(f.db.prepare('SELECT status FROM relay_renewals').get().status,'unknown')
  assert.equal(f.untouched(),f.before)
})
