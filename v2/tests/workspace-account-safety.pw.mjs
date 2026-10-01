import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'
import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
const image = await sharp({create:{width:32,height:24,channels:3,background:'#5599aa'}}).png().toBuffer()
async function setup(page,canvas=false){
 const account=await mockAccount(page);account.active=true
 await page.route('**/api/studio/models',route=>route.fulfill({json:{success:true,data:{generationEnabled:false,models:[]}}}))
 await page.goto(canvas?'./canvas':'./chat')
 await expect(page.getByRole('button',{name:'New API 账号',exact:true}).first()).toContainText('测试用户')
 if(canvas)await expect(page.getByRole('button',{name:'本地保存',exact:true})).toBeEnabled()
 return account
}
async function dirty(page){await page.locator('input[type="file"]').first().setInputFiles({name:'account-leave-fixture.png',mimeType:'image/png',buffer:image});await expect(page.getByText('输入你的想法开始创作',{exact:true})).toHaveCount(0)}
test('logout refuses a failed local save before any Native mutation and preserves image export',async({page})=>{
 await setup(page,true)
 await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('explicit logout write rejection','QuotaExceededError')}})
 await dirty(page);let logouts=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/user/auth/logout')logouts++})
 const panel=await openAccountSection(page);await panel.getByRole('button',{name:'退出登录',exact:true}).click()
 await expect(panel.getByText('画布尚未保存，已留在当前页面。请重试保存或导出备份后再退出。',{exact:true})).toBeVisible();expect(logouts).toBe(0)
 await closeAccount(page);await page.getByRole('button',{name:'菜单',exact:true}).click();const waiting=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出画布文件',exact:true}).click()
 const exported=JSON.parse(await readFile(await(await waiting).path(),'utf8'));expect(exported.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1);expect(Object.keys(exported.files)).toHaveLength(1)
})
test('successful logout flushes the owner draft once without a document reload',async({page})=>{
 await setup(page,true);await dirty(page);const id=new URL(page.url()).searchParams.get('id')||'draft'
 let documents=0,logouts=0;page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++;if(new URL(r.url()).pathname==='/api/user/auth/logout')logouts++})
 const panel=await openAccountSection(page);await panel.getByRole('button',{name:'退出登录',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'账号与设置',exact:true})).not.toBeVisible();expect(logouts).toBe(1);expect(documents).toBe(0)
 const guest=await openAccountSection(page);await expect(guest.getByText('前往 New API 登录',{exact:true})).toBeVisible()
 const draft=await page.evaluate(async id=>{const d=await import('/studio/src/loomic/lib/local-drafts.ts');return d.readDraft('local:7',id)},id)
 expect(draft.canvas.content.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1);expect(Object.keys(draft.canvas.content.files)).toHaveLength(1)
})
test('unknown profile write survives closing and reload then resolves through an explicit read only',async({page})=>{
 await setup(page);let writes=0,displayName='测试用户'
 await page.route('**/api/studio/profile',route=>{writes++;expect(route.request().method()).toBe('PUT');expect(route.request().postDataJSON()).toEqual({display_name:'明确本地名称'});displayName='明确本地名称';return route.abort()})
 await page.route('**/api/user/self',route=>route.fulfill({json:{success:true,data:{id:7,username:'studio-user',display_name:displayName}}}))
 let panel=await openAccountSection(page);await panel.getByLabel('显示名称',{exact:true}).fill('明确本地名称');await panel.getByRole('button',{name:'更新显示名称',exact:true}).click()
 await expect(panel.getByRole('alert').filter({hasText:'显示名称更新未确认'})).toBeVisible();expect(writes).toBe(1)
 const intent=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('gouo:profile-intent:v1:7')));expect(Object.keys(intent).sort()).toEqual(['displayName','owner','state']);expect(intent.state).toBe('unknown')
 await closeAccount(page);panel=await openAccountSection(page);await expect(panel.getByRole('button',{name:'更新显示名称',exact:true})).toBeDisabled();expect(writes).toBe(1)
 await page.reload();await expect(page.getByRole('button',{name:'New API 账号',exact:true}).first()).toContainText(displayName);panel=await openAccountSection(page);await expect(panel.getByRole('button',{name:'更新显示名称',exact:true})).toBeDisabled();expect(writes).toBe(1)
 await panel.getByRole('button',{name:'读取本人资料核对',exact:true}).click();await expect(panel.getByText('显示名称已核对',{exact:true})).toBeVisible();expect(writes).toBe(1);expect(await page.evaluate(()=>sessionStorage.getItem('gouo:profile-intent:v1:7'))).toBeNull()
})
for(const failure of ['corrupt','unwritable'])test(`profile protection ${failure} fails closed before a PUT`,async({page})=>{
 await setup(page);let writes=0;await page.route('**/api/studio/profile',route=>{writes++;return route.abort()})
 if(failure==='corrupt')await page.evaluate(()=>sessionStorage.setItem('gouo:profile-intent:v1:7','{invalid'))
 else await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('gouo:profile-intent:'))throw new DOMException('explicit storage rejection','QuotaExceededError');return original.call(this,key,value)}})
 const panel=await openAccountSection(page)
 if(failure==='corrupt')await expect(panel.getByRole('button',{name:'更新显示名称',exact:true})).toBeDisabled()
 else {await panel.getByLabel('显示名称',{exact:true}).fill('明确本地名称');await panel.getByRole('button',{name:'更新显示名称',exact:true}).click();await expect(panel.getByRole('alert').filter({hasText:'保护记录不可用'})).toBeVisible()}
 expect(writes).toBe(0)
})
test('Native services open isolated same-origin tabs and no misleading admin entry',async({page})=>{
 await setup(page);const panel=await openAccountSection(page,'profile');const services=panel.getByRole('navigation',{name:'New API 账号服务',exact:true})
 for(const path of ['/profile','/security','/keys','/wallet','/usage-logs']){const link=services.locator(`a[href="${path}"]`);await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener noreferrer');expect(await link.evaluate(a=>new URL(a.href).origin)).toBe(new URL(page.url()).origin)}
 await expect(panel.locator('a[href="/users"]')).toHaveCount(0)
})

test('profile read with a different name cannot unlock an ambiguous write',async({page})=>{
 await setup(page);let writes=0
 await page.route('**/api/studio/profile',route=>{writes++;return route.abort()})
 const panel=await openAccountSection(page);await panel.getByLabel('显示名称',{exact:true}).fill('待核对的名称');await panel.getByRole('button',{name:'更新显示名称',exact:true}).click()
 await expect(panel.getByRole('alert').filter({hasText:'显示名称更新未确认'})).toBeVisible()
 await panel.getByRole('button',{name:'读取本人资料核对',exact:true}).click();await expect(panel.getByRole('alert').filter({hasText:'继续保留未确认状态'})).toBeVisible()
 await expect(panel.getByRole('button',{name:'更新显示名称',exact:true})).toBeDisabled();expect(writes).toBe(1)
 expect(await page.evaluate(()=>sessionStorage.getItem('gouo:profile-intent:v1:7'))).not.toBeNull()
})
test('996px closed Loomic chat leaves the top account button clickable with the image intact',async({page})=>{
 await page.setViewportSize({width:996,height:900});await setup(page,true);await dirty(page)
 await page.getByRole('button',{name:'打开账号设置',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'账号与设置',exact:true});await expect(dialog).toBeVisible();await closeAccount(page)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.getByRole('button',{name:'菜单',exact:true}).click();const waiting=page.waitForEvent('download');await page.getByRole('menuitem',{name:'导出画布文件',exact:true}).click()
 const exported=JSON.parse(await readFile(await(await waiting).path(),'utf8'));expect(exported.elements.filter(e=>e.type==='image'&&!e.isDeleted)).toHaveLength(1);expect(Object.keys(exported.files)).toHaveLength(1)
})
