import Fastify from 'fastify'
import { z } from 'zod'
import { catalog, isAvailable, generationEnabled } from './config.mjs'
import { Projects, documentSchema, validateImage } from './projects.mjs'
import { History } from './history.mjs'
import { Ledger } from './ledger.mjs'
import { generateImage, decodeImage, StudioError } from './images.mjs'
import { runAgent, runImage } from './agent.mjs'
import { userModels, userRelay } from './user-relay.mjs'
import { billingSummary, recordedUsage, normalizeResultUsage } from './billing.mjs'
import { Trial } from './trial.mjs'
import { inspectTrialFunding, purchaseTrial } from './trial-funding.mjs'
import { readFundingAccount } from './funding.mjs'
import { FundingState } from './funding-state.mjs'
import { validateAccountUpdate, passthroughAccountUpdate } from './account-update.mjs'
import { profileBody, updateStudioProfile } from './profile.mjs'
import { inspectWalletFunding } from './wallet-funding.mjs'
import { readStudioToken, proveRetired, createReplacement, approvedReplacement } from './relay-access.mjs'
import { RelayRenewals, accessVersion, buildRenewalTarget } from './relay-renewals.mjs'
import { ImageJobs, imageApproval } from './image-jobs.mjs'

const imageBody = z.object({ prompt: z.string().trim().min(1).max(8000), payWithBalance: z.boolean().optional(), model: z.string().max(100).optional(), quality: z.string().max(40).optional(), aspectRatio: z.string().max(20).optional(), inputImages: z.array(z.string().max(12 * 1024 * 1024)).max(4).default([]) }).strict()
const runBody = z.object({ threadId: z.string().uuid().optional(), runId: z.string().uuid(), prompt: z.string().trim().min(1).max(8000), model: z.string().max(100).optional(),
  sessionId: z.string().max(100), conversationId: z.string().max(100), canvasId: z.string().max(100).optional(),
  attachments: z.array(z.object({ url: z.string().max(12 * 1024 * 1024), mimeType: z.string(), assetId: z.string(), source: z.enum(['upload', 'canvas', 'canvas-ref']), name: z.string().optional() })).max(4).optional(),
  imageGenerationPreference: z.object({ mode: z.enum(['auto', 'manual']), models: z.array(z.string()).max(1) }).optional(),
  videoGenerationPreference: z.unknown().optional(), mentions: z.array(z.unknown()).max(20).optional(), payWithBalance: z.boolean().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000).optional(), contentBlocks: z.array(z.unknown()).max(100).nullable().optional() }).passthrough()).max(12).optional(),
  canvasContext: z.array(z.record(z.unknown())).max(80).optional(),
}).strict()
// Recovery exposes only fields produced by this adapter, never arbitrary saved
// metadata. Zod's object projection strips unknown fields at every nested level.
const savedUsage = z.object({ state: z.enum(['settled', 'recorded', 'pending']), settlementState: z.literal('unconfirmed').optional(),
  requestCount: z.number().int().nonnegative().safe(), requestIds: z.array(z.string().regex(/^[\w-]{1,64}$/)).max(100),
  currency: z.literal('CNY'), quota: z.number().int().nonnegative().safe().optional(), cost: z.number().finite().nonnegative().optional() })
const savedImage = z.object({ url: z.string().max(40 * 1024 * 1024 + 64).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    .refine(value => value.length - value.indexOf(',') - 1 <= 40 * 1024 * 1024),
  prompt: z.string().max(8000).optional(), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  width: z.number().int().positive().safe().optional(), height: z.number().int().positive().safe().optional() })
