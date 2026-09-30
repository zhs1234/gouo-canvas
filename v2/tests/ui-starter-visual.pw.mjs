import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { mockAccount } from './account-fixture.mjs'
const output = '/workspace/scratch/gouo-ui-review'
const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const projectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#e5ece6"/><stop offset="1" stop-color="#f5f2e9"/></linearGradient><linearGradient id="b" x2="1"><stop stop-color="#314b3d"/><stop offset=".5" stop-color="#5a7964"/><stop offset="1" stop-color="#304438"/></linearGradient></defs><rect width="800" height="600" fill="url(#bg)"/><ellipse cx="404" cy="516" rx="144" ry="22" fill="#829382" opacity=".2"/><rect x="310" y="169" width="180" height="334" rx="28" fill="url(#b)"/><rect x="343" y="103" width="114" height="84" rx="12" fill="#d9cdb5"/><path d="M354 113v55m10-55v55m10-55v55m10-55v55m10-55v55m10-55v55m10-55v55m10-55v55m10-55v55" stroke="#beaf92" stroke-width="3"/><rect x="329" y="279" width="142" height="146" rx="3" fill="#f0eee4"/><text x="400" y="318" text-anchor="middle" font-family="serif" font-size="27" fill="#34493b">BOTANICA</text><path d="M400 373v-39m0 22q-28-23-28-4q0 15 28 12m0-6q28-23 28-4q0 15-28 12" stroke="#69866f" fill="none" stroke-width="2"/><text x="400" y="402" text-anchor="middle" font-family="sans-serif" font-size="10" letter-spacing="2" fill="#69715f">DAILY CARE · 300 ML</text><text x="40" y="555" font-family="sans-serif" font-size="15" fill="#5a6c5e">UI REVIEW FIXTURE · NO MODEL CALL</text></svg>`
async function fixture(page) {
  const state = await mockAccount(page); state.active = true
  const image = `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')}`
  const threads = [{ id: threadId, title: '植萃洗护 · 主图创意', runs: [{ runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', prompt: '为这款植萃洗护产品设计一组自然、简洁的商品主图。', status: 'completed', events: [{ type: 'message.delta', delta: '### 植萃洗护 · 视觉方向\n建议以 **鼠尾草绿与暖白色** 为主色，让产品成为画面焦点。\n\n- **主图**：干净背景，突出瓶身与品牌\n- **场景图**：自然光与柔和阴影\n- **详情图**：清晰呈现容量与包装细节\n\n下面是用于界面验收的示例素材，可打开画布继续排版。' }, { type: 'tool.completed', toolName: 'generate_image', toolCallId: 'fixture-image', outputSummary: '界面验收替身素材，未调用模型', artifacts: [{ type: 'image', url: image }] }] }] }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '夏日上新 · 海报文案', runs: [] }, { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: '品牌包装 · 配色探索', runs: [] }]
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'fixture-chat', displayName: '界面验收替身 · 非真实模型', kind: 'chat', accessible: true }] } } }))
  await page.route('**/api/studio/threads', route => route.fulfill({ json: { success: true, data: { items: threads, nextOffset: null } } }))
  await page.route('**/api/studio/threads/*', route => route.fulfill({ json: { success: true, data: threads.find(t => new URL(route.request().url()).pathname.endsWith(t.id)) } }))
  await page.route('**/api/studio/runs/stream', route => { throw new Error('视觉验收禁止模型提交') })
  const base = { angle: 0, strokeColor: '#405345', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false }
  const rect = (id,x,y,width,height,color) => ({...base,id,type:'rectangle',x,y,width,height,backgroundColor:color,strokeColor:'transparent'})
  const text = (id,x,y,value,size=24) => ({...base,id,type:'text',x,y,width:550,height:size*1.4,text:value,originalText:value,fontSize:size,fontFamily:2,textAlign:'left',verticalAlign:'top',containerId:null,autoResize:true,lineHeight:1.25})
  const doc = { elements: [rect('panel-a',100,80,480,560,'#f4f5f0'), text('label',125,105,'01 / 商品主图',18), {...base,id:'image-a',type:'image',x:125,y:155,width:430,height:322.5,fileId:'fixture',status:'saved',scale:[1,1],crop:null},text('headline',125,510,'植萃日常，自然焕新',28),text('caption',125,557,'BOTANICA / DAILY CARE',15),rect('panel-b',630,80,530,560,'#f8f6f0'),text('title',665,125,'视觉方向 / Creative Notes',26),text('line1',665,212,'鼠尾草绿 × 暖白色',24),text('line2',665,275,'自然光 · 柔和阴影 · 简洁构图',20),rect('swatch1',665,345,100,78,'#526f5a'),rect('swatch2',785,345,100,78,'#e5ece6'),rect('swatch3',905,345,100,78,'#e4d7bd'),text('note',665,489,'界面验收替身素材 · 未调用模型',18)], files: { fixture: { id:'fixture', dataURL:image,mimeType:'image/png',created:1 } },appState:{viewBackgroundColor:'#ffffff',scrollX:40,scrollY:40,zoom:{value:0.85}},processedSourceIds:[] }
  const project = {id:projectId,title:'植萃洗护 · 主图画布（替身）',revision:1,document:doc}
  await page.route(`**/api/studio/projects/${projectId}`, route => route.fulfill({ json: { success:true,data: route.request().method()==='PATCH' ? {...project,revision:2} : project } }))
}
test('official starter desktop dark and mobile plus official canvas screenshots', async ({page}) => {
  await mkdir(output,{recursive:true});await fixture(page)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(`./chat?thread=${threadId}`)
  await expect(page.getByAltText('生成图片')).toBeVisible()
  await page.getByAltText('生成图片').evaluate(img=>img.decode())
  await page.screenshot({path:`${output}/chat-desktop.png`})
  await page.getByRole('button',{name:'切换主题'}).click()
  await page.waitForTimeout(350) // 等待官方主题过渡，避免截图落在动画中间。
  await page.screenshot({path:`${output}/chat-dark.png`})
  await page.getByRole('button',{name:'切换主题'}).click()
  await page.waitForTimeout(350)
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByLabel('消息',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:`${output}/chat-mobile.png`})
  await page.getByRole('button',{name:'切换侧栏'}).click()
  await expect(page.getByRole('navigation',{name:'会话列表'})).toBeVisible()
  await page.waitForTimeout(350) // 等待官方抽屉进入屏幕。
  await page.screenshot({path:`${output}/chat-mobile-sidebar.png`})
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(`./canvas-lab?project=${projectId}`)
  await expect(page.locator('.excalidraw .App-toolbar')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.screenshot({path:`${output}/canvas-desktop.png`})
  await page.setViewportSize({width:390,height:844})
  await expect(page.locator('.excalidraw')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  expect((await page.locator('.canvas-project-title strong').boundingBox()).height).toBeLessThan(30)
  await page.screenshot({path:`${output}/canvas-mobile.png`})
  expect(errors).toEqual([])
})
