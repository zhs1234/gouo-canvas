import { openAccountSection, closeAccount } from './workspace-account-fixture.mjs'
import { test, expect } from '@playwright/test'
import { mockAccount } from './account-fixture.mjs'
async function setup(page) {
  const account = await mockAccount(page)
  account.active = true
  const threads = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '已有会话', runs: [] }]
  await page.route('**/api/studio/threads', route => {
    if (route.request().method() === 'POST') {
      const thread = { id: crypto.randomUUID(), title: '新会话', runs: [] }; threads.push(thread)
      return route.fulfill({ json: { success: true, data: thread } })
    }
    return route.fulfill({ json: { success: true, data: {items:threads,nextOffset:null} } })
  })
  await page.route('**/api/studio/threads/*', route => {
    const thread = threads.find(t => new URL(route.request().url()).pathname.endsWith(t.id))
    return route.fulfill({ status: thread ? 200 : 404, json: { success: !!thread, data: thread, message: '会话不存在' } })
  })
  await page.route('**/api/studio/models', route => route.fulfill({ json: { success: true, data: { generationEnabled: true, models: [{ id: 'chat', displayName: '测试聊天', kind: 'chat', accessible: true }, { id: 'image', displayName: '测试图片', kind: 'image', accessible: true }] } } }))
  return { account, threads }
}
test('assistant-ui adapter renders structured tools/images and server-backed isolated threads', async ({ page }) => {
  const { threads } = await setup(page)
  let calls = 0
  await page.route('**/api/studio/runs/stream', route => {
    calls++
    const payload = route.request().postDataJSON()
    expect(route.request().headers()['idempotency-key']).toBe(payload.runId)
    expect(payload.imageGenerationPreference.models).toEqual(['image'])
    const events = [ { type: 'message.delta', delta: '正在生成' }, { type: 'tool.started', toolName: 'generate_image', toolCallId: 'tool-1' }, { type: 'tool.completed', toolCallId: 'tool-1', outputSummary: '完成', artifacts: [{ type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==' }] }, { type: 'message.delta', delta: '图片已准备好' }, { type: 'run.completed' } ]
    threads[0].runs.push({runId:payload.runId,prompt:payload.prompt,status:'completed',events})
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(e => `data: ${JSON.stringify({ ...e, runId: payload.runId })}\n\n`).join('') })
  })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await page.getByLabel('消息', { exact: true }).fill('生成测试图片')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('图片已准备好', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '1 次工具调用', exact: true }).click()
  await expect(page.getByText('图片生成工具', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片')).toBeVisible()
  await page.getByRole('button', { name: '＋ 新会话' }).click()
  await expect(page.getByAltText('生成图片')).toHaveCount(0)
  expect(calls).toBe(1)
})
test('assistant-ui error is visible without retry', async ({ page }) => {
  await setup(page)
  let calls = 0
  await page.route('**/api/studio/runs/stream', route => { calls++; return route.fulfill({ status: 503, json: { success: false, message: 'fixture failure' } }) })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await page.getByLabel('消息', { exact: true }).fill('测试错误')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('不会自动重试')
  expect(calls).toBe(1)
})

test('trial exhaustion keeps the specific public reason and native wallet link live and after history restoration', async ({ page }) => {
  const { threads } = await setup(page)
  let calls = 0
  const message = '试用生图次数已用完，请前往 New API 钱包充值并明确授权新请求'
  await page.route('**/api/studio/runs/stream', route => {
    calls++
    const payload = route.request().postDataJSON()
    const events = [{ type: 'message.delta', delta: '已保留的前置聊天回复' }, { type: 'run.failed', error: { code: 'gateway_failed', message } }]
    threads[0].runs.push({ runId: payload.runId, prompt: payload.prompt, status: 'unknown', events })
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify({ ...event, runId: payload.runId })}\n\n`).join('') })
  })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await page.getByLabel('消息', { exact: true }).fill('再次生图')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByText('已保留的前置聊天回复', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往原生钱包充值', exact: true })).toHaveAttribute('href', '/wallet')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByText('已保留的前置聊天回复', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往原生钱包充值', exact: true })).toHaveAttribute('href', '/wallet')
  expect(calls).toBe(1)
})

test('HTTP quota errors expose their safe reason, and failure after a completed tool retains its image in restored history', async ({ page }) => {
  const { threads } = await setup(page)
  let calls = 0
  const message = '账号余额不足，请前往原生钱包充值'
  await page.route('**/api/studio/runs/stream', route => { calls++; return route.fulfill({ status: 402, json: { success: false, message } }) })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await page.getByLabel('消息', { exact: true }).fill('余额不足的明确请求')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往原生钱包充值', exact: true })).toHaveAttribute('href', '/wallet')
  expect(calls).toBe(1)
  threads[0].runs = [{ runId: 'tool-then-failed', prompt: '保留已完成的图片', status: 'unknown', events: [
    { type: 'message.delta', delta: '图片前的部分回复' },
    { type: 'tool.started', toolName: 'generate_image', toolCallId: 'finished-image-tool' },
    { type: 'tool.completed', toolCallId: 'finished-image-tool', outputSummary: '图片已完成', artifacts: [{ type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg==' }] },
    { type: 'run.failed', error: { message: '总结连接中断，任务结果待确认' } },
  ] }]
  await page.reload()
  await expect(page.getByText('总结连接中断，任务结果待确认', { exact: true })).toBeVisible()
  await expect(page.getByText('图片前的部分回复', { exact: true })).toBeVisible()
  await expect(page.getByAltText('生成图片')).toBeVisible()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  expect(calls).toBe(1)
})
test('Stop only stops reception with an explicit billing caveat', async ({ page }) => {
  await setup(page)
  await page.route('**/api/studio/runs/stream', async route => { await new Promise(r => setTimeout(r, 3000)); await route.abort().catch(() => {}) })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await page.getByLabel('消息', { exact: true }).fill('测试停止')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.getByRole('button', { name: '停止接收', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('费用可能继续')
})

test('server history survives reload without regeneration and running or unknown state blocks writes', async ({ page }) => {
  const { threads } = await setup(page)
  threads[0].runs = [{runId:'stored-run',prompt:'原来的问题',status:'running',events:[{type:'message.delta',delta:'保留的部分回复'}]}]
  let calls = 0
  await page.route('**/api/studio/runs/stream', route => {calls++;return route.abort()})
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await expect(page.getByText('保留的部分回复',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled()
  await page.reload()
  await expect(page.getByText('保留的部分回复',{exact:true})).toBeVisible()
  threads[0].runs[0].status='completed'
  await page.getByRole('button',{name:'刷新任务记录'}).click()
  await expect(page.getByLabel('消息',{exact:true})).toBeEnabled()
  threads[0].runs[0].status='unknown'
  await page.reload()
  await expect(page.getByText('服务中断后任务结果未知，无法自动恢复。可新建会话继续；原任务费用仍需核对，刷新仅查询。',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'刷新任务记录'}).click()
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled()
  expect(calls).toBe(0)
})
test('thread switch suppresses late results from old stream', async ({page}) => {
  const {threads}=await setup(page)
  threads.push({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'另一会话',runs:[]})
  let calls=0
  await page.route('**/api/studio/runs/stream',async route=>{
    calls++
    await new Promise(r=>setTimeout(r,1000))
    const runId=route.request().postDataJSON().runId
    await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({type:'message.delta',runId,delta:'迟到内容'})}\n\n`}).catch(()=>{})
  })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await page.getByLabel('消息',{exact:true}).fill('开始旧任务')
  await page.getByRole('button',{name:'发送',exact:true}).click()
  await page.getByRole('button',{name:'另一会话'}).click()
  await expect(page.getByText('今天有什么可以帮你？')).toBeVisible()
  await page.waitForTimeout(1200)
  await expect(page.getByText('迟到内容',{exact:true})).toHaveCount(0)
  expect(calls).toBe(1)
})