const eventBase = { runId: z.string().max(100).optional(), timestamp: z.string().datetime().optional() }
const savedEvent = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run.started'), sessionId: z.string().max(100).optional(), conversationId: z.string().max(100).optional() }),
  z.object({ ...eventBase, type: z.literal('message.delta'), messageId: z.string().max(100).optional(), delta: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool.started'), toolCallId: z.string().max(200), toolName: z.literal('generate_image'),
    input: z.object({ prompt: z.string().max(8000), model: z.string().max(100) }).optional() }),
  z.object({ ...eventBase, type: z.literal('tool.completed'), toolCallId: z.string().max(200), toolName: z.literal('generate_image').optional(),
    outputSummary: z.string().optional(), artifacts: z.array(savedImage.extend({ type: z.literal('image') })).max(1).optional() }),
  z.object({ ...eventBase, type: z.literal('run.completed'), usage: savedUsage.optional() }),
  z.object({ ...eventBase, type: z.literal('run.failed'), error: z.object({ code: z.string().max(100), message: z.string() }).optional(), usage: savedUsage.optional() }),
])
// This is the user's selected source, not proof of consumption or settlement.
const savedFunding = z.object({ chat: z.enum(['trial', 'wallet']).optional(), image: z.enum(['trial', 'wallet']).optional() })
const savedResults = { image: savedImage.extend({ usage: savedUsage.optional(), fundingSelection: savedFunding.optional() }),
  agent: z.object({ events: z.array(savedEvent), usage: savedUsage.optional(), fundingSelection: savedFunding.optional() }) }
