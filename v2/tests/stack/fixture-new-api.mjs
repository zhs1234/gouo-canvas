// 仅用于隔离的编排契约测试，不是 New API，也不是供应商验证。
// 固定账号/令牌是公开测试数据；会话和消费记录只存在于内存。
import { createServer } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'

const sessions = new Map()
const accounts = new Map([7, 8].map(id => [id, {
  id, username: id === 7 ? 'studio-user' : 'other-user', display_name: id === 7 ? '协议测试用户' : '另一个测试用户',
  role: id === 7 ? 10 : 1, status: 1, group: 'default', quota: 100000, used_quota: 0, request_count: 0,
}]))
const tokens = new Map()
const preferences = new Map()
const logs = []
const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#a8cf74' } }).png().toBuffer()
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const ok = (res, data) => json(res, 200, { success: true, data })
const denied = res => json(res, 401, { success: false, message: '测试会话已失效' })
const bundle = session => ({ access_token: session.access, token_type: 'Bearer', access_expires_at: Math.floor(Date.now() / 1000) + 600, session: { sid: session.id }, user: accounts.get(session.owner) })
const authorized = req => [...sessions.values()].find(s => req.headers.authorization === `Bearer ${s.access}`)
const charge = (model, owner = 7) => {
  const row = { id: logs.length + 1, user_id: owner, request_id: randomUUID(), model_name: model, quota: 100,
    created_at: Math.floor(Date.now() / 1000), prompt_tokens: 10, completion_tokens: 10, token_name: 'fixture-relay' }
  logs.push(row)
  const account = accounts.get(owner)
  for (const token of tokens.values()) if (token.user_id === owner) token.remain_quota -= row.quota
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
    if (['/setup', '/console', '/sign-in', '/sign-up', '/forgot-password', '/profile', '/security', '/wallet', '/usage-logs', '/users'].includes(url.pathname)) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>Explicit in-memory New API contract fixture</h1>') }
    if (url.pathname === '/api/user/register' && req.method === 'POST') {
      if (!body.username || body.password !== 'test-password' || [...accounts.values()].some(a => a.username === body.username)) return json(res, 400, { success: false })
      const id = Math.max(...accounts.keys()) + 1
      accounts.set(id, { id, username: body.username, display_name: '新普通测试用户', role: 1, status: 1, group: 'default', quota: 0, used_quota: 0, request_count: 0 })
      return ok(res, null)
    }
    // Explicit test control, absent from the real pinned New API. No payment.
    if (url.pathname === '/api/fixture/account' && req.method === 'POST') {
      const account = accounts.get(body.id)
      if (!account) return json(res, 404, { success: false })
      for (const name of ['quota', 'status', 'group']) if (body[name] !== undefined) account[name] = body[name]
      return ok(res, null)
    }
    if (url.pathname === '/api/user/login' && req.method === 'POST') {
      const account = [...accounts.values()].find(a => a.username === body.username)
      if (!account || body.password !== 'test-password') return denied(res)
      const next = { id: randomUUID(), refresh: randomUUID(), access: randomUUID(), owner: account.id }
      sessions.set(next.id, next)
      res.setHeader('set-cookie', `fixture_refresh=${next.refresh}; Path=/api/user/auth; HttpOnly; SameSite=Strict`)
      return ok(res, bundle(next))
    }
    if (url.pathname === '/api/user/auth/refresh' && req.method === 'POST') {
      const refresh = /(?:^|;\s*)fixture_refresh=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
      const next = [...sessions.values()].find(s => s.refresh === refresh)
      if (!next) return denied(res)
      if (req.headers['x-auth-session'] && req.headers['x-auth-session'] !== next.id) return denied(res)
      next.access = randomUUID(); next.refresh = randomUUID()
      res.setHeader('set-cookie', `fixture_refresh=${next.refresh}; Path=/api/user/auth; HttpOnly; SameSite=Strict`)
      return ok(res, bundle(next))
    }
    if (url.pathname === '/api/user/auth/logout' && req.method === 'POST') {
      if (!session || req.headers['x-auth-session'] !== session.id) return denied(res)
      sessions.delete(session.id)
      res.setHeader('set-cookie', 'fixture_refresh=; Path=/api/user/auth; HttpOnly; SameSite=Strict; Max-Age=0')
      return ok(res, { revoked_sid: session.id, cookie_cleared: true })
    }
    if (url.pathname.startsWith('/api/')) {
      if (!session) return denied(res)
      if (accounts.get(session.owner)?.status !== 1) return json(res, 403, { success: false, message: '测试账号已禁用' })
      if (url.pathname === '/api/user/self') return ok(res, accounts.get(session.owner))
      if (url.pathname === '/api/subscription/self') return ok(res, { billing_preference: preferences.get(session.owner) ?? 'subscription_first', subscriptions: [], all_subscriptions: [] })
      if (url.pathname === '/api/subscription/self/preference' && req.method === 'PUT') {
        if (!['wallet_only', 'subscription_only'].includes(body.billing_preference)) return json(res, 422, { success: false, message: 'Invalid fixture preference' })
        preferences.set(session.owner, body.billing_preference)
        return ok(res, { billing_preference: body.billing_preference })
      }
      if (url.pathname === '/api/user/models') return ok(res, accounts.get(session.owner).group === 'blocked' ? [] : ['fixture-chat', 'fixture-image'])
      if (url.pathname === '/api/token/search') return ok(res, { total: [...tokens.values()].filter(t => t.user_id === session.owner).length, items: [...tokens.values()].filter(t => t.user_id === session.owner).map(t => ({ ...t, key: 'masked' })) })
      if (url.pathname === '/api/token/' && req.method === 'POST') {
        const id = tokens.size + 1
        tokens.set(id, { ...body, id, user_id: session.owner, status: 1, key: randomBytes(24).toString('hex') })
        return json(res, 200, { success: true, message: '' })
      }
      if (/^\/api\/token\/\d+\/key$/.test(url.pathname) && req.method === 'POST') {
        const token = tokens.get(Number(url.pathname.split('/')[3]))
        return token?.user_id === session.owner ? ok(res, { key: token.key }) : denied(res)
      }
      if (url.pathname === '/api/pricing') return json(res, 200, { success: true, group_ratio: { default: 1 }, data: ['fixture-chat', 'fixture-image'].map(model_name => ({ model_name, quota_type: 1, model_price: 0.1 })) })
      if (url.pathname === '/api/log/self') return ok(res, { items: logs.filter(row => row.user_id === session.owner && (!url.searchParams.has('request_id') || row.request_id === url.searchParams.get('request_id'))).toReversed().slice(0, 10) })
    }
    // Legacy pinned fixture belongs to the admin fixture, just like the fixed upstream contract.
    if (/^Bearer fixture-relay-\d+$/.test(req.headers.authorization ?? '') && accounts.get(7).role < 10) return json(res, 403, { success: false, message: '普通用户不支持指定渠道' })
    const relayToken = [...tokens.values()].find(t => req.headers.authorization === `Bearer ${t.key}`)
    const relayAllowed = model => relayToken && relayToken.status === 1 && relayToken.remain_quota > 0 && relayToken.model_limits.split(',').includes(model) && accounts.get(relayToken.user_id)?.status === 1 && accounts.get(relayToken.user_id)?.quota > 0
    if (url.pathname === '/v1/images/generations' && req.method === 'POST') {
      if ((req.headers.authorization !== 'Bearer fixture-relay-1' && !relayAllowed(body.model)) || body.model !== 'fixture-image') return denied(res)
      res.setHeader('x-oneapi-request-id', charge(body.model, relayToken?.user_id ?? 7))
      return json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString('base64') }] })
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      if ((req.headers.authorization !== 'Bearer fixture-relay-2' && !relayAllowed(body.model)) || body.model !== 'fixture-chat') return denied(res)
      const id = charge(body.model, relayToken?.user_id ?? 7)
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
        // Give the explicit disconnect test time to abort after a real first delta.
        await new Promise(resolve => setTimeout(resolve, /断线恢复/.test(JSON.stringify(body.messages.at(-1))) ? 1000 : 25))
      }
      emit({}, wantsImage ? 'tool_calls' : 'stop')
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [], usage })}\n\ndata: [DONE]\n\n`)
      return res.end()
    }
    json(res, 404, { success: false, message: 'Fixture route not implemented' })
  } catch { if (!res.headersSent) json(res, 400, { success: false, message: 'Invalid fixture request' }); else res.end() }
})
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Explicit in-memory New API contract fixture ready'))
