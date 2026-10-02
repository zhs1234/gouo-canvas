import { z } from 'zod'
import { parseRequestResult, type SavedImage } from './request-recovery.ts'

export const imageJobStatusSchema = z.enum(['accepted', 'ready', 'submission_started', 'output_received', 'output_saved', 'needs_authorization', 'unknown', 'completed', 'cancelled_before_submission'])
export type ImageJobStatus = z.infer<typeof imageJobStatusSchema>
export const imageJobPayloadSchema = z.object({ prompt: z.string().trim().min(1).max(8000), model: z.string().min(1).max(100),
  quality: z.string().max(40).optional(), aspectRatio: z.string().max(20).optional(), inputImages: z.array(z.string().max(12 * 1024 * 1024)).max(4).default([]), payWithBalance: z.literal(true).optional() }).strict()
export type ImageJobPayload = z.infer<typeof imageJobPayloadSchema>
const idSchema = z.string().uuid()
export function validPersistedImageBinding(value: { executionMode?: unknown; requestId?: unknown; jobId?: unknown; requestOwner?: unknown }) {
  if (value.executionMode !== undefined && value.executionMode !== 'sync' && value.executionMode !== 'job') return false
  if (value.executionMode === 'job') return idSchema.safeParse(value.jobId).success && value.jobId === value.requestId && typeof value.requestOwner === 'string' && /^local:[1-9]\d*$/.test(value.requestOwner)
  return value.jobId === undefined && (value.requestId === undefined || (typeof value.requestId === 'string' && /^[\w-]{8,100}$/.test(value.requestId) && typeof value.requestOwner === 'string' && /^local:[1-9]\d*$/.test(value.requestOwner)))
}
const jobSchema = z.object({ jobId: idSchema, requestId: idSchema, kind: z.literal('image'), status: imageJobStatusSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), assetId: idSchema.optional(), pendingNativeOperation: z.literal(true).optional(), result: z.unknown().optional() })
export type ImageJob = Omit<z.infer<typeof jobSchema>, 'result'> & { result?: SavedImage }
export function parseImageJob(value: unknown, id: string, requireResult = false): ImageJob {
  idSchema.parse(id)
  const record = jobSchema.parse(value)
  if (record.jobId !== id || record.requestId !== id) throw new Error('图片任务与原编号不匹配')
  if (record.pendingNativeOperation && record.status !== 'unknown') throw new Error('图片任务的未知资金写状态不一致')
  if (record.status !== 'completed' && record.result !== undefined) throw new Error('图片任务尚未完成，不能发布输出')
  if (record.status === 'completed' && requireResult && (!record.assetId || record.result === undefined)) throw new Error('图片任务终态缺少已保存原图或素材标识')
  const { result: raw, ...summary } = record
  if (raw === undefined) return summary
  const result = parseRequestResult({ kind: 'image', requestId: id, status: 'completed', createdAt: record.createdAt, result: raw }, 'image', id).result
  if (!result || 'events' in result) throw new Error('图片任务结果格式无效')
  return { ...summary, result }
}
export function imageJobMessage(status: ImageJobStatus) {
  return { accepted: '后台已受理原图片任务；尚未证明模型提交或费用。', ready: '原图片任务等待执行；可以只读查询。',
    submission_started: '原图片任务已有提交意图；请只读查询，不要重复生成。', output_received: '原始图片已私有暂存；可以仅完成本地保存，不再调用模型。',
    output_saved: '原图已保存，终态仍待确认；可以仅完成本地保存，不再调用模型。', needs_authorization: '原任务确定未提交，需要本人明确重新授权原参数；不会自动调用模型。',
    unknown: '原图片任务结果未知；保留原编号与占用，请只读核对，不会重新生成。', completed: '已读取原图片任务的已保存原图；实扣与调用记录仍需核对。',
    cancelled_before_submission: '原图片任务已确定在外发前取消；没有生成结果，未请求退款。' }[status]
}
export type ImageJobAction = 'authorize' | 'cancel' | 'finalize'
export function canOperateJob(job: Pick<ImageJob, 'status' | 'pendingNativeOperation'>, action: ImageJobAction) {
  if (job.pendingNativeOperation) return false
  return action === 'authorize' ? job.status === 'needs_authorization' : action === 'finalize'
    ? ['output_received', 'output_saved'].includes(job.status) : ['accepted', 'ready', 'needs_authorization'].includes(job.status)
}
// Inject transport and fresh identity verification so tests exercise the same
// finite GET/write policy without a browser token, timer or provider fixture.
export function createImageJobClient(options: { transport: (path: string, init: RequestInit) => Promise<unknown>; getOwner: () => string | null; getEpoch: () => number; verifyOwner: (owner: string, signal?: AbortSignal) => Promise<boolean> }) {
  const reads = new Map<string, Promise<ImageJob>>()
  const assertOwner = (owner: string, epoch: number) => {
    if (!/^local:[1-9]\d*$/.test(owner) || options.getOwner() !== owner || options.getEpoch() !== epoch) throw new Error('账号已变化，未继续原图片任务')
  }
  const read = (owner: string, id: string) => {
    const epoch = options.getEpoch(); assertOwner(owner, epoch); idSchema.parse(id)
    const key = `${epoch}:${owner}:${id}`
    if (reads.has(key)) return reads.get(key)!
    const pending = Promise.resolve().then(async () => {
      assertOwner(owner, epoch)
      const value = await options.transport(`/api/studio/image-jobs/${id}`, { method: 'GET', cache: 'no-store' })
      assertOwner(owner, epoch)
      return parseImageJob(value, id, true)
    }).finally(() => { if (reads.get(key) === pending) reads.delete(key) })
    reads.set(key, pending); return pending
  }
  const write = async (owner: string, id: string, path: string, body?: unknown, signal?: AbortSignal) => {
    const epoch = options.getEpoch(); assertOwner(owner, epoch); idSchema.parse(id)
    if (!await options.verifyOwner(owner, signal)) throw new Error('登录归属已变化，未发送图片任务请求')
    assertOwner(owner, epoch); signal?.throwIfAborted()
    const value = await options.transport(path, { method: 'POST', signal, headers: path === '/api/studio/image-jobs' ? { 'Idempotency-Key': id } : undefined, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    assertOwner(owner, epoch)
    return parseImageJob(value, id)
  }
  return { read, start: (owner: string, id: string, payload: ImageJobPayload, signal?: AbortSignal) => write(owner, id, '/api/studio/image-jobs', imageJobPayloadSchema.parse(payload), signal),
    operate: (owner: string, job: ImageJob, action: ImageJobAction, confirm = false) => {
      if (!canOperateJob(job, action) || (action !== 'finalize' && !confirm)) return Promise.reject(new Error('仅允许本人明确处理具有对应证明的原图片任务'))
      return write(owner, job.jobId, `/api/studio/image-jobs/${job.jobId}/${action}`, action === 'finalize' ? undefined : { confirm: true })
    } }
}
