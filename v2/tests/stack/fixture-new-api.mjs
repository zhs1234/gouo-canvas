// 仅用于隔离的编排契约测试，不是 New API，也不是供应商验证。
// 固定账号/令牌是公开测试数据；会话和消费记录只存在于内存。
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

const sessions = new Map()
const accounts = new Map([7, 8].map(id => [id, {
  id, username: id === 7 ? 'studio-user' : 'other-user', display_name: id === 7 ? '协议测试用户' : '另一个测试用户',
  group: 'default', quota: 100000, used_quota: 0, request_count: 0,
}]))
const logs = []
const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#a8cf74' } }).png().toBuffer()
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const ok = (res, data) => json(res, 200, { success: true, data })
const denied = res => json(res, 401, { success: false, message: '测试会话已失效' })
const bundle = session => ({ access_token: session.access, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: session.id }, user: accounts.get(session.owner) })
const authorized = req => [...sessions.values()].find(s => req.headers.authorization === `Bearer ${s.access}`)
const charge = model => {
  const row = { id: logs.length + 1, user_id: 7, request_id: randomUUID(), model_name: model, quota: 100,
    created_at: Math.floor(Date.now() / 1000), prompt_tokens: 10, completion_tokens: 10, token_name: 'fixture-relay' }
  logs.push(row)
  const account = accounts.get(7)
  account.quota -= row.quota; account.used_quota += row.quota; account.request_count++
  return row.request_id
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture')
    let raw = ''
    for await (const chunk of req) { raw += chunk; if (raw.length > 1024 * 1024) return json(res, 413, { success: false }) }
    const body = raw ? JSON.parse(raw) : {}
    const session = authorized(req)
    if (url.pathname === '/api/status') return ok(res, { quota_per_unit: 1000, usd_exchange_rate: 1, fixture: true })
    if (['/setup', '/console'].includes(url.pathname)) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>Explicit in-memory New API contract fixture</h1>') }
    if (url.pathname === '/api/user/login' && req.method === 'POST') {
      const account = [...accounts.values()].find(a => a.username === body.username)
      if (!account || body.password !== 'test-password') return denied(res)
      const next = { id: randomUUID(), refresh: randomUUID(), access: randomUUID(), owner: account.id }
      sessions.set(next.id, next)
      res.setHeader('set-cookie', `fixture_refresh=${next.refresh}; Path=/api/user; HttpOnly; SameSite=Lax`)
      return ok(res, bundle(next))
    }
    if (url.pathname === '/api/user/auth/refresh' && req.method === 'POST') {
      const refresh = /(?:^|;\s*)fixture_refresh=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
      const next = [...sessions.values()].find(s => s.refresh === refresh)
      if (!next) return denied(res)
      next.access = randomUUID()
      return ok(res, bundle(next))
    }
    if (url.pathname === '/api/user/auth/logout' && req.method === 'POST') {
      if (!session || req.headers['x-auth-session'] !== session.id) return denied(res)
      sessions.delete(session.id)
      res.setHeader('set-cookie', 'fixture_refresh=; Path=/api/user; HttpOnly; SameSite=Lax; Max-Age=0')
      return ok(res, null)
    }
    if (url.pathname.startsWith('/api/')) {
      if (!session) return denied(res)
      if (url.pathname === '/api/user/self') return ok(res, accounts.get(session.owner))
      if (url.pathname === '/api/pricing') return json(res, 200, { success: true, group_ratio: { default: 1 }, data: ['fixture-chat', 'fixture-image'].map(model_name => ({ model_name, quota_type: 1, model_price: 0.1 })) })
      if (url.pathname === '/api/log/self') return ok(res, { items: logs.filter(row => row.user_id === session.owner && (!url.searchParams.has('request_id') || row.request_id === url.searchParams.get('request_id'))).toReversed().slice(0, 10) })
    }
    if (url.pathname === '/v1/images/generations' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer fixture-relay-1' || body.model !== 'fixture-image') return denied(res)
      res.setHeader('x-oneapi-request-id', charge(body.model))
      return json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString('base64') }] })
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer fixture-relay-2' || body.model !== 'fixture-chat') return denied(res)
      const id = charge(body.model)
      res.setHeader('x-oneapi-request-id', id)
      const finishedTool = body.messages.some(m => m.role === 'tool')
      const content = finishedTool ? '协议替身已完成图片，未调用真实供应商。' : '协议替身纯文本回复。'
      const wantsImage = !finishedTool && /生成图片/.test(JSON.stringify(body.messages.at(-1))) && body.tools?.length
      const tool = { id: `call_${id}`, type: 'function', function: { name: 'generate_image', arguments: JSON.stringify({ prompt: '协议替身图片' }) } }
      const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      if (!body.stream) return json(res, 200, { id, object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: wantsImage ? { role: 'assistant', content: '', tool_calls: [tool] } : { role: 'assistant', content }, finish_reason: wantsImage ? 'tool_calls' : 'stop' }], usage })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
      emit({ role: 'assistant', content: '' })
      if (wantsImage) emit({ tool_calls: [{ index: 0, ...tool }] })
      else for (const text of content.match(/.{1,5}/gu)) {
        if (res.destroyed) return
        emit({ content: text })
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      emit({}, wantsImage ? 'tool_calls' : 'stop')
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [], usage })}\n\ndata: [DONE]\n\n`)
      return res.end()
    }
    json(res, 404, { success: false, message: 'Fixture route not implemented' })
  } catch { if (!res.headersSent) json(res, 400, { success: false, message: 'Invalid fixture request' }); else res.end() }
})
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Explicit in-memory New API contract fixture ready'))
