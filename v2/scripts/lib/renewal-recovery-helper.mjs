import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renewalTargetSchema, retirementProofSchema } from '../../apps/api/src/relay-renewals.mjs'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = message => { throw new Error(message) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const binaryHashes = new Set(['a5fd598cc77e26ab2709305049fdd5fbbff722111be79f0ad89a493c3e094529', '8689cc98471806eb03093849abdcfe974e582b85571b44da0d1816b21b360227'])
const fields = ['id','user_id','name','status','remain_quota','used_quota','expired_time','created_time','accessed_time','unlimited_quota','model_limits_enabled','model_limits','allow_ips','group','cross_group_retry','auto_groups','deleted_at']
const tokenSQL = fields.map(field => `"${field}"`).join(',')
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b)
const parseJSON = value => { try { return JSON.parse(value) } catch { fail('Recovery JSON is invalid; no raw data is disclosed') } }

// The host observes process lifetime; this isolated helper never has Docker or
// network access. Native files are opened read-only and keys are never selected.
export class RenewalRecoverySession {
  constructor(path, owner, instanceId, { nativePath = '/native/new-api.db', logPath = nativePath, currentApproval } = {}) {
    if (!Number.isSafeInteger(owner) || owner <= 0 || !/^[0-9a-f-]{36}$/.test(instanceId)) fail('Invalid recovery identity')
    this.path=path; this.owner=owner; this.instanceId=instanceId; this.nativePath=nativePath; this.logPath=logPath; this.nonce=randomUUID()
    try {
      this.lock=new DatabaseSync(`${path}.process-lock`); this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
      this.db=new DatabaseSync(path,{readOnly:true}); this.inspect(currentApproval)
    } catch(error) { this.close(); throw error }
  }
  inspect(currentApproval) {
    if(currentApproval!==undefined) {
      if(!exact(currentApproval,['instanceId','quotaCap','lifetimeSeconds','policyHash','modelLimits'])||Object.keys(currentApproval).length!==5
        ||currentApproval.instanceId!==this.instanceId||!Number.isSafeInteger(currentApproval.quotaCap)||currentApproval.quotaCap<=0
        ||!Number.isSafeInteger(currentApproval.lifetimeSeconds)||currentApproval.lifetimeSeconds<60||currentApproval.lifetimeSeconds>31536000
        ||! /^[0-9a-f]{64}$/.test(currentApproval.policyHash??'')||typeof currentApproval.modelLimits!=='string'||!currentApproval.modelLimits
        ||currentApproval.modelLimits!==[...new Set(currentApproval.modelLimits.split(','))].sort().join(',')) fail('Current approval invalid')
      if(this.currentApproval) fail('Current approval is already fixed for this recovery session')
      this.currentApproval=Object.fromEntries(['instanceId','quotaCap','lifetimeSeconds','policyHash','modelLimits'].map(field=>[field,currentApproval[field]]))
    }
    if (this.db.prepare('SELECT instance_id FROM trial_installation WHERE id=1').get()?.instance_id !== this.instanceId) fail('Ledger instance mismatch')
    const hasProof=this.db.prepare('PRAGMA table_info(relay_renewals)').all().some(column=>column.name==='proof')
    const rows=this.db.prepare(`SELECT owner,key,hash,old_id,target,status,result,${hasProof?'proof':'NULL AS proof'} FROM relay_renewals WHERE owner=? AND status IN ('pending','unknown')`).all(this.owner)
    if(rows.length!==1) fail('Exactly one unresolved renewal is required')
    const row={...rows[0]}, binding=this.db.prepare('SELECT token_id,token_name FROM relay_bindings WHERE owner=?').get(this.owner)
    let target=parseJSON(row.target), proof=row.proof===null?null:parseJSON(row.proof)
    if(target.version===2) {
      if(!renewalTargetSchema.safeParse(target).success||(proof!==null&&!retirementProofSchema.safeParse(proof).success)) fail('Immutable renewal approval schema invalid')
      if(proof && Object.entries(target.oldMetadata).some(([field,value])=>!['status','accessed_time'].includes(field)&&!same(proof.metadata[field],value))) fail('Retirement proof differs from immutable old metadata')
    } else {
      if(!exact(target,['version','name','quota','expiredTime'])||(target.version!==undefined&&target.version!==1)) fail('Unsupported immutable approval version or fields')
      target={version:1}; proof=null
    }
    const oldBinding=binding?{id:binding.token_id,name:binding.token_name}:null
    return { owner:this.owner,instanceId:this.instanceId,session:this.nonce,hash:digest({instanceId:this.instanceId,row,oldBinding,currentApproval:this.currentApproval}),row:{status:row.status,oldId:row.old_id},target,proof,oldBinding,...(this.currentApproval?{currentApproval:this.currentApproval}:{}) }
  }
  guard(expectedHash,session) {
    if(this.done || session!==this.nonce || !/^[0-9a-f]{64}$/.test(expectedHash)) fail('Recovery nonce or expected hash invalid')
    const snapshot=this.inspect(); if(snapshot.hash!==expectedHash) fail('Renewal row or binding changed')
    return snapshot
  }
  validateReceipt(receipt,started=false) {
    if(!exact(receipt,['version','session','instanceId','containerId','imageId','binarySha256','oldStartedAt','stopped','started','nativeDate','project','networkId','privateTokenIngressConfirmed'])
      ||receipt.version!==1||receipt.session!==this.nonce||(started&&receipt.instanceId!==this.instanceId)
      ||! /^[0-9a-f]{64}$/.test(receipt.containerId??'')||! /^sha256:[0-9a-f]{64}$/.test(receipt.imageId??'')
      ||!binaryHashes.has(receipt.binarySha256)||typeof receipt.oldStartedAt!=='string'||!receipt.oldStartedAt
      ||!exact(receipt.stopped,['running','pid','finishedAt'])||receipt.stopped.running!==false||receipt.stopped.pid!==0) fail('Observed stop receipt invalid')
    if(started && (!exact(receipt.started,['running','healthy','pid','startedAt'])||receipt.started.running!==true||receipt.started.healthy!==true
      ||!Number.isSafeInteger(receipt.started.pid)||receipt.started.pid<=0||typeof receipt.started.startedAt!=='string'||!receipt.started.startedAt||receipt.started.startedAt===receipt.oldStartedAt
      ||!Number.isSafeInteger(receipt.nativeDate)||receipt.nativeDate<=0)) fail('Observed new boot and Native Date required')
  }
  metadata(snapshot) {
    const db=new DatabaseSync(this.nativePath,{readOnly:true}), logs=this.logPath===this.nativePath?db:new DatabaseSync(this.logPath,{readOnly:true})
    try {
      const target=snapshot.target
      if(typeof target.approved?.name!=='string') fail('Immutable target name missing')
      const tokens=db.prepare(`SELECT ${tokenSQL} FROM tokens WHERE name=? OR id=? ORDER BY id`).all(target.approved.name,snapshot.row.oldId).map(row=>{
        const value={...row}; for(const field of ['unlimited_quota','model_limits_enabled','cross_group_retry']) { if(![0,1].includes(value[field])) fail('Invalid Native boolean'); value[field]=value[field]===1 }
        value.auto_groups=value.auto_groups===''||value.auto_groups===null?[]:parseJSON(value.auto_groups)
        return value
      })
      const ids=tokens.filter(row=>row.name===target.approved.name).map(row=>row.id)
      const consume=ids.map(id=>({tokenId:id,...logs.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(quota),0) AS quota FROM logs WHERE token_id=? AND type=2').get(id)}))
      const account=db.prepare('SELECT id,status,"group" FROM users WHERE id=?').get(this.owner)
      if(!account||account.id!==this.owner||account.status!==1||typeof account.group!=='string'||!account.group||account.group==='auto') fail('Native owner status/group invalid')
      const options=db.prepare("SELECT key,value FROM options WHERE key IN ('RetryTimes') ORDER BY key").all()
      if(options.length!==1||options[0].value!=='0') fail('Native RetryTimes=0 evidence required')
      if(tokens.some(row=>!Number.isSafeInteger(row.id)||row.id<=0||!Number.isSafeInteger(row.user_id)||row.user_id<=0||!Number.isSafeInteger(row.used_quota)||row.used_quota<0)
        ||consume.some(row=>!Number.isSafeInteger(row.count)||row.count<0||!Number.isSafeInteger(row.quota)||row.quota<0)) fail('Native metadata integers invalid')
      return {account:{...account},tokens,consume,options:options.map(row=>({...row}))}
    } finally { if(logs!==db) logs.close(); db.close() }
  }
  readNative(expectedHash,session,phase,receipt) {
    const snapshot=this.guard(expectedHash,session); this.validateReceipt(receipt,phase==='started')
    if(phase==='stopped') {
      if(this.stopped) fail('Stopped snapshot already taken')
      this.stopped={metadata:this.metadata(snapshot),receipt:structuredClone(receipt)}
      return {phase,metadataHash:digest(this.stopped.metadata),metadata:this.stopped.metadata}
    }
    if(phase!=='started'||!this.stopped||this.started) fail('Invalid snapshot phase')
    for(const field of ['containerId','imageId','binarySha256','oldStartedAt']) if(receipt[field]!==this.stopped.receipt[field]) fail('Native identity changed')
    const metadata=this.metadata(snapshot); if(!same(metadata,this.stopped.metadata)) fail('Native metadata changed across restart')
    this.started={metadata,receipt:structuredClone(receipt)}
    return {phase,metadataHash:digest(metadata),metadata}
  }
  resolve(expectedHash,session,action,receipt) {
    const snapshot=this.guard(expectedHash,session); this.validateReceipt(receipt,true)
    if(!this.started||!same(receipt,this.started.receipt)) fail('Exact observed snapshot receipt required')
    if(receipt.privateTokenIngressConfirmed!==true) fail('Private token ingress confirmation required')
    const target=snapshot.target, proof=snapshot.proof, metadata=this.started.metadata
    if(target.version!==2||target.instanceId!==this.instanceId||target.owner!==this.owner||target.oldBinding?.id!==snapshot.row.oldId
      ||(snapshot.oldBinding?!same(target.oldBinding,snapshot.oldBinding):target.oldBinding.name!=='gouo-studio')) fail('Version 2 immutable identity required')
    if(!same(this.currentApproval,{instanceId:target.instanceId,quotaCap:target.limits.quotaCap,lifetimeSeconds:target.limits.lifetimeSeconds,policyHash:target.policyHash,modelLimits:target.approved.model_limits})) fail('Current approval no longer matches immutable target')
    const old=metadata.tokens.find(row=>row.id===snapshot.row.oldId), now=receipt.nativeDate
    if(!old||old.deleted_at!==null||old.user_id!==this.owner||old.name!==target.oldBinding.name||!proof||proof.version!==1
      ||!['hard-expired','exhausted-status','exhausted-auth-rejection'].includes(proof.kind)||!Number.isSafeInteger(proof.nativeNow)
      ||!(old.expired_time<now||(old.status===4&&old.remain_quota<=0))) fail('Old token retirement evidence invalid')
    for(const [field,value] of Object.entries(proof.metadata)) {
      const normalized=field==='auto_groups'&&value===null?[]:field==='allow_ips'&&value===null?'':value
      const actual=field==='allow_ips'&&old[field]===null?'':old[field]
      if(!same(actual,normalized)) fail('Old token no longer matches persisted retirement proof')
    }
    if(proof.metadata.id!==target.oldBinding.id||proof.metadata.user_id!==this.owner||[...new Set(proof.metadata.model_limits.split(','))].sort().join(',')!==target.approved.model_limits
      ||proof.nativeNow<target.approvedNativeNow||now<proof.nativeNow) fail('Retirement proof identity or time changed')
    const targets=metadata.tokens.filter(row=>row.name===target.approved.name)
    let binding
    if(action==='adopt') {
      if(targets.length!==1) fail('Target is absent, duplicate or cross-owner')
      const token=targets[0]
      if(token.user_id!==this.owner||token.deleted_at!==null||token.status!==1||token.used_quota!==0||token.expired_time<=now
        ||token.expired_time>now+target.limits.lifetimeSeconds+5||token.remain_quota<=0||token.remain_quota>target.limits.quotaCap
        ||metadata.consume.some(row=>row.count!==0||row.quota!==0)||metadata.account?.status!==1) fail('Target is not unused finite active permission')
      for(const [field,value] of Object.entries(target.approved)) if(!same(token[field],value)) fail('Target does not match immutable approval')
      if(this.db.prepare('SELECT 1 FROM relay_bindings WHERE token_id=?').get(token.id)) fail('Target is already bound')
      binding={id:token.id,name:token.name}
    } else if(action==='close-empty') { if(targets.length!==0) fail('Only an entirely absent target may close empty') }
    else fail('Unsupported recovery action')
    this.db.close(); this.db=new DatabaseSync(this.path); this.db.exec('BEGIN IMMEDIATE')
    try {
      this.guard(expectedHash,session)
      this.done=true
      this.db.exec('CREATE TABLE IF NOT EXISTS renewal_recoveries(id TEXT PRIMARY KEY,owner INTEGER NOT NULL,original_hash TEXT NOT NULL,action TEXT NOT NULL,evidence TEXT NOT NULL,reconciled_at TEXT NOT NULL)')
      const recoveryId=randomUUID(),time=new Date().toISOString()
      this.db.prepare('INSERT INTO renewal_recoveries VALUES(?,?,?,?,?,?)').run(recoveryId,this.owner,expectedHash,action,JSON.stringify({receipt,metadata,metadataHash:digest(metadata),currentApproval:this.currentApproval,oldBinding:snapshot.oldBinding,immutableTargetHash:digest(target),retirementProofHash:digest(proof)}),time)
      const status=action==='adopt'?'adopted':'reconciled_empty'
      const changed=this.db.prepare("UPDATE relay_renewals SET status=? WHERE owner=? AND status IN ('pending','unknown') AND target=? AND proof IS ?").run(status,this.owner,JSON.stringify(target),proof===null?null:JSON.stringify(proof))
      if(changed.changes!==1) fail('Renewal CAS failed')
      if(binding) {
        const changedBinding=snapshot.oldBinding
          ?this.db.prepare('UPDATE relay_bindings SET token_id=?,token_name=? WHERE owner=? AND token_id=? AND token_name=?').run(binding.id,binding.name,this.owner,snapshot.oldBinding.id,snapshot.oldBinding.name)
          :this.db.prepare('INSERT INTO relay_bindings(owner,token_id,token_name) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM relay_bindings WHERE owner=?)').run(this.owner,binding.id,binding.name,this.owner)
        if(changedBinding.changes!==1) fail('Binding CAS failed')
      }
      this.db.exec('COMMIT')
      return {owner:this.owner,status,action,recoveryId,...(binding?{binding}:{})}
    } catch(error) {this.db.exec('ROLLBACK');throw error}
  }
  close() {try{this.db?.close();this.db=undefined}finally{this.lock?.close();this.lock=undefined}}
}

async function main() {
  let session,pending=''
  try {
    session=new RenewalRecoverySession(process.argv[2],Number(process.argv[3]),process.argv[4])
    for await(const chunk of process.stdin) {
      pending+=chunk; if(Buffer.byteLength(pending)>32768) fail('Command exceeds limit')
      let index
      while((index=pending.indexOf('\n'))>=0) {
        const command=parseJSON(pending.slice(0,index));pending=pending.slice(index+1)
        const allowed={inspect:['command','currentApproval'],'read-native':['command','expectedHash','session','phase','receipt'],resolve:['command','expectedHash','session','action','receipt'],abort:['command']}[command?.command]
        if(!allowed||!exact(command,allowed)) fail('Unknown command fields')
        if(command.command==='abort') {process.stdout.write('{"ok":true,"aborted":true}\n');return}
        const data=command.command==='inspect'?session.inspect(command.currentApproval):command.command==='read-native'?session.readNative(command.expectedHash,command.session,command.phase,command.receipt):command.command==='resolve'?session.resolve(command.expectedHash,command.session,command.action,command.receipt):fail('Unsupported command')
        process.stdout.write(JSON.stringify({ok:true,data})+'\n')
      }
    }
    if(pending) fail('Incomplete command')
  }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');process.exitCode=1}finally{session?.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main()