test('logout hides server history and login restores the same owner thread', async ({page})=>{
  const {threads}=await setup(page)
  threads[0].runs=[{runId:'saved',prompt:'账号私有问题',status:'completed',events:[{type:'message.delta',delta:'账号私有回答'}]}]
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await expect(page.getByText('账号私有回答',{exact:true})).toBeVisible()
  await openAccountSection(page)
  await page.getByRole('button',{name:'退出登录',exact:true}).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  await expect(page.getByText('登录后即可保存会话并发送创作需求。',{exact:false})).toBeVisible()
  await expect(page.getByText('账号私有回答',{exact:true})).toHaveCount(0)
  await openAccountSection(page)
  await page.getByLabel('用户名',{exact:true}).fill('studio-user')
  await page.getByLabel('密码',{exact:true}).fill('test-password')
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await expect(page.getByText('账号私有回答',{exact:true})).toBeVisible()
})
test('history pagination exposes earlier records without resubmission', async ({page})=>{
  const {threads}=await setup(page)
  await page.route('**/api/studio/threads?offset=50', route=>route.fulfill({json:{success:true,data:{items:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'较早会话'}],nextOffset:null}}}))
  await page.route('**/api/studio/threads', route=>route.fulfill({json:{success:true,data:{items:threads,nextOffset:50}}}))
  await page.route('**/api/studio/threads/*', route=>{
    const earlier=new URL(route.request().url()).searchParams.get('offset')==='50'
    return route.fulfill({json:{success:true,data:{...threads[0],nextOffset:earlier?null:50,runs:[{runId:earlier?'early':'recent',prompt:'问题',status:'completed',events:[{type:'message.delta',delta:earlier?'更早回答':'最新回答'}]}]}}})
  })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await expect(page.getByText('最新回答',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'更多会话'}).click()
  await expect(page.getByRole('button',{name:'较早会话'})).toBeVisible()
  await page.getByRole('button',{name:'查看更早记录'}).click()
  await expect(page.getByText('更早回答',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'返回最新记录'}).click()
  await expect(page.getByText('最新回答',{exact:true})).toBeVisible()
})

const savedImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
const savedRunId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
async function imageHistory(page) {
  const fixture = await setup(page)
  const tool = { type: 'tool.completed', toolCallId: 'saved-tool', artifacts: [{ type: 'image', url: savedImage }] }
  fixture.threads[0].runs = [{ runId: savedRunId, prompt: '保存的图片', status: 'completed', events: [tool, tool] }]
  let generated = 0
  await page.route('**/api/studio/runs/stream', route => { generated++; return route.abort() })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await expect(page.getByAltText('生成图片')).toHaveCount(1)
  return { fixture, generated: () => generated }
}
test('restored duplicate tool output has one image and resolves only its saved source, never regenerates', async ({ page }) => {
  let assetWrites = 0, projectWrites = 0
  const assetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const projectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  await page.route('**/api/studio/assets/from-run', route => {
    assetWrites++
    expect(route.request().postDataJSON()).toEqual({ runId: savedRunId, toolCallId: 'saved-tool', artifactIndex: 0 })
    return route.fulfill({ json: { success: true, data: { id: assetId } } })
  })
  await page.route('**/api/studio/projects/from-asset', route => {
    projectWrites++
    expect(route.request().postDataJSON()).toEqual({ assetId })
    return route.fulfill({ json: { success: true, data: { id: projectId } } })
  })
  await page.route(`**/api/studio/projects/${projectId}`, route => route.fulfill({ status: 404, json: { success: false, message: '测试终点' } }))
  const state = await imageHistory(page)
  await page.reload()
  await expect(page.getByRole('button', { name: '打开画布', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '打开画布', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`canvas-lab\\?project=${projectId}&asset=${assetId}`))
  expect(assetWrites).toBe(1); expect(projectWrites).toBe(1); expect(state.generated()).toBe(0)
})
test('asset persistence failure preserves original and avoids automatic generation or write retries', async ({ page }) => {
  let writes = 0
  await page.route('**/api/studio/assets/from-run', route => { writes++; return route.fulfill({ status: 503, json: { success: false, message: '素材存储暂不可用' } }) })
  const state = await imageHistory(page)
  await page.getByRole('button', { name: '打开画布', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('素材存储暂不可用')
  await expect(page.getByRole('link', { name: '下载原图', exact: true })).toHaveAttribute('href', savedImage)
  await expect(page.getByAltText('生成图片')).toBeVisible()
  expect(writes).toBe(1); expect(state.generated()).toBe(0)
})
test('existing project selection inserts saved asset without creating a project', async ({ page }) => {
  const projectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', assetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  await page.route('**/api/studio/projects?offset=0', route => route.fulfill({ json: { success: true, data: { items: [{ id: projectId, title: '已有私有项目' }], nextOffset: null } } }))
  await page.route('**/api/studio/assets/from-run', route => route.fulfill({ json: { success: true, data: { id: assetId } } }))
  let creates = 0
  await page.route('**/api/studio/projects/from-asset', route => { creates++; return route.abort() })
  await page.route(`**/api/studio/projects/${projectId}`, route => route.fulfill({ status: 404, json: { success: false, message: '测试终点' } }))
  const state = await imageHistory(page)
  await page.getByRole('button', { name: '插入已有画布', exact: true }).click()
  await page.getByRole('button', { name: '已有私有项目', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`canvas-lab\\?project=${projectId}&asset=${assetId}`))
  expect(creates).toBe(0); expect(state.generated()).toBe(0)
})

test('balance consent is omitted by default, captured once and cleared on logout', async ({ page }) => {
  const { threads } = await setup(page)
  const payloads = []
  await page.route('**/api/studio/runs/stream', route => {
    const payload = route.request().postDataJSON()
    payloads.push(payload)
    const events = [{ type: 'message.delta', delta: '回复' + payloads.length }, { type: 'run.completed' }]
    threads[0].runs.push({ runId: payload.runId, prompt: payload.prompt, status: 'completed', events })
    return route.fulfill({ contentType: 'text/event-stream', body: events.map(e => 'data: ' + JSON.stringify({ ...e, runId: payload.runId }) + '\n\n').join('') })
  })
  await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  const checkbox = page.getByRole('checkbox', { name: '本次允许使用本人 New API 余额' })
  await expect(checkbox).not.toBeChecked()
  for (let i = 1; i <= 3; i++) {
    if (i === 2) { await checkbox.focus(); await page.keyboard.press('Space'); await expect(checkbox).toBeChecked() }
    await page.getByLabel('消息', { exact: true }).fill('发送' + i)
    await page.getByLabel('消息', { exact: true }).press('Enter')
    await expect(page.getByText('回复' + i, { exact: true })).toBeVisible()
    await expect(checkbox).not.toBeChecked()
  }
  expect(payloads[0]).not.toHaveProperty('payWithBalance')
  expect(payloads[1].payWithBalance).toBe(true)
  expect(payloads[2]).not.toHaveProperty('payWithBalance')
  await checkbox.check()
  await openAccountSection(page)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '账号与设置', exact: true })).not.toBeVisible()
  await openAccountSection(page)
  await page.getByLabel('用户名', { exact: true }).fill('studio-user')
  await page.getByLabel('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '关闭账号窗口', exact: true }).click()
  await expect(checkbox).not.toBeChecked()
  expect(payloads).toHaveLength(3)
})


for (const state of ['recorded', 'settled', 'pending']) {
  test(`fixture ${state} billing evidence preserves original download without automatic resend`, async ({ page }) => {
    const { threads } = await setup(page)
    const usage = { state, settlementState: 'unconfirmed', cost: 0.25, currency: 'CNY', requestCount: 3 }
    threads[0].runs = [{ runId: savedRunId, prompt: '金额证据测试', status: 'completed', usage, events: [
      { type: 'message.delta', delta: '保留真实输出' },
      { type: 'tool.completed', toolCallId: 'saved-tool', artifacts: [{ type: 'image', url: savedImage }] },
    ] }]
    let sends = 0
    await page.route('**/api/studio/runs/stream', route => { sends++; return route.abort() })
    await page.goto('./chat?thread=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    const evidence = page.getByLabel('调用记录', { exact: true })
    await expect(evidence).toHaveText(state === 'pending'
      ? '调用记录尚不完整；金额与实扣待核对，不会自动重发。'
      : '调用记录折算：¥0.25（3 次模型调用）；实扣待核对。')
    await expect(page.getByText('保留真实输出', { exact: true })).toBeVisible()
    const link = page.getByRole('link', { name: '下载原图', exact: true })
    await expect(link).toHaveAttribute('href', savedImage)
    const downloaded = page.waitForEvent('download')
    await link.click()
    expect((await downloaded).suggestedFilename()).toContain('gouo-original')
    await page.reload()
    await expect(evidence).toBeVisible()
    await expect(page.getByText(/成功扣费|已结算|正在结算/)).toHaveCount(0)
    expect(sends).toBe(0)
  })
}
