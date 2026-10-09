import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// 只监听本机，所有结果来自仓库图片，不转发任何请求，不产生真实费用。
const host = '127.0.0.1'
const token = 'sk-MOCK-only-local'
const priceVersion = 'MOCK-price-v1'
const image = await readFile(fileURLToPath(new URL('../public/inspiration/case380.webp', import.meta.url)))
const imageData = `data:image/webp;base64,${image.toString('base64')}`
const imageRequests = new Map()
const stats = { chatRequests: 0, imageSubmissions: 0, imageReplays: 0 }
const imageModels = [{ id: 'gpt-image-2', name: 'MOCK 图片模型（本地免费）', price_cny: 0.01, price_version: priceVersion, reference: true, mask: true, max_outputs: 4, quota: 5000 }]
const user = { id: 2147480901, username: 'MOCK-local', display_name: '本地验收 · MOCK', quota: 4999500000, used_quota: 0, request_count: 0, balance_cny: 9999, used_cny: 0, quota_cny_rate: 0.000002, image_price_cny: 0.01 }
let password = 'MOCK-password-123'
const charges = []
const logs = []
const redeemedCodes = new Set()

function page(items, params) {
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1))
  const size = Math.max(1, Math.min(100, Math.floor(Number(params.get('size')) || 20)))
  return { data: items.slice((page - 1) * size, page * size), total_count: items.length, page, size }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function ok(res, data) {
  json(res, 200, { success: true, data })
}

async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 32 * 1024 * 1024) throw new Error('MOCK 请求体超过 32 MB')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (String(req.headers['content-type']).startsWith('multipart/form-data')) {
    const form = await new Response(bytes, { headers: { 'Content-Type': req.headers['content-type'] } }).formData()
    const payload = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'))
    payload.files = [...form.entries()].filter(([, value]) => typeof value !== 'string')
    return payload
  }
  return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}
}

async function stream(res, deltas, delay = 70) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
  for (const delta of deltas) {
    if (res.destroyed) return
    res.write(`data: ${JSON.stringify({ id: 'MOCK-stream', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  if (!res.destroyed) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: deltas.some((delta) => delta.tool_calls) ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`)
    res.end()
  }
}