export function createServer(config, overrides = {}) {
  config = { ...config, accountInstanceId: config.accountInstanceId ?? config.trial?.instanceId }
  config.maxImageJobs = z.number().int().min(1).max(16).parse(config.maxImageJobs ?? 2)
  if (config.trial && config.accountInstanceId !== config.trial.instanceId) throw new Error('试用政策属于另一 New API 实例，不能混用账号实例标识')
  if (config.relayCredentialMode === 'user-token' && !z.string().uuid().safeParse(config.accountInstanceId).success) throw new Error('每用户模式必须绑定稳定的账号实例标识')
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024, requestTimeout: 150_000 })
  const fetcher = overrides.fetch ?? fetch
  const ledger = new Ledger(config.ledgerPath)
  let trial, history, fundingState, projects, renewals, jobs
  try {
    trial = new Trial(ledger.db, config.trial, config.accountInstanceId ?? config.trial?.instanceId)
    history = new History(ledger.db)
    fundingState = new FundingState(ledger.db)
    renewals = new RelayRenewals(ledger.db)
    projects = new Projects(ledger.db, history)
    jobs = new ImageJobs(ledger)
  } catch (error) { ledger.close(); throw error }
  const busy = new Set()
  const background = new Set()
  let closing = false
  const ownerBusy = owner => busy.has(owner) || jobs.active(owner)
  app.addHook('onClose', async () => { closing = true; await Promise.allSettled([...background]); ledger.close() })
  app.setErrorHandler((error, _request, reply) => reply.code(error.status ?? error.statusCode ?? 500).send({ success: false, message: error instanceof StudioError ? error.message : error.validation ? '请求格式无效' : '创作服务请求失败' }))
  app.get('/api/studio/health', async () => ({ success: true, data: { service: 'gouo-studio-api', localDrafts: true } }))
  app.get('/api/studio/models', async request => ({ success: true, data: catalog(request.studioConfig ?? config) }))
  async function authenticate(token) {
    if (typeof token !== 'string' || !/^Bearer \S{1,4096}$/.test(token)) throw new StudioError('请先登录 New API 账号', 401)
    // Never trust browser-supplied user IDs or relay tokens.
    let response
    try { response = await fetcher(new URL('/api/user/self', config.authOrigin), { headers: { Authorization: token }, redirect: 'error', signal: AbortSignal.timeout(10_000) }) } catch { throw new StudioError('账号服务暂不可用', 502) }
    const body = await response.json().catch(() => null)
    if (response.status >= 500) throw new StudioError('账号服务暂不可用', 502)
    if (response.status === 403) throw new StudioError('账号已禁用或无权访问，请在原生账户页面核对', 403)
    if (!response.ok || body?.success !== true || !Number.isSafeInteger(body.data?.id) || body.data.id <= 0) throw new StudioError('登录会话已失效', 401)
    return body.data
  }
  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.url === '/api/studio/health' || (request.routeOptions.url === '/api/studio/models' && config.relayCredentialMode !== 'user-token')) return
    const token = request.headers.authorization
    const account = await authenticate(token)
    if (request.method === 'POST' && ['/api/studio/images', '/api/studio/runs', '/api/studio/runs/stream', '/api/studio/image-jobs', '/api/studio/image-jobs/:id/authorize'].includes(request.routeOptions.url)) {
      if (config.allowGeneration && config.relayKey && !generationEnabled(config)) throw new StudioError('生成服务缺少有效的 GOUO_RELAY_OWNER_ID，请联系管理员配置令牌所属账号', 503)
      if (config.relayOwnerId !== undefined && account.id !== config.relayOwnerId) throw new StudioError('当前账号尚未连接自己的生成令牌', 403)
    }
    if (config.relayCredentialMode === 'user-token') {
      if (account.status !== 1) throw new StudioError('账号已禁用，请联系管理员', 403)
      if (['/api/studio/models', '/api/studio/billing'].includes(request.routeOptions.url)) {
        request.studioConfig = await userModels(config, token, account, fetcher)
      }
    }
    request.studioUser = account.id
    request.studioAccount = account
  })
  app.get('/api/studio/billing', async request => ({ success: true, data: await billingSummary(request.studioConfig ?? config, request.headers.authorization, request.studioAccount, fetcher) }))
  app.put('/api/studio/profile', async (request, reply) => {
    const body = profileBody(request.body)
    const owner = request.studioUser
    if (ownerBusy(owner)) throw new StudioError('本人已有操作正在处理，请等待完成后再修改账号', 409)
    busy.add(owner)
    reply.header('Cache-Control', 'no-store')
    try { return { success: true, data: await updateStudioProfile(config, request.headers.authorization, owner, body, fetcher) } }
    finally { busy.delete(owner) }
  })
  // The native UI keeps its own security-proof and auth-rotation flow. Only
  // this exact PUT is routed here by the opt-in edge; no new account system.
  app.put('/api/user/self', async (request, reply) => {
    validateAccountUpdate(request.body)
    const owner = request.studioUser
    if (ownerBusy(owner)) throw new StudioError('本人已有操作正在处理，请等待完成后再修改账号', 409)
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
  async function renewalFunds(request, context) {
    const account = await readFundingAccount(config, request.headers.authorization, request.studioUser, fetcher)
    if (account.group !== request.studioAccount.group) throw new StudioError('账号分组已变化，请刷新权限后再续用', 409)
    if (trial.grant(account.id) && trial.grant(account.id).status !== 'active') throw new StudioError('原试用领取记录待核对，不能续用', 409)
    if (account.quota > 0) {
      await inspectWalletFunding(config, request.headers.authorization, account, trial.grant(account.id), fetcher)
      return { account, quota: Math.min(account.quota, context.userTokenQuotaCap) }
    }
    if (config.trial && trial.grant(account.id)?.status === 'active' && (trial.remaining(account.id, 'chat') > 0 || trial.remaining(account.id, 'image') > 0)) {
      const funding = await inspectFunding({ ...request, studioAccount: account })
      if (funding.state === 'active') return { account, quota: funding.tokenQuota }
    }
    throw new StudioError('本人原生资金不足，不能续用生成权限；未充值或重新领取试用', 402)
  }
  function renewalReady(owner) {
    fundingState.assertReady(owner); renewals.assertReady(owner)
    if (renewals.unresolvedGeneration(owner)) throw new StudioError('本人旧生成请求或占用次数尚未核对，不能续用权限；不会自动重试或退款', 409)
  }
  app.get('/api/studio/access', async request => {
    const unavailable = message => ({ success: true, data: { state: 'unavailable', message, canRenew: false } })
    if (config.relayCredentialMode !== 'user-token' || !generationEnabled(config)) return unavailable('生成权限尚未开放，由管理员核验配置后启用')
    const owner = request.studioUser
    if (fundingState.blocked(owner) || renewals.blocked(owner) || renewals.unresolvedGeneration(owner) || trial.grant(owner)?.status === 'unknown') {
      return { success: true, data: { state: 'unknown', message: '本人旧操作结果待核对，已暂停权限续用；查询不会重试写入或模型', canRenew: false } }
    }
    const context = await userModels(config, request.headers.authorization, request.studioAccount, fetcher)
    const inspected = await readStudioToken(context, request.headers.authorization, request.studioAccount, fetcher, renewals.binding(owner))
    const messages = { ready: '生成权限可用，模型费用由 New API 结算', missing: '首次发送时核验并建立有限生成权限，查询不会创建',
      expired: '有限生成权限已到期，原生钱包余额与旧试用记录保留', exhausted: '有限生成权限已用完，原生钱包余额与旧试用记录保留',
      disabled: '生成令牌已停用，不能通过续用绕过停用；请联系管理员', incompatible: '生成权限与批准配置不一致，请联系管理员核对' }
    let canRenew = false
    if (config.tokenRenewalPolicy && !ownerBusy(owner) && ['expired', 'exhausted'].includes(inspected.state)) {
      try { await renewalFunds(request, context); canRenew = true } catch (error) {
        return { success: true, data: { state: inspected.state, message: messages[inspected.state] + '；' + error.message, canRenew: false } }
      }
    }
    return { success: true, data: { state: inspected.state, message: messages[inspected.state], canRenew,
      ...(canRenew ? { version: accessVersion(config, owner, inspected), approvedLifetimeSeconds: config.userTokenLifetimeSeconds } : {}),
      ...(inspected.token ? { expiresAt: inspected.token.expired_time } : {}) } }
  })
  app.post('/api/studio/access/renew', async request => {
    const payload = z.object({ version: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) }).strict().safeParse(request.body)
    const key = request.headers['idempotency-key'], owner = request.studioUser
    if (!payload.success || typeof key !== 'string' || !z.string().uuid().safeParse(key).success) throw new StudioError('请查询本人权限并明确确认本次续用', 400)
    const previous = renewals.replay(owner, key, payload.data)
    if (previous) return { success: true, data: previous }
    if (!config.tokenRenewalPolicy || config.relayCredentialMode !== 'user-token' || !generationEnabled(config)) throw new StudioError('生成权限续用尚未开放，未修改原生令牌', 503)
    if (ownerBusy(owner)) throw new StudioError('本人已有操作正在处理，请等待完成后再续用', 409)
    renewalReady(owner); busy.add(owner)
    let begun = false
    try {
      const context = await userModels(config, request.headers.authorization, request.studioAccount, fetcher)
      const inspected = await readStudioToken(context, request.headers.authorization, request.studioAccount, fetcher, renewals.binding(owner))
      if (payload.data.version !== accessVersion(config, owner, inspected)) throw new StudioError('本人权限已变化，请重新查询后再明确续用', 409)
      if (!['expired', 'exhausted'].includes(inspected.state)) throw new StudioError('仅已知到期或耗尽的有限权限可以续用；不能扩大或启用停用令牌', 409)
      const funds = await renewalFunds(request, context)
      const target = buildRenewalTarget(context, owner, inspected, approvedReplacement(context,
        'gouo-studio-' + crypto.randomUUID().replaceAll('-', ''), funds.quota, inspected.nativeNow + config.userTokenLifetimeSeconds))
      renewals.begin(owner, key, payload.data, inspected.token.id, target); begun = true
      const retired = await proveRetired(context, request.headers.authorization, funds.account, fetcher, inspected)
      renewals.saveProof(owner, key, retired.retirementProof)
      // No purchase, preference change, old-token PUT or model request.
      const binding = await createReplacement(context, request.headers.authorization, funds.account, fetcher, target)
      const result = { state: 'ready', message: '有限生成权限已续用；没有充值、重新领取试用或发送模型请求' }
      renewals.complete(owner, key, binding, result)
      return { success: true, data: result }
    } catch (error) { if (begun) renewals.unknown(owner, key); throw error }
    finally { busy.delete(owner) }
  })
  async function inspectFunding(request, nativeFetcher = fetcher) {
    const owner = request.studioUser
    const grant = trial.grant(owner)
    if (grant && grant.plan_id !== config.trial.planId) throw new StudioError('试用计划已变化，原领取记录不能重置，请联系管理员', 409)
    const funding = await inspectTrialFunding(config, request.headers.authorization, request.studioAccount, nativeFetcher, { checkPreference: false })
    if (grant?.subscription_id && funding.subscriptionId && grant.subscription_id !== funding.subscriptionId) throw new StudioError('原生试用领取证据变化，未修改扣费偏好或重新领取', 409)
    return funding
  }
  async function ensureTrial(request, nativeFetcher = fetcher) {
    const owner = request.studioUser
    let funding = await inspectFunding(request, nativeFetcher)
    if (funding.state === 'active') { trial.activate(owner, funding.subscriptionId); return funding }
    if (funding.state !== 'eligible') throw new StudioError(funding.reason ?? '试用资金不可用，请前往 New API 原生页面核对', 402)
    // Persist purchase intent before the native, non-idempotent HTTP operation.
    // An ambiguous result is recovered only from the native receipt, never by
    // purchasing again, even after a restart or with a different run ID.
    if (!trial.beginClaim(owner)) throw new StudioError('试用领取结果待确认，请核对原生订阅记录；未自动重复领取', 409)
    try {
      await purchaseTrial(config, request.headers.authorization, nativeFetcher)
      funding = await inspectFunding(request, nativeFetcher)
      if (funding.state !== 'active') throw new StudioError('试用资金领取结果待确认，未发出模型请求', 502)
      trial.activate(owner, funding.subscriptionId)
      return funding
    } catch (error) { trial.unknownClaim(owner); throw error }
  }
  app.get('/api/studio/requests/:kind/:id', async request => {
    if (!['image', 'agent'].includes(request.params.kind) || !/^[\w-]{8,100}$/.test(request.params.id)) throw new StudioError('请求标识无效', 400)
    const record = ledger.detail(request.studioUser, request.params.kind, request.params.id)
    if (!record) throw new StudioError('请求不存在', 404)
    const usage = await recordedUsage(config, request.headers.authorization, record.attempts, fetcher)
    return { success: true, data: { ...record, usage: usage ?? { state: 'pending', settlementState: 'unconfirmed', requestCount: 0, requestIds: [], currency: 'CNY' } } }
  })
  app.get('/api/studio/requests/:kind/:id/result', async (request, reply) => {
    const { kind, id } = request.params
    if (!['image', 'agent'].includes(kind) || !/^[\w-]{8,100}$/.test(id)) throw new StudioError('请求标识无效', 400)
    reply.header('Cache-Control', 'private, no-store')
    let record
    try {
      record = ledger.recovery(request.studioUser, kind, id)
      if (record) {
        z.string().datetime().parse(record.createdAt)
        if (record.status === 'completed') record.result = normalizeResultUsage(savedResults[kind].parse(record.result))
      }
    } catch { throw new StudioError('已保存的请求结果无法安全读取，请联系管理员核对；未重新生成', 502) }
    if (!record) throw new StudioError('请求不存在', 404)
    return { success: true, data: { kind, requestId: id, ...record } }
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
    const search = z.string().trim().max(100).optional().safeParse(request.query.search)
    if (!search.success) throw new StudioError('会话搜索词无效，最多 100 个字符', 400)
    const rows = history.list(request.studioUser, offset, search.data ?? '')
    return { success: true, data: { items: rows.slice(0, 50), nextOffset: rows.length > 50 ? offset + 50 : null } }
  })
  app.post('/api/studio/threads', async request => {
    const parsed = z.object({ title: z.string().trim().min(1).max(100).default('新对话') }).strict().safeParse(request.body ?? {})
    if (!parsed.success) throw new StudioError('会话标题无效', 400)
    return { success: true, data: history.create(request.studioUser, parsed.data.title) }
  })
  app.get('/api/studio/threads/:id', async request => ({ success: true, data: history.detail(request.studioUser, request.params.id, pageOffset(request)) }))
  app.get('/api/studio/runs/:id', async request => ({ success: true, data: history.getRun(request.studioUser, request.params.id) }))
  async function execute(request, kind, payload, action, transport, validate = () => {}, job) {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) throw new StudioError('缺少有效请求标识', 400)
    const owner = request.studioUser
    // Preserve hashes for sends created before balance consent was introduced.
    if (payload.payWithBalance !== true) delete payload.payWithBalance
    const begun = job ? { started: true } : ledger.begin(owner, kind, key, payload, ownerBusy(owner))
    if (begun.conflict) throw new StudioError('同一请求标识不能修改参数', 409)
    if (begun.blocked) throw new StudioError('该请求正在处理或结果待确认，不能重复提交；请检查网关记录', 409)
    if (begun.result) {
      transport?.start()
      const result = normalizeResultUsage(begun.result)
      transport?.finish(result)
      return { success: true, data: result }
    }
    if (begun.busy) throw new StudioError('已有生成请求正在处理，本次请求尚未执行，请稍后重试', 409)
    busy.add(owner)
    const nativeFetcher = job ? (url, init) => {
      const path = new URL(url).pathname, method = init?.method ?? 'GET'
      // Token-key POST is a read. Only these Native mutations create a durable
      // uncertain-write window; helper receipt/readback success clears it below.
      if ((method === 'POST' && ['/api/token/', '/api/subscription/balance/pay'].includes(path))
        || (method === 'PUT' && path === '/api/subscription/self/preference')) jobs.native(owner, key, true)
      return fetcher(url, init)
    } : fetcher
    let transportStarted = false, externalStarted = false
    try {
      fundingState.assertReady(owner)
      renewals.assertReady(owner)
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
        if (job && fundingSelection[modelKind] !== job.funding_source) throw new StudioError('原图片任务的付款来源已变化，未切换余额或重新领取', 409)
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
      if (managedFunding && fundingSelection[benefit] === 'trial') {
        funding = await ensureTrial(request, nativeFetcher)
        if (job) jobs.native(owner, key, false)
      }
      if (config.relayCredentialMode === 'user-token') context = await userRelay({ ...context, userTokenBinding: renewals.binding(owner) }, request.headers.authorization, request.studioAccount, nativeFetcher, funding)
      if (job && managedFunding) jobs.native(owner, key, false)
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
            const current = await ensureTrial(request, nativeFetcher)
            if (current.state !== 'active') throw new StudioError(current.reason ?? '试用资金状态变化，未发送模型请求', 402)
            if (job) jobs.native(owner, key, false)
          } else {
            await walletPreflight(request)
          }
          await fundingState.select(config, request.headers.authorization, owner, selected === 'trial' ? 'subscription_only' : 'wallet_only', nativeFetcher)
          if (job) jobs.native(owner, key, false)
          if (!job && selected === 'trial') trial.reserve(owner, kind, key, info.kind)
        }
        // Persist before fetch: no response or request ID still leaves intent.
        if (job) jobs.transaction(() => {
          jobs.submitted(owner, key)
          if (selected === 'trial') trial.reserve(owner, kind, key, info.kind, false)
          ledger.submit(owner, kind, key, info, selected)
        })
        else ledger.submit(owner, kind, key, info, selected)
      }, ...((transport || payload.threadId) ? { onEvent: event => {
        if (payload.threadId) history.event(owner, key, event)
        transport?.event(event)
      } } : {}), onGatewayResponse: info => { ledger.gateway(owner, kind, key, info); requests.push(info) } })
      if (managedFunding) result.fundingSelection = fundingSelection
      if (job) {
        if (requests.length) result.usage = { state: 'pending', settlementState: 'unconfirmed', requestCount: requests.length,
          requestIds: requests.map(info => info.requestId).filter(id => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)), currency: 'CNY' }
        const prepared = await validateImage(result.url)
        const output = savedResults.image.parse({ ...result, width: prepared.metadata.width, height: prepared.metadata.height, mimeType: `image/${prepared.metadata.format}` })
        jobs.transaction(() => {
          const asset = projects.saveImage(owner, key, prepared)
          jobs.saveOutput(owner, key, output, asset.id)
        })
        const usage = await recordedUsage(config, request.headers.authorization, requests, fetcher)
        if (usage) {
          output.usage = usage
          ledger.db.prepare("UPDATE image_jobs SET output=? WHERE owner=? AND key=? AND status='output_saved'").run(JSON.stringify(output), owner, key)
        }
        finalizeJob(owner, key)
        return { success: true, data: output }
      }
      const usage = await recordedUsage(config, request.headers.authorization, requests, fetcher)
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
      if (job) {
        if (jobs.require(owner, key).status !== 'output_saved') { trial.finish(owner, kind, key, false); jobs.interrupted(owner, key) }
        throw error
      }
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
  function jobId(value) {
    if (!z.string().uuid().safeParse(value).success) throw new StudioError('图片任务标识无效', 400)
    return value
  }
  function jobsEnabled() {
    if (!config.enableImageJobs || !generationEnabled(config)) throw new StudioError('后台图片任务尚未开放，未发送模型请求', 503)
  }
  async function jobApproval(request, payload, existing) {
    fundingState.assertReady(request.studioUser); renewals.assertReady(request.studioUser)
    if (request.studioAccount.status !== 1) throw new StudioError('账号已禁用，未受理图片任务', 403)
    const context = config.relayCredentialMode === 'user-token' ? await userModels(config, request.headers.authorization, request.studioAccount, fetcher) : config
    const model = selectModel(existing?.model_id ?? payload.model, 'image', context)
    if (payload.quality && !model.qualities?.includes(payload.quality)) throw new StudioError('该渠道未验证所选质量参数')
    if (payload.aspectRatio && !model.sizes?.[payload.aspectRatio]) throw new StudioError('该渠道未验证所选画面比例')
    if (!model.operations?.includes(payload.inputImages.length ? 'edit' : 'generate')) throw new StudioError('该模型当前不支持此图片操作')
    for (const input of payload.inputImages) { await decodeImage(input); await validateImage(input) }
    let funding = 'account'
    if (config.relayCredentialMode === 'user-token') {
      const access = await fundingAccess(request, 'image')
      if (['active','eligible'].includes(access.state) && trial.remaining(request.studioUser, 'image') > 0) funding = 'trial'
      else if (payload.payWithBalance === true) { funding = 'wallet'; await walletPreflight(request) }
      else throw new StudioError('当前生图试用不可用；余额付款需要本次明确同意', 402)
    }
    const approval = imageApproval(config, model, request.studioAccount)
    if (existing && (approval !== existing.approval_hash || funding !== existing.funding_source)) throw new StudioError('原图片任务的模型能力或付款批准已变化，未切换或外发', 409)
    return { model, approval, funding }
  }
  function finalizeJob(owner, key) {
    const row = jobs.require(owner, key)
    if (row.status !== 'output_saved') throw new StudioError('图片任务没有可本地完成的已保存输出', 409)
    const output = savedResults.image.parse(JSON.parse(row.output)), asset = projects.verifySavedImage(owner, row.asset_id)
    if (asset.dataURL !== output.url || asset.width !== output.width || asset.height !== output.height || asset.mimeType !== output.mimeType) throw new StudioError('已保存图片与任务结果不一致，未重新生成', 502)
    jobs.transaction(() => {
      trial.finishSavedImage(owner, key)
      jobs.finalize(owner, key, output)
    })
  }
  function scheduleJob(request, key) {
    // Credentials belong only to this in-memory, explicit authorization. No
    // queue message or persisted job contains Bearer, Cookie or relay keys.
    const authorization = request.headers.authorization, owner = request.studioUser
    const task = new Promise(resolve => setImmediate(resolve)).then(async () => {
      if (closing) { jobs.interrupted(owner, key); return }
      const row = jobs.require(owner, key)
      if (row.status !== 'accepted') return
      try {
        const account = await authenticate(authorization)
        if (account.id !== owner) throw new StudioError('图片任务授权账号已变化', 401)
        const resumed = { studioUser: owner, studioAccount: account, headers: { authorization, 'idempotency-key': key } }
        const payload = imageBody.parse(jobs.payload(row))
        await jobApproval(resumed, payload, row)
        jobs.ready(owner, key)
        let model
        await execute(resumed, 'image', payload, context => (overrides.generateImage ?? generateImage)(context, model, payload), undefined,
          context => { model = selectModel(row.model_id, 'image', context); if (imageApproval(config, model, resumed.studioAccount) !== row.approval_hash) throw new StudioError('图片能力批准已变化', 409); return 'image' }, row)
      } catch { if (!['unknown','needs_authorization','completed','output_saved','cancelled_before_submission'].includes(jobs.require(owner, key).status)) jobs.interrupted(owner, key) }
    })
    background.add(task)
    task.finally(() => background.delete(task)).catch(() => {})
  }
  for (const row of jobs.pendingOutputs()) {
    // Only local asset/result completion is recoverable without user credentials.
    try { finalizeJob(row.owner, row.key) } catch { /* Keep output_saved and its private original for explicit local recovery. */ }
  }
  app.post('/api/studio/image-jobs', async (request, reply) => {
    jobsEnabled()
    const key = jobId(request.headers['idempotency-key']), parsed = imageBody.safeParse(request.body)
    if (!parsed.success) throw new StudioError('图片任务请求格式无效', 400)
    const payload = parsed.data, owner = request.studioUser
    if (payload.payWithBalance !== true) delete payload.payWithBalance
    const previous = jobs.previous(owner, key, payload)
    reply.header('Cache-Control', 'private, no-store')
    if (previous) {
      if (['unknown','needs_authorization','cancelled_before_submission'].includes(previous.status)) throw new StudioError('该图片任务不能重复提交，请只读查询或明确处理原任务', 409)
      return reply.code(previous.status === 'completed' ? 200 : 202).send({ success: true, data: jobs.summary(previous) })
    }
    if (ownerBusy(owner)) throw new StudioError('本人已有操作正在处理，本次图片任务尚未受理', 409)
    busy.add(owner)
    try {
      const { model, approval, funding } = await jobApproval(request, payload)
      const summary = jobs.accept(owner, key, payload, approval, model.id, funding, false, config.maxImageJobs)
      scheduleJob(request, key)
      return reply.code(202).send({ success: true, data: summary })
    } finally { busy.delete(owner) }
  })
  app.get('/api/studio/image-jobs/:id', async (request, reply) => {
    const key = jobId(request.params.id), owner = request.studioUser, row = jobs.publicRow(owner, key)
    reply.header('Cache-Control', 'private, no-store')
    const data = jobs.summary(row)
    if (row.status === 'completed') {
      try { data.result = normalizeResultUsage(savedResults.image.parse(ledger.recovery(owner, 'image', key)?.result)) }
      catch { throw new StudioError('已保存图片结果无法安全读取，未重新生成', 502) }
    }
    return { success: true, data }
  })
  app.post('/api/studio/image-jobs/:id/authorize', async (request, reply) => {
    jobsEnabled()
    if (!z.object({ confirm: z.literal(true) }).strict().safeParse(request.body).success) throw new StudioError('请明确重新授权原图片任务，不能改变原参数或付款同意', 400)
    const key = jobId(request.params.id), owner = request.studioUser, row = jobs.require(owner, key)
    if (row.status !== 'needs_authorization') throw new StudioError('该图片任务不允许重新授权生成', 409)
    if (ownerBusy(owner)) throw new StudioError('本人已有操作正在处理，未重新授权', 409)
    busy.add(owner)
    try {
      const payload = imageBody.parse(jobs.payload(row)), { approval } = await jobApproval(request, payload, row)
      const summary = jobs.authorize(owner, key, approval, false, config.maxImageJobs)
      scheduleJob(request, key)
      return reply.code(202).send({ success: true, data: summary })
    } finally { busy.delete(owner) }
  })
  app.post('/api/studio/image-jobs/:id/cancel', async request => {
    if (!z.object({ confirm: z.literal(true) }).strict().safeParse(request.body).success) throw new StudioError('请明确取消确定未提交的图片任务', 400)
    const key = jobId(request.params.id), owner = request.studioUser
    jobs.require(owner, key)
    fundingState.assertReady(owner); renewals.assertReady(owner)
    if (busy.has(owner)) throw new StudioError('任务正在核验或提交，不能确认尚未外发，请只读查询', 409)
    return { success: true, data: jobs.cancel(owner, key) }
  })
  app.post('/api/studio/image-jobs/:id/finalize', async request => {
    const key = jobId(request.params.id), owner = request.studioUser
    jobs.require(owner, key)
    if (busy.has(owner)) throw new StudioError('图片结果正在保存，请稍后只读查询', 409)
    try { finalizeJob(owner, key) } catch (error) { if (error instanceof StudioError) throw error; throw new StudioError('图片本地完成暂不可用，原图保留且未重新生成', 502) }
    return { success: true, data: jobs.summary(jobs.require(owner, key)) }
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
