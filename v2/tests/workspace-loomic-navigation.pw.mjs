import {test,expect} from '@playwright/test'
import sharp from 'sharp'
import {readFile} from 'node:fs/promises'
const png=await sharp({create:{width:32,height:24,channels:3,background:'#73aa55'}}).png().toBuffer()
async function openCanvas(page){
 await page.route('**/api/user/auth/refresh',route=>route.fulfill({status:401,json:{success:false,message:'未登录'}}))
 await page.route('**/api/studio/models',route=>route.fulfill({json:{success:true,data:{generationEnabled:false,models:[]}}}))
 await page.goto('./canvas')
 await expect(page.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()
 await expect(page.getByText('Loading scene…',{exact:true})).toHaveCount(0)
}
async function importImage(page){await page.locator('input[type="file"]').first().setInputFiles({name:'leave-fixture.png',mimeType:'image/png',buffer:png});await expect(page.getByText('输入你的想法开始创作',{exact:true})).toHaveCount(0)}
test('Loomic sidebar leave awaits final IndexedDB snapshot before debounce',async({page})=>{
 await openCanvas(page);await importImage(page)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'聊天',exact:true}).click()
 await expect(page).toHaveURL(/\/chat$/)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'Loomic 工作台',exact:true}).click()
 await expect(page.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'菜单',exact:true}).click()
 const download=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出画布文件',exact:true}).click()
 const scene=JSON.parse(await readFile(await(await download).path(),'utf8'))
 expect(scene.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1);expect(Object.keys(scene.files)).toHaveLength(1)
})
test('Loomic failed IndexedDB write blocks sidebar leave and retains exportable scene for retry',async({page})=>{
 await openCanvas(page)
 await page.evaluate(()=>{window.originalDraftPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('explicit test write rejection','QuotaExceededError')}})
 await importImage(page)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'聊天',exact:true}).click()
 await expect(page).toHaveURL(/\/canvas(?:\?|$)/);await expect(page.getByRole('alert').filter({hasText:'画布尚未保存'})).toBeVisible()
 await page.getByRole('button',{name:'菜单',exact:true}).click()
 const download=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出画布文件',exact:true}).click()
 const scene=JSON.parse(await readFile(await(await download).path(),'utf8'));expect(scene.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1)
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalDraftPut})
 await page.getByRole('button',{name:'重试保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'画布尚未保存'})).toHaveCount(0)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'聊天',exact:true}).click();await expect(page).toHaveURL(/\/chat$/)
})