async function chat(res, payload) {
  stats.chatRequests += 1
  if (payload.model !== 'MOCK-agent') { json(res, 400, { error: { message: 'MOCK 未配置此文本模型' } }); return }
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  let userIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) if (messages[index].role === 'user') { userIndex = index; break }
  const user = messages[userIndex]?.content
  const text = typeof user === 'string' ? user : Array.isArray(user) ? user.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : ''
  const results = messages.slice(userIndex + 1).filter((message) => message.role === 'tool')
  const toolResults = results.map((message) => {
    try { return JSON.parse(message.content) } catch { return { error: '无法读取工具结果' } }
  })
  const failed = toolResults.find((result) => result.error || result.status === 'error')
  if (failed) {
    await stream(res, [{ content: `MOCK：工具执行失败：${failed.error || '任务失败'}。未确认提交成功，请核对工具结果后再操作。` }], 0)
    return
  }
  if (/测试错误/.test(text)) { json(res, 503, { error: { message: 'MOCK 可恢复的服务错误，没有产生费用' } }); return }
  if (/整理.*画布|画布.*添加.*文字|读取.*画布/.test(text)) {
    if (!results.length) {
      await stream(res, [{ tool_calls: [{ index: 0, id: `mock_read_${stats.chatRequests}`, type: 'function', function: { name: 'get_canvas', arguments: '{}' } }] }])
      return
    }
    if (results.length && !/读取/.test(text)) {
      const snapshot = toolResults[0]
      if (Number.isInteger(snapshot.revision)) {
        const operations = /整理/.test(text) && snapshot.nodes?.length
          ? snapshot.nodes.map((node, index) => ({ type: 'update_node', id: node.id, patch: { position: { x: index % 3 * 380, y: Math.floor(index / 3) * 360 } } })).filter((operation, index) => snapshot.nodes[index].position?.x !== operation.patch.position.x || snapshot.nodes[index].position?.y !== operation.patch.position.y)
          : [{ type: 'add_node', nodeType: 'text', title: 'MOCK 创作笔记', position: { x: 80, y: 80 }, metadata: { content: '这是通过平台 Agent 工具添加的画布文字。仅本地模拟，无真实费用。' } }]
        const batch = operations.slice((results.length - 1) * 50, results.length * 50)
        if (batch.length) {
          await stream(res, [{ tool_calls: [{ index: 0, id: `mock_edit_${stats.chatRequests}`, type: 'function', function: { name: 'apply_canvas_operations', arguments: JSON.stringify({ expectedRevision: toolResults.at(-1).revision, operations: batch }) } }] }])
          return
        }
      }
    }
    await stream(res, [{ content: 'MOCK：画布工具调用已结束。' }, { content: '可以打开画布检查节点及连线，失败原因会保留在工具结果中。' }])
    return
  }
  if (/生成.*图|画一张|生图|生成.*海报/.test(text) && !/(?:不(?:需要|要|用)?|别|禁止)(?:再|立即|直接)?(?:生成|生图|画)|先(?:规划|讨论)|仅(?:规划|讨论)|只(?:规划|讨论)/.test(text) && !results.length) {
    const args = JSON.stringify({ prompt: text, params: { n: 1 } })
    await stream(res, [{ content: '我会使用当前选择的图片模型开始生成。' }, { tool_calls: [{ index: 0, id: `mock_image_${stats.chatRequests}`, type: 'function', function: { name: 'create_image_task', arguments: args.slice(0, 12) } }] }, { tool_calls: [{ index: 0, function: { arguments: args.slice(12) } }] }])
    return
  }
  const reply = results.length
    ? toolResults.some((result) => result.taskId) ? 'MOCK：图片任务已提交，请在任务卡片查看实际状态。此预览使用本地素材，不产生真实费用。' : 'MOCK：工具调用已完成，请检查工具结果。'
    : /慢速/.test(text)
      ? 'MOCK 慢速流式测试。你可以点击停止，或者切换到画布再回来检查会话是否继续。当前仅使用本地模拟服务，不会连接真实模型。'.repeat(4)
      : '你好！今天想创作点什么？我可以帮你构思画面、生成图片，也能整理关联画布。\n\n这是 MOCK 本地验收环境，没有连接真实模型，也不会产生费用。'
  await stream(res, [...reply].map((content) => ({ content })), /慢速/.test(text) ? 75 : 8)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${host}`)
    const path = url.pathname
    if (req.method === 'GET' && path === '/api/status') { ok(res, { email_service: false, email_verification: false, turnstile_check: false, gouo_cloud_library: false, gouo_redemption_help: '仅本地模拟：兑换码 MOCK-TOPUP-10 可兑换一次测试额度 ¥10；重启模拟服务后重置。', mock: true }); return }
    if (req.method === 'POST' && path === '/api/user/login') {
      const payload = await body(req)
      if (payload.username !== user.username || payload.password !== password) { json(res, 401, { success: false, message: 'MOCK 账号或密码错误' }); return }
      res.setHeader('Set-Cookie', 'gouo_mock_session=active; HttpOnly; SameSite=Strict; Path=/')
      ok(res, user)
      return
    }
    if (req.method === 'POST' && path === '/api/user/register') { json(res, 400, { success: false, message: '此 MOCK 仅支持预置测试账号 MOCK-local，初始密码 MOCK-password-123；注册请使用隔离的真实后端验收' }); return }
    if (path.startsWith('/api/') && /(?:^|;\s*)gouo_mock_session=logged-out(?:;|$)/.test(req.headers.cookie || '')) { json(res, 401, { success: false, message: 'MOCK 已退出登录' }); return }
    if (req.method === 'GET' && path === '/api/user/self') { ok(res, user); return }
    if (req.method === 'PUT' && path === '/api/user/self') {
      const payload = await body(req)
      if (typeof payload.display_name !== 'string' || !payload.display_name.trim() || [...payload.display_name].length > 50) throw new Error('显示名称必须为 1–50 个字符')
      user.display_name = payload.display_name.trim()
      ok(res, null)
      return
    }
    if (req.method === 'PUT' && path === '/api/user/password') {
      const payload = await body(req)
      if (payload.current_password !== password) throw new Error('当前密码不正确')
      if (typeof payload.new_password !== 'string' || payload.new_password.length < 8 || payload.new_password.length > 20) throw new Error('新密码必须为 8–20 个字符')
      password = payload.new_password
      ok(res, null)
      return
    }
    if (req.method === 'POST' && path === '/api/user/topup') {
      const payload = await body(req)
      if (payload.key !== 'MOCK-TOPUP-10') throw new Error('MOCK 兑换码无效，请使用 MOCK-TOPUP-10')
      if (redeemedCodes.has(payload.key)) throw new Error('MOCK 兑换码已使用')
      redeemedCodes.add(payload.key)
      const quota = 5000000
      user.quota += quota
      user.balance_cny = user.quota * user.quota_cny_rate
      logs.unshift({ created_at: Math.floor(Date.now() / 1000), type: 1, content: 'MOCK 测试兑换码，非真实充值', quota, model_name: '' })
      ok(res, quota)
      return
    }
    if (req.method === 'GET' && path === '/api/user/logout') { res.setHeader('Set-Cookie', 'gouo_mock_session=logged-out; HttpOnly; SameSite=Strict; Path=/'); ok(res, null); return }
    if (req.method === 'GET' && path === '/api/gouo/image-charges') { ok(res, page(charges, url.searchParams)); return }
    if (req.method === 'GET' && path === '/api/log/self') {
      const query = url.searchParams
      const filtered = logs.filter((log) => (!query.get('model_name') || log.model_name === query.get('model_name')) && (!query.get('log_type') || log.type === Number(query.get('log_type'))) && (!query.get('start_timestamp') || log.created_at >= Number(query.get('start_timestamp'))) && (!query.get('end_timestamp') || log.created_at <= Number(query.get('end_timestamp'))))
      ok(res, page(filtered, query))
      return
    }
    if (req.method === 'GET' && path === '/api/token/playground') { ok(res, token); return }
    if (req.method === 'GET' && path === '/api/gouo/models') { ok(res, imageModels); return }
    if (req.method === 'GET' && path === '/api/gouo/agent/models') { ok(res, [{ id: 'MOCK-agent', name: 'MOCK 创作助手（本地免费）', tool_calls: true, vision: true }]); return }
    if (req.method === 'GET' && path === '/api/gouo/storage') { ok(res, { enabled: false, used_bytes: 0, quota_bytes: 0, remaining_bytes: 0, asset_count: 0 }); return }
    if (req.method === 'GET' && path === '/mock/metrics') { ok(res, { ...stats, mock: true, upstreamRequests: 0 }); return }
    if (path.startsWith('/v1/') && req.headers.authorization !== `Bearer ${token}`) { json(res, 401, { error: { message: 'MOCK 只接受本地测试令牌' } }); return }
    if (req.method === 'POST' && path === '/v1/chat/completions') { await chat(res, await body(req)); return }
    if (req.method === 'POST' && ['/v1/images/generations', '/v1/images/edits'].includes(path)) {
      const payload = await body(req)
      if (payload.model !== 'gpt-image-2') { json(res, 400, { error: { message: 'MOCK 图片模型不存在' } }); return }
      if (req.headers['x-gouo-price-version'] !== priceVersion) { json(res, 409, { error: { message: '模型价格或能力已更新，请核对模型价格后重新提交' } }); return }
      const requestId = req.headers['x-gouo-request-id']
      if (requestId && imageRequests.has(requestId)) { stats.imageReplays += 1; json(res, 200, imageRequests.get(requestId)); return }
      const count = Number(payload.n ?? 1)
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('图片数量必须为 1–4')
      const references = (payload.files || []).filter(([key]) => key === 'image' || key === 'image[]')
      if (path.endsWith('/edits') && !references.length) throw new Error('MOCK 图片编辑必须上传参考图')
      if ((payload.files || []).some(([, file]) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size)) throw new Error('MOCK 仅接受非空 PNG/JPEG/WebP 图片')
      const source = references[0]?.[1]
      const data = source ? `data:${source.type};base64,${Buffer.from(await source.arrayBuffer()).toString('base64')}` : imageData
      const created = Math.floor(Date.now() / 1000)
      const result = { created, data: Array.from({ length: count }, () => ({ b64_json: data, revised_prompt: source ? `MOCK 回显首张参考图，已接收 ${references.length} 张参考图${payload.files.some(([key]) => key === 'mask') ? '及遮罩' : ''}，未执行真实图片编辑：${payload.prompt || ''}` : `MOCK 本地图片：${payload.prompt || ''}` })), output_format: source?.type.split('/')[1] || 'webp' }
      if (requestId) imageRequests.set(requestId, result)
      stats.imageSubmissions += 1
      charges.unshift({ id: requestId || `mock-image-${stats.imageSubmissions}`, model_name: payload.model, price_cny: 0.01, status: 'settled', created_at: created, note: 'MOCK 模拟成功，未产生真实费用' })
      logs.unshift({ created_at: created, type: 2, content: 'MOCK 图片请求，非真实扣费', model_name: payload.model, quota: 5000, request_time: 1, metadata: { billing_unit: 'successful_request', price_cny: 0.01, image_count: count } })
      user.quota -= 5000
      user.used_quota += 5000
      user.request_count += 1
      user.balance_cny = user.quota * user.quota_cny_rate
      user.used_cny = user.used_quota * user.quota_cny_rate
      await new Promise((resolve) => setTimeout(resolve, 500))
      json(res, 200, result)
      return
    }
    json(res, 404, { success: false, message: `MOCK 未实现路由：${req.method} ${path}` })
  } catch (error) {
    console.error('MOCK 请求失败', error)
    if (!res.headersSent) json(res, 400, { success: false, message: error instanceof Error ? error.message : 'MOCK 请求失败' })
    else res.end()
  }
})

const selfTest = process.argv.includes('--self-test')
const port = selfTest ? 0 : Number(process.env.MOCK_WORKSPACE_PORT || 5190)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MOCK_WORKSPACE_PORT 无效')
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve) })
const address = `http://${host}:${server.address().port}`
console.log(`MOCK workspace API listening at ${address}; no upstream requests or real charges`)

