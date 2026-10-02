import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createServer } from '../src/server.mjs'
const auth = async (_url, init) => Response.json({ success: true, data: { id: init.headers.Authorization === 'Bearer owner' ? 7 : 8 } })
const config = ledgerPath => ({ ledgerPath, authOrigin: 'http://fixture.invalid', gateway: 'http://fixture.invalid/v1', relayOwnerId: 7, relayKey: 'fixture', allowGeneration: true, models: [{ id: 'chat', kind: 'chat', enabled: true, verification: 'live-verified' }] })
const call = (app, method, path, payload, owner = 'owner') => app.inject({ method, url: '/api/studio/' + path, ...(owner ? { headers: { authorization: 'Bearer ' + owner, ...(path === 'runs' ? { 'idempotency-key': payload.runId } : {}) } } : {}), ...(payload !== undefined ? { payload } : {}) })
async function source(app) {
  const threadId = (await call(app, 'POST', 'threads', {})).json().data.id, runId = crypto.randomUUID()
  await call(app, 'POST', 'runs', { runId, threadId, sessionId: 's', conversationId: 'c', model: 'chat', prompt: 'image' })
  return { runId, toolCallId: 'tool', artifactIndex: 0 }
}
const png = async () => 'data:image/png;base64,' + (await sharp({ create: { width: 2, height: 3, channels: 4, background: '#ff0000' } }).png().toBuffer()).toString('base64')
test('owner isolation, deduplication, CAS and restart/backup preserve immutable assets and history', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'projects-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'ledger.db'), image = await png()
  let generated = 0
  const overrides = { fetch: auth, runAgent: async (_c, _m, body) => { generated++; return { events: [{ type: 'tool.completed', runId: body.runId, toolCallId: 'tool', artifacts: [{ type: 'image', url: image }] }, { type: 'run.failed', runId: body.runId }] } } }
  let app = createServer(config(path), overrides)
  const src = await source(app), responses = await Promise.all([call(app, 'POST', 'assets/from-run', src), call(app, 'POST', 'assets/from-run', src)])
  const asset = responses[0].json().data
  assert.equal(asset.id, responses[1].json().data.id); assert.equal(asset.width, 2)
  for (const owner of ['other', null]) {
    assert.equal((await call(app, 'GET', 'assets/' + asset.id, undefined, owner)).statusCode, owner ? 404 : 401)
    assert.equal((await call(app, 'POST', 'assets/from-run', src, owner)).statusCode, owner ? 404 : 401)
  }
  const project = (await call(app, 'POST', 'projects/from-asset', { assetId: asset.id })).json().data
  assert.equal(project.id, (await call(app, 'POST', 'projects/from-asset', { assetId: asset.id })).json().data.id)
  assert.equal((await call(app, 'GET', 'projects/' + project.id, undefined, 'other')).statusCode, 404)
  const document = { elements: [{ id: 'i', type: 'image', fileId: 'f' }], appState: {}, files: { f: { id: 'f', assetId: asset.id, dataURL: image } }, processedSourceIds: [asset.id] }
  const edits = await Promise.all([call(app, 'PATCH', 'projects/' + project.id, { expectedRevision: 1, document }), call(app, 'PATCH', 'projects/' + project.id, { expectedRevision: 1, document, title: 'race' })])
  assert.deepEqual(edits.map(r => r.statusCode).sort(), [200,409])
  assert.deepEqual((await call(app, 'GET', 'projects/' + project.id)).json().data.document, document)
  const other = (await call(app, 'POST', 'projects', {}, 'other')).json().data
  assert.equal((await call(app, 'PATCH', 'projects/' + other.id, { expectedRevision: 1, document }, 'other')).statusCode, 404)
  await app.close(); copyFileSync(path, join(dir, 'backup.db'))
  for (const db of [path, join(dir, 'backup.db')]) {
    app = createServer(config(db), overrides)
    assert.deepEqual((await call(app, 'GET', 'projects/' + project.id)).json().data.document, document)
    assert.equal((await call(app, 'GET', 'assets/' + asset.id)).json().data.dataURL, image)
    assert.equal((await call(app, 'POST', 'assets/from-run', src)).json().data.id, asset.id)
    assert.equal((await call(app, 'GET', 'runs/' + src.runId)).json().data.events.length, 2)
    await app.close()
  }
  assert.equal(generated,1)
})
test('no arbitrary URL materialization; malformed bytes, MIME mismatch, references and paging rejected/bounded', async t => {
  let image = ''
  const app = createServer(config(':memory:'), { fetch: auth, runAgent: async () => ({ events: [{ type: 'tool.completed', toolCallId: 'tool', artifacts: [{ type: 'image', url: image }] }, { type: 'run.completed' }] }) }); t.after(() => app.close())
  for (const value of ['https://private.invalid/', 'data:image/png;base64,bm90YW5pbWFnZQ==', (await png()).replace('image/png','image/jpeg')]) {
    image = value; const src = await source(app)
    assert.equal((await call(app,'POST','assets/from-run',src)).statusCode,400)
    assert.equal((await call(app,'POST','assets/from-run',{ ...src,url: await png() })).statusCode,400)
  }
  assert.equal((await call(app,'POST','projects',{},null)).statusCode,401)
  const id = (await call(app,'POST','projects',{})).json().data.id
  for (const document of [{ elements: [],appState:{},files:{ a:{dataURL:image} } },{ elements:[],appState:{},files:{ a:{assetId:crypto.randomUUID()} } },{ elements:[{type:'image',fileId:'missing'}],appState:{},files:{} }]) assert.ok([400,404].includes((await call(app,'PATCH','projects/'+id,{expectedRevision:1,document})).statusCode))
  assert.equal((await call(app,'GET','projects?offset=-1')).statusCode,400)
  for(let i=0;i<50;i++) await call(app,'POST','projects',{})
  assert.equal((await call(app,'GET','projects')).json().data.nextOffset,50)
  assert.equal((await call(app,'GET','projects?offset=50')).json().data.items.length,1)
})
test('unknown partial image is materializable without new provider execution',async t=>{
  const image=await png()
  const app=createServer(config(':memory:'),{fetch:auth,runAgent:async context=>{context.onEvent({type:'tool.completed',toolCallId:'tool',artifacts:[{type:'image',url:image}]});throw new Error('lost response')}});t.after(()=>app.close())
  const src=await source(app)
  assert.equal((await call(app,'GET','runs/'+src.runId)).json().data.status,'unknown')
  assert.equal((await call(app,'POST','assets/from-run',src)).statusCode,200)
})

test('oversized image pixels and truncated full decode are rejected',async t=>{
  let image=''
  const app=createServer(config(':memory:'),{fetch:auth,runAgent:async()=>({events:[{type:'tool.completed',toolCallId:'tool',artifacts:[{type:'image',url:image}]},{type:'run.completed'}]})});t.after(()=>app.close())
  const large=await sharp({create:{width:5000,height:5000,channels:3,background:'#fff'}}).png().toBuffer()
  const valid=Buffer.from((await png()).split(',')[1],'base64')
  for(const bytes of [large,valid.subarray(0,valid.length-25)]){
    image='data:image/png;base64,'+bytes.toString('base64')
    assert.equal((await call(app,'POST','assets/from-run',await source(app))).statusCode,400)
  }
})