async function deleteCurrent(page){
 await page.getByRole('button',{name:'菜单',exact:true}).click()
 await page.getByRole('menuitem',{name:'删除当前项目',exact:true}).click()
 await page.getByRole('menuitem',{name:'确认删除?',exact:true}).click()
}
async function draftExists(page,id){return page.evaluate(async id=>{
 const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('keyval-store');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
 try{return await new Promise((resolve,reject)=>{const request=db.transaction('keyval').objectStore('keyval').get('gouo:loomic:v1:local:guest:'+id);request.onsuccess=()=>resolve(request.result!==undefined);request.onerror=()=>reject(request.error)})}finally{db.close()}
},id)}
test('explicit successful deletion permits leaving a pending scene without resurrecting its draft',async({page})=>{
 await openCanvas(page);await importImage(page);const id=new URL(page.url()).searchParams.get('id')||'draft'
 await deleteCurrent(page);await expect(page).toHaveURL(/\/projects$/)
 expect(await draftExists(page,id)).toBe(false)
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'聊天',exact:true}).click();await expect(page).toHaveURL(/\/chat$/)
 expect(await draftExists(page,id)).toBe(false)
})
test('explicit deletion can discard a scene whose previous save failed',async({page})=>{
 await openCanvas(page);await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('explicit fixture write rejection','QuotaExceededError')}})
 await importImage(page);const id=new URL(page.url()).searchParams.get('id')||'draft'
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'聊天',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'画布尚未保存'})).toBeVisible()
 await deleteCurrent(page);await expect(page).toHaveURL(/\/projects$/);expect(await draftExists(page,id)).toBe(false)
})
test('failed explicit deletion retains the scene and its leave guard',async({page})=>{
 await openCanvas(page);await importImage(page)
 await page.evaluate(()=>{IDBObjectStore.prototype.delete=function(){throw new DOMException('explicit fixture delete rejection','UnknownError')};IDBObjectStore.prototype.put=function(){throw new DOMException('explicit fixture save rejection','QuotaExceededError')}})
 await deleteCurrent(page);await expect(page.getByText('项目删除失败',{exact:true})).toBeVisible()
 await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'聊天',exact:true}).click();await expect(page).toHaveURL(/\/canvas(?:\?|$)/)
 await page.getByRole('button',{name:'菜单',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出画布文件',exact:true}).click()
 const scene=JSON.parse(await readFile(await(await download).path(),'utf8'));expect(scene.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1);expect(Object.keys(scene.files)).toHaveLength(1)
})
for(const rejectWrites of [false,true])test(`owner remount preserves latest Loomic scene with ${rejectWrites?'rejected':'pending'} local persistence`,async({page})=>{
 let owner=7
 await page.route('**/api/user/auth/refresh',route=>route.fulfill({json:{success:true,data:{access_token:'fixture-owner-'+owner,token_type:'Bearer',access_expires_at:Math.floor(Date.now()/1000)+600,session:{sid:'fixture-'+owner},user:{id:owner,username:'owner'+owner,display_name:'owner'+owner}}}}))
 await page.route('**/api/user/self',route=>route.fulfill({json:{success:true,data:{id:owner,username:'owner'+owner,display_name:'owner'+owner}}}))
 await page.route('**/api/studio/models',route=>route.fulfill({json:{success:true,data:{generationEnabled:false,models:[]}}}))
 await page.goto('./canvas');await expect(page.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()
 const id=new URL(page.url()).searchParams.get('id')||'draft'
 await page.evaluate(async id=>{const drafts=await import('/studio/src/loomic/lib/local-drafts.ts');await drafts.changeDraft('local:7',id,d=>{d.fixtureUnknown={preserved:true};d.canvas.fixtureCanvasUnknown='keep';d.sessions.push({id:'fixture-preserve',title:'保留旧会话',updatedAt:'2000-01-01T00:00:00Z'});d.messages['fixture-preserve']=[{id:'old-message',role:'user',content:'保留旧消息',contentBlocks:[],createdAt:'2000-01-01T00:00:00Z'}]})},id)
 if(rejectWrites)await page.evaluate(()=>{window.originalDraftPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('explicit owner fallback fixture','QuotaExceededError')}})
 await importImage(page)
 async function switchOwner(next){owner=next;await page.evaluate(()=>{const channel=new BroadcastChannel('gouo-studio-identity');channel.postMessage('identity-invalidated');channel.close()});await expect(page.getByRole('heading',{name:'会话暂时无法恢复'})).toBeVisible();await page.getByRole('button',{name:'重新恢复会话'}).click();await expect(page.getByRole('button',{name:'New API 账号',exact:true})).toContainText('owner'+next);await expect(page.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()}
 await switchOwner(8)
 async function exportedScene(){await page.getByRole('button',{name:'菜单',exact:true}).click();const waiting=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出画布文件',exact:true}).click();return JSON.parse(await readFile(await(await waiting).path(),'utf8'))}
 expect((await exportedScene()).elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(0)
 await switchOwner(7)
 if(rejectWrites)await expect(page.getByRole('alert').filter({hasText:'当前页面进程内保留'})).toBeVisible()
 const restored=await exportedScene();expect(restored.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1);expect(Object.keys(restored.files)).toHaveLength(1)
 const original=await page.evaluate(async id=>{const drafts=await import('/studio/src/loomic/lib/local-drafts.ts');return drafts.readDraft('local:7',id)},id)
 expect(original.fixtureUnknown).toEqual({preserved:true});expect(original.canvas.fixtureCanvasUnknown).toBe('keep');expect(original.sessions.some(s=>s.id==='fixture-preserve')).toBe(true);expect(original.messages['fixture-preserve'][0].id).toBe('old-message')
 if(rejectWrites){await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalDraftPut});await page.getByRole('button',{name:'重试保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'画布尚未保存'})).toHaveCount(0)}
})