if (selfTest) {
  try {
    const requestApi = async (path, method = 'GET', value, headers = {}) => {
      const res = await fetch(`${address}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: value === undefined ? undefined : JSON.stringify(value) })
      return { status: res.status, value: await res.json(), cookie: res.headers.get('set-cookie') }
    }
    const response = await fetch(`${address}/api/user/self`).then((res) => res.json())
    assert.equal(response.data.id, 2147480901)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Gouo-Price-Version': priceVersion, 'X-Gouo-Request-Id': 'self-test-idempotency' }
    const request = { method: 'POST', headers, body: JSON.stringify({ model: 'gpt-image-2', prompt: '测试图片' }) }
    const first = await fetch(`${address}/v1/images/generations`, request).then((res) => res.json())
    const second = await fetch(`${address}/v1/images/generations`, request).then((res) => res.json())
    assert.deepEqual(first, second)
    assert.equal(stats.imageSubmissions, 1)
    assert.equal(stats.imageReplays, 1)
    const chargePage = await requestApi('/api/gouo/image-charges?page=1&size=1')
    assert.equal(chargePage.value.data.total_count, 1)
    assert.equal(chargePage.value.data.data[0].id, 'self-test-idempotency')
    assert.equal(chargePage.value.data.data[0].status, 'settled')
    assert.equal((await requestApi('/api/log/self?model_name=other-model')).value.data.total_count, 0)
    assert.equal((await requestApi('/api/log/self?model_name=gpt-image')).value.data.total_count, 0)
    assert.equal((await requestApi('/api/log/self?model_name=gpt-image-2&log_type=2')).value.data.total_count, 1)
    assert.equal((await requestApi('/api/log/self?start_timestamp=9999999999')).value.data.total_count, 0)
    assert.equal((await requestApi('/api/log/self?end_timestamp=1')).value.data.total_count, 0)
    assert.equal((await requestApi('/api/user/self', 'PUT', { display_name: 'MOCK 修改后的资料' })).value.success, true)
    assert.equal((await requestApi('/api/user/self')).value.data.display_name, 'MOCK 修改后的资料')
    assert.equal((await requestApi('/api/user/self', 'PUT', { display_name: '' })).status, 400)
    assert.equal((await requestApi('/api/user/topup', 'POST', { key: 'invalid' })).status, 400)
    assert.equal((await requestApi('/api/user/topup', 'POST', { key: 'MOCK-TOPUP-10' })).value.data, 5000000)
    assert.equal((await requestApi('/api/user/topup', 'POST', { key: 'MOCK-TOPUP-10' })).status, 400)
    assert.equal((await requestApi('/api/log/self?page=2&size=1')).value.data.data[0].type, 2)
    assert.equal((await requestApi('/api/log/self?log_type=1')).value.data.total_count, 1)
    assert.equal((await requestApi('/api/user/self')).value.data.balance_cny, 10008.99)
    assert.equal((await requestApi('/api/user/password', 'PUT', { current_password: 'wrong', new_password: 'MOCK-new-password' })).status, 400)
    assert.equal((await requestApi('/api/user/password', 'PUT', { current_password: password, new_password: 'MOCK-new-password' })).value.success, true)
    const logout = await requestApi('/api/user/logout')
    assert.match(logout.cookie, /HttpOnly/)
    const cookie = { Cookie: logout.cookie.split(';')[0] }
    assert.equal((await requestApi('/api/user/self', 'GET', undefined, cookie)).status, 401)
    assert.equal((await requestApi('/api/user/login', 'POST', { username: user.username, password: 'MOCK-password-123' }, cookie)).status, 401)
    assert.equal((await requestApi('/api/user/login', 'POST', { username: user.username, password }, cookie)).value.success, true)
    const form = new FormData()
    form.set('model', 'gpt-image-2')
    form.set('prompt', '验证参考图文件传输')
    form.append('image[]', new Blob([image], { type: 'image/webp' }), 'reference.webp')
    const edit = await fetch(`${address}/v1/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Gouo-Price-Version': priceVersion }, body: form }).then((res) => res.json())
    assert.equal(edit.data[0].b64_json, imageData)
    assert.match(edit.data[0].revised_prompt, /已接收 1 张参考图.*未执行真实图片编辑/)
    assert.equal((await requestApi('/v1/images/edits', 'POST', { model: 'gpt-image-2' }, { ...headers, 'X-Gouo-Request-Id': 'self-test-missing-reference' })).status, 400)
    const chatText = await fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'MOCK-agent', messages: [{ role: 'user', content: '生成一张图片' }] }) }).then((res) => res.text())
    assert.match(chatText, /create_image_task/)
    assert.match(chatText, /\[DONE\]/)
    const planning = await fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'MOCK-agent', messages: [{ role: 'user', content: '你好，帮我构思一组雨后城市海报。先讨论，不生成图片。' }] }) }).then((res) => res.text())
    assert.doesNotMatch(planning, /create_image_task/)
    for (const content of ['不要生图', '不需要生成图片', '别画一张图']) {
      const reply = await fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'MOCK-agent', messages: [{ role: 'user', content }] }) }).then((res) => res.text())
      assert.doesNotMatch(reply, /create_image_task/)
    }
    const failure = await fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'MOCK-agent', messages: [{ role: 'user', content: '生成图片' }, { role: 'tool', content: JSON.stringify({ error: '模型已下架' }) }] }) }).then((res) => res.text())
    assert.match(failure, /工具执行失败/)
    assert.doesNotMatch(failure, /图片任务已提交/)
    const messages = [{ role: 'user', content: '整理画布' }, { role: 'tool', content: JSON.stringify({ revision: 5, nodes: Array.from({ length: 51 }, (_, index) => ({ id: `node-${index}` })) }) }]
    for (const count of [50, 1]) {
      const reply = await fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'MOCK-agent', messages }) }).then((res) => res.text())
      const chunk = reply.split('\n').find((line) => line.startsWith('data: ') && line.includes('apply_canvas_operations'))
      const args = JSON.parse(JSON.parse(chunk.slice(6)).choices[0].delta.tool_calls[0].function.arguments)
      assert.equal(args.operations.length, count)
      assert.equal(args.expectedRevision, count === 50 ? 5 : 6)
      assert.equal(args.operations[0].id, count === 50 ? 'node-0' : 'node-50')
      messages.push({ role: 'tool', content: JSON.stringify({ revision: args.expectedRevision + 1 }) })
    }
    const resumed = [{ role: 'user', content: '整理画布' }, { role: 'tool', content: JSON.stringify({ revision: 20, nodes: Array.from({ length: 351 }, (_, index) => ({ id: `node-${index}`, position: index < 350 ? { x: index % 3 * 380, y: Math.floor(index / 3) * 360 } : { x: -1, y: -1 } })) }) }]
    const resumedReply = await fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: 'MOCK-agent', messages: resumed }) }).then((res) => res.text())
    const resumedChunk = resumedReply.split('\n').find((line) => line.startsWith('data: ') && line.includes('apply_canvas_operations'))
    const resumedArgs = JSON.parse(JSON.parse(resumedChunk.slice(6)).choices[0].delta.tool_calls[0].function.arguments)
    assert.deepEqual(resumedArgs.operations.map((operation) => operation.id), ['node-350'])
    assert.equal((await fetch(`${address}/unknown`)).status, 404)
    console.log('MOCK self-test passed: account writes, logout/login, billing ledger and filters, image replay and multipart, negative intent, failed tools, canvas batches, unknown route')
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}
