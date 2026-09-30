import Fastify from 'fastify'
import { z } from 'zod'
import { catalog, isAvailable } from './config.mjs'
import { Ledger } from './ledger.mjs'
import { generateImage, StudioError } from './images.mjs'
import { runAgent, runImage } from './agent.mjs'

const imageBody = z.object({ prompt: z.string().trim().min(1).max(8000), model: z.string().max(100).optional(), quality: z.string().max(40).optional(), aspectRatio: z.string().max(20).optional(), inputImages: z.array(z.string().max(12 * 1024 * 1024)).max(4).default([]) }).strict()
const runBody = z.object({ runId: z.string().uuid(), prompt: z.string().trim().min(1).max(8000), model: z.string().max(100).optional(),
  sessionId: z.string().max(100), conversationId: z.string().max(100), canvasId: z.string().max(100).optional(),
  attachments: z.array(z.object({ url: z.string().max(12 * 1024 * 1024), mimeType: z.string(), assetId: z.string(), source: z.enum(['upload', 'canvas', 'canvas-ref']), name: z.string().optional() })).max(4).optional(),
  imageGenerationPreference: z.object({ mode: z.enum(['auto', 'manual']), models: z.array(z.string()).max(1) }).optional(),
  videoGenerationPreference: z.unknown().optional(), mentions: z.array(z.unknown()).max(20).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000).optional(), contentBlocks: z.array(z.unknown()).max(100).nullable().optional() }).passthrough()).max(12).optional(),
  canvasContext: z.array(z.record(z.unknown())).max(80).optional(),
}).strict()
export function createServer(config, overrides = {}) {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024, requestTimeout: 150_000 })
  const fetcher = overrides.fetch ?? fetch
  const ledger = new Ledger(config.ledgerPath)
  const busy = new Set()
  app.addHook('onClose', async () => ledger.close())
  app.setErrorHandler((error, _request, reply) => reply.code(error.status ?? error.statusCode ?? 500).send({ success: false, message: error instanceof StudioError ? error.message : error.validation ? '请求格式无效' : '创作服务请求失败' }))
  app.get('/api/studio/health', async () => ({ success: true, data: { service: 'gouo-studio-api', localDrafts: true } }))
  app.get('/api/studio/models', async () => ({ success: true, data: catalog(config) }))
  app.addHook('preHandler', async (request) => {
    if (['/api/studio/models', '/api/studio/health'].includes(request.routeOptions.url)) return
    const token = request.headers.authorization
    if (typeof token !== 'string' || !/^Bearer \S{1,4096}$/.test(token)) throw new StudioError('请先登录 New API 账号', 401)
    // Never trust browser-supplied user IDs or relay tokens.
    let response
    try { response = await fetcher(new URL('/api/user/self', config.authOrigin), { headers: { Authorization: token }, redirect: 'error', signal: AbortSignal.timeout(10_000) }) } catch { throw new StudioError('账号服务暂不可用', 502) }
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.success !== true || !Number.isSafeInteger(body.data?.id) || body.data.id <= 0) throw new StudioError('登录会话已失效', 401)
    if (config.relayOwnerId !== undefined && body.data.id !== config.relayOwnerId) throw new StudioError('当前账号尚未连接自己的生成令牌', 403)
    request.studioUser = body.data.id
  })
  async function execute(request, kind, payload, action) {
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) throw new StudioError('缺少有效请求标识', 400)
    const owner = request.studioUser
    const begun = ledger.begin(owner, kind, key, payload)
    if (begun.conflict) throw new StudioError('同一请求标识不能修改参数', 409)
    if (begun.blocked) throw new StudioError('该请求正在处理或结果待确认，不能重复提交；请检查网关记录', 409)
    if (begun.result) return { success: true, data: begun.result }
    if (busy.has(owner)) { ledger.unknown(owner, kind, key); throw new StudioError('已有生成请求正在处理', 409) }
    busy.add(owner)
    try {
      const result = await action()
      ledger.complete(owner, kind, key, result)
      return { success: true, data: result }
    } catch (error) { ledger.unknown(owner, kind, key); throw error }
    finally { busy.delete(owner) }
  }
  function selectModel(id, kind) {
    const model = config.models.find(m => m.kind === kind && (id ? m.id === id : isAvailable(config, m)))
    if (!model || !isAvailable(config, model)) throw new StudioError('尚未配置并验证可用模型，请先完成 New API 渠道接入', 503)
    return model
  }
  app.post('/api/studio/images', async request => {
    const parsed = imageBody.safeParse(request.body)
    if (!parsed.success) throw new StudioError('图片请求格式无效', 400)
    const model = selectModel(parsed.data.model, 'image')
    return execute(request, 'image', parsed.data, () => (overrides.generateImage ?? generateImage)(config, model, parsed.data))
  })
  app.post('/api/studio/runs', async request => {
    const parsed = runBody.safeParse(request.body)
    if (!parsed.success) throw new StudioError('智能体请求格式无效', 400)
    if (parsed.data.runId !== request.headers['idempotency-key']) throw new StudioError('任务标识与请求标识不一致', 400)
    if (parsed.data.videoGenerationPreference) throw new StudioError('视频生成将在后续接入')
    if (parsed.data.mentions?.some(m => m?.mentionType !== 'image-model')) throw new StudioError('品牌库和自定义技能尚未接入')
    for (const id of parsed.data.imageGenerationPreference?.models ?? []) selectModel(id, 'image')
    const selected = parsed.data.model ? config.models.find(m => m.id === parsed.data.model) : undefined
    if (parsed.data.model && !selected) throw new StudioError('所选模型尚未接入', 503)
    if (selected?.kind === 'image' && parsed.data.imageGenerationPreference?.models?.some(id => id !== selected.id)) throw new StudioError('两处图片模型选择不一致，请选择同一个模型')
    const imageOnly = selected?.kind === 'image' || (!selected && !config.models.some(m => m.kind === 'chat' && isAvailable(config, m)))
    const model = selectModel(imageOnly ? selected?.id ?? parsed.data.imageGenerationPreference?.models?.[0] : parsed.data.model, imageOnly ? 'image' : 'chat')
    // The endpoint keeps one idempotency scope even when the selected mode changes.
    return execute(request, 'agent', parsed.data, () => imageOnly
      ? (overrides.runImage ?? runImage)(config, model, parsed.data)
      : (overrides.runAgent ?? runAgent)(config, model, parsed.data))
  })
  return app
}
