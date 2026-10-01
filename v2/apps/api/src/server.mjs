import Fastify from 'fastify'
import { z } from 'zod'
import { catalog, isAvailable, generationEnabled } from './config.mjs'
import { Projects, documentSchema } from './projects.mjs'
import { History } from './history.mjs'
import { Ledger } from './ledger.mjs'
import { generateImage, StudioError } from './images.mjs'
import { runAgent, runImage } from './agent.mjs'
import { userModels, userRelay } from './user-relay.mjs'
import { billingSummary, settledUsage } from './billing.mjs'
import { Trial } from './trial.mjs'
import { inspectTrialFunding, purchaseTrial } from './trial-funding.mjs'
import { readFundingAccount } from './funding.mjs'
import { FundingState } from './funding-state.mjs'
import { validateAccountUpdate, passthroughAccountUpdate } from './account-update.mjs'
import { inspectWalletFunding } from './wallet-funding.mjs'

const imageBody = z.object({ prompt: z.string().trim().min(1).max(8000), payWithBalance: z.boolean().optional(), model: z.string().max(100).optional(), quality: z.string().max(40).optional(), aspectRatio: z.string().max(20).optional(), inputImages: z.array(z.string().max(12 * 1024 * 1024)).max(4).default([]) }).strict()
const runBody = z.object({ threadId: z.string().uuid().optional(), runId: z.string().uuid(), prompt: z.string().trim().min(1).max(8000), model: z.string().max(100).optional(),
  sessionId: z.string().max(100), conversationId: z.string().max(100), canvasId: z.string().max(100).optional(),
  attachments: z.array(z.object({ url: z.string().max(12 * 1024 * 1024), mimeType: z.string(), assetId: z.string(), source: z.enum(['upload', 'canvas', 'canvas-ref']), name: z.string().optional() })).max(4).optional(),
  imageGenerationPreference: z.object({ mode: z.enum(['auto', 'manual']), models: z.array(z.string()).max(1) }).optional(),
  videoGenerationPreference: z.unknown().optional(), mentions: z.array(z.unknown()).max(20).optional(), payWithBalance: z.boolean().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000).optional(), contentBlocks: z.array(z.unknown()).max(100).nullable().optional() }).passthrough()).max(12).optional(),
  canvasContext: z.array(z.record(z.unknown())).max(80).optional(),
}).strict()
export function createServer(config, overrides = {}) {
  config = { ...config, accountInstanceId: config.accountInstanceId ?? config.trial?.instanceId }
  if (config.trial && config.accountInstanceId !== config.trial.instanceId) throw new Error('试用政策属于另一 New API 实例，不能混用账号实例标识')
  if (config.relayCredentialMode === 'user-token' && !z.string().uuid().safeParse(config.accountInstanceId).success) throw new Error('每用户模式必须绑定稳定的账号实例标识')
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024, requestTimeout: 150_000 })
  const fetcher = overrides.fetch ?? fetch
  const ledger = new Ledger(config.ledgerPath)
  let trial, history, fundingState, projects
  try {
    trial = new Trial(ledger.db, config.trial, config.accountInstanceId ?? config.trial?.instanceId)
    history = new History(ledger.db)
    fundingState = new FundingState(ledger.db)
    projects = new Projects(ledger.db, history)
  } catch (error) { ledger.close(); throw error }
  const busy = new Set()
  app.addHook('onClose', async () => ledger.close())
  app.setErrorHandler((error, _request, reply) => reply.code(error.status ?? error.statusCode ?? 500).send({ success: false, message: error instanceof StudioError ? error.message : error.validation ? '请求格式无效' : '创作服务请求失败' }))
  app.get('/api/studio/health', async () => ({ success: true, data: { service: 'gouo-studio-api', localDrafts: true } }))
  app.get('/api/studio/models', async request => ({ success: true, data: catalog(request.studioConfig ?? config) }))
  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.url === '/api/studio/health' || (request.routeOptions.url === '/api/studio/models' && config.relayCredentialMode !== 'user-token')) return
    const token = request.headers.authorization
    if (typeof token !== 'string' || !/^Bearer \S{1,4096}$/.test(token)) throw new StudioError('请先登录 New API 账号', 401)
    // Never trust browser-supplied user IDs or relay tokens.
    let response
    try { response = await fetcher(new URL('/api/user/self', config.authOrigin), { headers: { Authorization: token }, redirect: 'error', signal: AbortSignal.timeout(10_000) }) } catch { throw new StudioError('账号服务暂不可用', 502) }
    const body = await response.json().catch(() => null)
    if (response.status >= 500) throw new StudioError('账号服务暂不可用', 502)
    if (response.status === 403) throw new StudioError('账号已禁用或无权访问，请在原生账户页面核对', 403)
    if (!response.ok || body?.success !== true || !Number.isSafeInteger(body.data?.id) || body.data.id <= 0) throw new StudioError('登录会话已失效', 401)
    if (request.method === 'POST' && ['/api/studio/images', '/api/studio/runs', '/api/studio/runs/stream'].includes(request.routeOptions.url)) {
      if (config.allowGeneration && config.relayKey && !generationEnabled(config)) throw new StudioError('生成服务缺少有效的 GOUO_RELAY_OWNER_ID，请联系管理员配置令牌所属账号', 503)
      if (config.relayOwnerId !== undefined && body.data.id !== config.relayOwnerId) throw new StudioError('当前账号尚未连接自己的生成令牌', 403)
    }
    if (config.relayCredentialMode === 'user-token') {
      if (body.data.status !== 1) throw new StudioError('账号已禁用，请联系管理员', 403)
      if (['/api/studio/models', '/api/studio/billing'].includes(request.routeOptions.url)) {
        request.studioConfig = await userModels(config, token, body.data, fetcher)
      }
    }
    request.studioUser = body.data.id
    request.studioAccount = body.data
  })
  app.get('/api/studio/billing', async request => ({ success: true, data: await billingSummary(request.studioConfig ?? config, request.headers.authorization, request.studioAccount, fetcher) }))
  // The native UI keeps its own security-proof and auth-rotation flow. Only
  // this exact PUT is routed here by the opt-in edge; no new account system.
  app.put('/api/user/self', async (request, reply) => {
    validateAccountUpdate(request.body)
    const owner = request.studioUser
    if (busy.has(owner)) throw new StudioError('本人已有操作正在处理，请等待完成后再修改账号', 409)
    busy.add(owner)
    reply.header('Cache-Control', 'no-store')
    try {
      const result = await passthroughAccountUpdate(config, request.headers.authorization, request.body, {
        securityProof: request.headers['x-security-proof'], authSession: request.headers['x-auth-session'],
      }, fetcher)
      return reply.code(result.status).send(result.body)
    } finally { busy.delete(owner) }
  })
  app.get('/api/studio/trial', async request => {
    if (fundingState.blocked(request.studioUser)) return { success: true, data: { ...trial.summary(request.studioUser, 'unavailable', '账号付款偏好写入结果待核对，已暂停生成；刷新不会重试写入，请联系管理员'), pendingReconciliation: true } }
    if (!config.trial) return { success: true, data: trial.summary(request.studioUser, 'disabled', '注册试用尚未开放，请联系管理员') }
    const funding = await trialAccess(request)
    const grant = trial.grant(request.studioUser)
    const pendingClaim = grant && (grant.status !== 'active' || funding.state === 'eligible')
    const state = pendingClaim ? 'pending' : funding.state === 'retired' ? 'unavailable' : funding.state
    const summary = trial.summary(request.studioUser, state, funding.reason ?? (pendingClaim ? '原生领取记录待核对，刷新仅查询；不会自动重复领取' : funding.state === 'eligible' ? '发送第一条消息时开通 4 次聊天和 1 次生图试用' : '一次发送计作一次聊天，生图工具另占一次生图；未知结果保留次数'))
    if (summary.state === 'exhausted') summary.message = '试用次数已用完，请前往 New API 钱包充值，并勾选本次允许使用本人余额；每次发送需重新授权'
    if (pendingClaim) { summary.chat.remaining = 0; summary.image.remaining = 0 }
    return { success: true, data: summary }
  })
  async function trialAccess(request) {
    if (!config.trial) return { state: 'disabled', reason: '注册试用尚未开放；余额付款需本次明确授权' }
    const grant = trial.grant(request.studioUser)
    if (grant && grant.plan_id !== config.trial.planId) return { state: 'retired', reason: '原试用计划已调整，旧次数与领取记录保留；可明确授权使用本人余额' }
    return inspectTrialFunding(config, request.headers.authorization, request.studioAccount, fetcher, { checkPreference: false, allowUnavailable: true })
  }
  async function walletPreflight(request) {
    const owner = request.studioUser
    await inspectWalletFunding(config, request.headers.authorization, request.studioAccount, trial.grant(owner), fetcher)
    const account = await readFundingAccount(config, request.headers.authorization, owner, fetcher)
    if (account.group !== request.studioAccount.group) throw new StudioError('账号分组已变化，请刷新模型权限后重新发送', 409)
    if (account.quota <= 0) throw new StudioError('本人 New API 余额不足，请充值后重新授权本次发送', 402)
    return account
  }
  async function fundingAccess(request, benefit) {
    // Exhausted business benefits cannot become free again. Wallet authority
    // comes from the owner's receipt/account, not an unrelated current plan.
    if (trial.remaining(request.studioUser, benefit) === 0 && trial.grant(request.studioUser)?.status === 'active') return { state: 'exhausted', reason: '该类别试用次数已用完' }
    return trialAccess(request)
  }
  async function inspectFunding(request) {
    const owner = request.studioUser
    const grant = trial.grant(owner)
    if (grant && grant.plan_id !== config.trial.planId) throw new StudioError('试用计划已变化，原领取记录不能重置，请联系管理员', 409)
    const funding = await inspectTrialFunding(config, request.headers.authorization, request.studioAccount, fetcher, { checkPreference: false })
    if (grant?.subscription_id && funding.subscriptionId && grant.subscription_id !== funding.subscriptionId) throw new StudioError('原生试用领取证据变化，未修改扣费偏好或重新领取', 409)
    return funding
  }
  async function ensureTrial(request) {
    const owner = request.studioUser
    let funding = await inspectFunding(request)
    if (funding.state === 'active') { trial.activate(owner, funding.subscriptionId); return funding }
    if (funding.state !== 'eligible') throw new StudioError(funding.reason ?? '试用资金不可用，请前往 New API 原生页面核对', 402)
    // Persist purchase intent before the native, non-idempotent HTTP operation.
    // An ambiguous result is recovered only from the native receipt, never by
    // purchasing again, even after a restart or with a different run ID.
    if (!trial.beginClaim(owner)) throw new StudioError('试用领取结果待确认，请核对原生订阅记录；未自动重复领取', 409)
    try {
      await purchaseTrial(config, request.headers.authorization, fetcher)
      funding = await inspectFunding(request)
      if (funding.state !== 'active') throw new StudioError('试用资金领取结果待确认，未发出模型请求', 502)
      trial.activate(owner, funding.subscriptionId)
      return funding
    } catch (error) { trial.unknownClaim(owner); throw error }
  }
  app.get('/api/studio/requests/:kind/:id', async request => {
    if (!['image', 'agent'].includes(request.params.kind) || !/^[\w-]{8,100}$/.test(request.params.id)) throw new StudioError('请求标识无效', 400)
    const record = ledger.detail(request.studioUser, request.params.kind, request.params.id)
    if (!record) throw new StudioError('请求不存在', 404)
    const usage = await settledUsage(config, request.headers.authorization, record.attempts, fetcher)
    return { success: true, data: { ...record, usage: usage ?? { state: 'pending', requestCount: 0, requestIds: [], currency: 'CNY' } } }
  })
  function pageOffset(request) {
    const parsed = z.coerce.number().int().min(0).max(1000000).safeParse(request.query.offset ?? 0)
    if (!parsed.success) throw new StudioError('分页参数无效', 400)
    return parsed.data
  }
  const titleSchema = z.string().trim().min(1).max(100)
  function parseProject(schema, body) {
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) throw new StudioError('项目或素材请求格式无效', 400)
    return parsed.data
  }
  app.get('/api/studio/projects', async request => ({ success: true, data: projects.list(request.studioUser, pageOffset(request)) }))
  app.post('/api/studio/projects', async request => ({ success: true, data: projects.create(request.studioUser, parseProject(z.object({ title: titleSchema.default('新项目') }).strict(), request.body).title) }))
  app.post('/api/studio/projects/from-asset', async request => {
    const body = parseProject(z.object({ assetId: z.string().uuid(), title: titleSchema.default('生成图片项目') }).strict(), request.body)
    return { success: true, data: projects.create(request.studioUser, body.title, body.assetId) }
  })
  app.get('/api/studio/projects/:id', async request => ({ success: true, data: projects.get(request.studioUser, request.params.id) }))
  app.patch('/api/studio/projects/:id', async request => {
    const body = parseProject(z.object({ expectedRevision: z.number().int().min(1), title: titleSchema.optional(), document: documentSchema.optional() }).strict().refine(value => value.title !== undefined || value.document !== undefined), request.body)
    return { success: true, data: await projects.patch(request.studioUser, request.params.id, body) }
  })
  app.post('/api/studio/assets/from-run', async request => {
    const body = parseProject(z.object({ runId: z.string().uuid(), toolCallId: z.string().min(1).max(200), artifactIndex: z.number().int().min(0).max(99) }).strict(), request.body)
    return { success: true, data: await projects.fromRun(request.studioUser, body) }
  })
  app.get('/api/studio/assets/:id', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    return { success: true, data: projects.asset(request.studioUser, request.params.id, true) }
  })
  app.get('/api/studio/threads', async request => {
    const offset = pageOffset(request)
    const rows = history.list(request.studioUser, offset)
    return { success: true, data: { items: rows.slice(0, 50), nextOffset: rows.length > 50 ? offset + 50 : null } }
  })
  app.post('/api/studio/threads', async request => {
    const parsed = z.object({ title: z.string().trim().min(1).max(100).default('新对话') }).strict().safeParse(request.body ?? {})
    if (!parsed.success) throw new StudioError('会话标题无效', 400)
    return { success: true, data: history.create(request.studioUser, parsed.data.title) }
  })
  app.get('/api/studio/threads/:id', async request => ({ success: true, data: history.detail(request.studioUser, request.params.id, pageOffset(request)) }))
  app.get('/api/studio/runs/:id', async request => ({ success: true, data: history.getRun(request.studioUser, request.params.id) }))
  async function execute(request, kind, payload, action, transport, validate = () => {}) {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) throw new StudioError('缺少有效请求标识', 400)
    const owner = request.studioUser
    // Preserve hashes for sends created before balance consent was introduced.
    if (payload.payWithBalance !== true) delete payload.payWithBalance
    const begun = ledger.begin(owner, kind, key, payload, busy.has(owner))
    if (begun.conflict) throw new StudioError('同一请求标识不能修改参数', 409)
    if (begun.blocked) throw new StudioError('该请求正在处理或结果待确认，不能重复提交；请检查网关记录', 409)
    if (begun.result) {
      transport?.start()
      transport?.finish(begun.result)
      return { success: true, data: begun.result }
    }
    if (begun.busy) throw new StudioError('已有生成请求正在处理，本次请求尚未执行，请稍后重试', 409)
    busy.add(owner)
    let transportStarted = false, externalStarted = false
    try {
      fundingState.assertReady(owner)
      let context = config
      const managedFunding = config.relayCredentialMode === 'user-token'
      if (config.relayCredentialMode === 'user-token') {
        context = await userModels(config, request.headers.authorization, request.studioAccount, fetcher)
      }
      const benefit = validate(context)
      const fundingSelection = {}
      const choose = (modelKind, access) => {
        if (!['chat', 'image'].includes(modelKind)) throw new StudioError('模型请求类型无效', 500)
        if (!fundingSelection[modelKind]) {
          if (['active', 'eligible'].includes(access.state) && trial.remaining(owner, modelKind) > 0) fundingSelection[modelKind] = 'trial'
          else if (payload.payWithBalance === true) fundingSelection[modelKind] = 'wallet'
          else if (['active', 'eligible'].includes(access.state)) trial.assertAvailable(owner, modelKind)
          else throw new StudioError((access.reason ?? '当前试用不可用') + '；余额付款需勾选本次允许使用本人余额', 402)
        }
        return fundingSelection[modelKind]
      }
      let funding
      if (managedFunding) {
        const selected = choose(benefit, await fundingAccess(request, benefit))
        if (selected === 'wallet') {
          request.studioAccount = await walletPreflight(request)
        }
      }
      externalStarted = true
      if (managedFunding && fundingSelection[benefit] === 'trial') funding = await ensureTrial(request)
      if (config.relayCredentialMode === 'user-token') context = await userRelay(context, request.headers.authorization, request.studioAccount, fetcher, funding)
      if (payload.threadId) history.begin(owner, payload)
      transport?.start()
      transportStarted = Boolean(transport)
      const requests = []
      const result = await action({ ...context, onGatewayRequest: async info => {
        fundingState.assertReady(owner)
        let selected = 'account'
        if (managedFunding) {
          selected = choose(info.kind, fundingSelection[info.kind] ? {} : await fundingAccess(request, info.kind))
          if (selected === 'trial') {
            const current = await ensureTrial(request)
            if (current.state !== 'active') throw new StudioError(current.reason ?? '试用资金状态变化，未发送模型请求', 402)
          } else {
            await walletPreflight(request)
          }
          await fundingState.select(config, request.headers.authorization, owner, selected === 'trial' ? 'subscription_only' : 'wallet_only', fetcher)
          if (selected === 'trial') trial.reserve(owner, kind, key, info.kind)
        }
        // Persist before fetch: no response or request ID still leaves intent.
        ledger.submit(owner, kind, key, info, selected)
      }, ...((transport || payload.threadId) ? { onEvent: event => {
        if (payload.threadId) history.event(owner, key, event)
        transport?.event(event)
      } } : {}), onGatewayResponse: info => { ledger.gateway(owner, kind, key, info); requests.push(info) } })
      const usage = await settledUsage(config, request.headers.authorization, requests, fetcher)
      if (usage) result.usage = usage
      if (managedFunding) result.fundingSelection = fundingSelection
      // 会话终态与幂等结果同时提交，避免恢复时看到不一致的完成状态。
      ledger.db.exec('BEGIN')
      try {
        ledger.complete(owner, kind, key, result)
        if (managedFunding) trial.finish(owner, kind, key, !result.events || result.events.some(event => event.type === 'run.completed'))
        if (payload.threadId) history.finish(owner, key, result)
        ledger.db.exec('COMMIT')
      } catch (error) { ledger.db.exec('ROLLBACK'); throw error }
      transport?.finish(result)
      return { success: true, data: result }
    } catch (error) {
      trial.finish(owner, kind, key, false)
      if (externalStarted) ledger.unknown(owner, kind, key)
      else ledger.releaseUnstarted(owner, kind, key)
      if (payload.threadId) history.unknown(owner, key)
      if (transportStarted) { transport.fail(); return }
      throw error
    }
    finally { busy.delete(owner) }
  }
  function selectModel(id, kind, context) {
    const model = context.models.find(m => m.kind === kind && (id ? m.id === id : isAvailable(context, m)))
    if (!model || !isAvailable(context, model)) throw new StudioError(model?.availabilityReason ?? '尚未配置并验证可用模型，请先完成 New API 渠道接入', model?.availabilityReason ? 403 : 503)
    return model
  }
  app.post('/api/studio/images', async request => {
    const parsed = imageBody.safeParse(request.body)
    if (!parsed.success) throw new StudioError('图片请求格式无效', 400)
    let model
    return execute(request, 'image', parsed.data, context => (overrides.generateImage ?? generateImage)(context, model, parsed.data), undefined, context => { model = selectModel(parsed.data.model, 'image', context); return 'image' })
  })
  async function handleRun(request, reply, streaming = false) {
    const parsed = runBody.safeParse(request.body)
    if (!parsed.success) throw new StudioError('智能体请求格式无效', 400)
    if (parsed.data.threadId) history.require(request.studioUser, parsed.data.threadId)
    if (parsed.data.runId !== request.headers['idempotency-key']) throw new StudioError('任务标识与请求标识不一致', 400)
    if (parsed.data.videoGenerationPreference) throw new StudioError('视频生成将在后续接入')
    if (parsed.data.mentions?.some(m => m?.mentionType !== 'image-model')) throw new StudioError('品牌库和自定义技能尚未接入')
    let imageOnly = false, model
    const validate = context => {
      for (const id of parsed.data.imageGenerationPreference?.models ?? []) selectModel(id, 'image', context)
      const selected = parsed.data.model ? context.models.find(m => m.id === parsed.data.model) : undefined
      if (parsed.data.model && !selected) throw new StudioError('所选模型尚未接入', 503)
      if (selected?.kind === 'image' && parsed.data.imageGenerationPreference?.models?.some(id => id !== selected.id)) throw new StudioError('两处图片模型选择不一致，请选择同一个模型')
      imageOnly = selected?.kind === 'image' || (!selected && !context.models.some(m => m.kind === 'chat' && isAvailable(context, m)))
      model = selectModel(imageOnly ? selected?.id ?? parsed.data.imageGenerationPreference?.models?.[0] : parsed.data.model, imageOnly ? 'image' : 'chat', context)
      return imageOnly ? 'image' : 'chat'
    }
    // 两种传输共用去重范围；终态必须在保存完整结果后才发送。
    let transport
    if (streaming) {
      let heartbeat
      let sent = 0
      const write = event => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      const end = () => { clearInterval(heartbeat); if (!reply.raw.destroyed) reply.raw.end() }
      transport = {
        start() {
          reply.hijack()
          reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })
          reply.raw.flushHeaders()
          heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(': keepalive\n\n') }, 15000)
          heartbeat.unref()
          // 断开传输不等于供应商取消；继续有限执行并保存结果供同 ID 重放。
          reply.raw.once('close', () => clearInterval(heartbeat))
        },
        event(event) {
          if (event.type === 'run.completed' || event.type === 'run.failed') return
          sent++
          write(event)
        },
        finish(result) {
          for (const event of result.events.slice(sent)) write({ ...event, ...(['run.completed', 'run.failed'].includes(event.type) && result.usage ? { usage: result.usage } : {}) })
          end()
        },
        fail() {
          write({ type: 'run.failed', runId: parsed.data.runId, timestamp: new Date().toISOString(), error: { code: 'result_unknown', message: '请求结果待确认；未自动重试，请检查网关记录。' } })
          end()
        },
      }
    }
    return execute(request, 'agent', parsed.data, context => {
      const agentPayload = parsed.data.threadId ? { ...parsed.data, history: history.context(request.studioUser, parsed.data.threadId) } : parsed.data
      return imageOnly
      ? (overrides.runImage ?? runImage)(context, model, agentPayload)
      : (overrides.runAgent ?? runAgent)(context, model, agentPayload)
    }, transport, validate)
  }
  app.post('/api/studio/runs', (request, reply) => handleRun(request, reply))
  app.post('/api/studio/runs/stream', (request, reply) => handleRun(request, reply, true))
  return app
}
