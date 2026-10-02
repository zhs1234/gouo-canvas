import { z } from 'zod'
import type { ContentBlock, StreamEvent } from '../shared'

export const requestStatusSchema = z.enum(['running', 'unknown', 'completed', 'cancelled_before_submission'])
export type RequestStatus = z.infer<typeof requestStatusSchema>
export type RequestKind = 'agent' | 'image'
export const agentRequestIdSchema = z.string().uuid()
const assistantRunPrefix = 'assistant-run-v1:'
// Use the existing local message ID, with its enclosing owner/session scope.
// Old timestamp IDs are kept as-is; a missing request ID is never guessed.
export function assistantIdForRun(runId: string) { return assistantRunPrefix + agentRequestIdSchema.parse(runId) }
export function runIdFromAssistant(message: { id: string; role: string }) {
  if (message.role !== 'assistant' || !message.id.startsWith(assistantRunPrefix)) return null
  const id = message.id.slice(assistantRunPrefix.length)
  return agentRequestIdSchema.safeParse(id).success ? id : null
}
export function receivedImageTools(blocks: ContentBlock[]) {
  return new Set(blocks.filter(block => block.type === 'tool' && block.status === 'completed' && block.artifacts?.some(artifact => artifact.type === 'image')).map(block => (block as Extract<ContentBlock, { type: 'tool' }>).toolCallId))
}
const imageSchema = z.object({
  url: z.string().max(40 * 1024 * 1024 + 64).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  prompt: z.string().max(8000).optional(), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  width: z.number().int().positive().safe().optional(), height: z.number().int().positive().safe().optional(),
}).superRefine((value, context) => {
  if (value.mimeType && !value.url.startsWith(`data:${value.mimeType};`)) context.addIssue({ code: 'custom', message: '图片格式不匹配' })
})
const usageSchema = z.object({ state: z.enum(['recorded', 'settled', 'pending']), settlementState: z.literal('unconfirmed').optional(),
  requestCount: z.number().int().nonnegative().safe(), requestIds: z.array(z.string().regex(/^[\w-]{1,64}$/)).max(100).optional(),
  quota: z.number().int().nonnegative().safe().optional(), currency: z.literal('CNY'), cost: z.number().finite().nonnegative().optional() })
  .transform(value => ({ ...value, state: value.state === 'settled' ? 'recorded' as const : value.state, settlementState: 'unconfirmed' as const }))
const fundingSchema = z.object({ chat: z.enum(['trial', 'wallet']).optional(), image: z.enum(['trial', 'wallet']).optional() })
const eventBase = { runId: z.string().optional(), timestamp: z.string().datetime().optional() }
const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run.started'), sessionId: z.string().optional(), conversationId: z.string().optional() }),
  z.object({ ...eventBase, type: z.literal('message.delta'), messageId: z.string().optional(), delta: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool.started'), toolCallId: z.string().min(1), toolName: z.literal('generate_image'), input: z.object({ prompt: z.string(), model: z.string() }).optional() }),
  z.object({ ...eventBase, type: z.literal('tool.completed'), toolCallId: z.string().min(1), toolName: z.literal('generate_image').optional(), outputSummary: z.string().optional(), artifacts: z.array(imageSchema.and(z.object({ type: z.literal('image') }))).max(1).optional() }),
  z.object({ ...eventBase, type: z.literal('run.completed'), usage: usageSchema.optional() }),
  z.object({ ...eventBase, type: z.literal('run.failed'), error: z.object({ code: z.string(), message: z.string() }).optional(), usage: usageSchema.optional() }),
])
const recordSchema = z.object({ kind: z.enum(['agent', 'image']), requestId: z.string().regex(/^[\w-]{8,100}$/),
  status: requestStatusSchema, createdAt: z.string().datetime(), result: z.unknown().optional() })
export type SavedImage = z.infer<typeof imageSchema> & { usage?: z.infer<typeof usageSchema>; fundingSelection?: z.infer<typeof fundingSchema> }
export type RequestRecovery = { kind: RequestKind; requestId: string; status: RequestStatus; createdAt: string;
  result?: SavedImage | { events: StreamEvent[]; usage?: z.infer<typeof usageSchema>; fundingSelection?: z.infer<typeof fundingSchema> } }

export function parseRequestResult(value: unknown, kind: RequestKind, requestId: string): RequestRecovery {
  const record = recordSchema.parse(value)
  if (record.kind !== kind || record.requestId !== requestId) throw new Error('恢复结果与原请求不匹配')
  if (record.status !== 'completed') {
    if (record.result !== undefined) throw new Error('未完成请求不能带有完成结果')
    return { ...record, result: undefined }
  }
  if (kind === 'image') return { ...record, result: imageSchema.and(z.object({ usage: usageSchema.optional(), fundingSelection: fundingSchema.optional() })).parse(record.result) }
  const result = z.object({ events: z.array(eventSchema).max(10000), usage: usageSchema.optional(), fundingSelection: fundingSchema.optional() }).parse(record.result)
  let terminal = false
  const events = result.events.map((event, index) => {
    if (terminal || (event.runId !== undefined && event.runId !== requestId)) throw new Error('已保存事件与原请求不匹配')
    terminal = event.type === 'run.completed' || event.type === 'run.failed'
    return { ...event, runId: requestId, timestamp: event.timestamp ?? record.createdAt,
      ...(event.type === 'message.delta' ? { messageId: event.messageId ?? `${requestId}-${index}` } : {}),
      ...(event.type === 'tool.completed' ? { toolName: event.toolName ?? 'generate_image' } : {}),
      ...(event.type === 'run.started' ? { sessionId: event.sessionId ?? '', conversationId: event.conversationId ?? '' } : {}),
      ...(event.type === 'run.failed' ? { error: event.error ?? { code: 'run_failed', message: '原请求失败；已收到的内容仍可保存，费用待核对。' } } : {}),
    } as StreamEvent
  })
  if (!terminal) throw new Error('已保存结果缺少真实终态')
  return { ...record, result: { ...result, events } }
}

// Old saved image results may omit geometry. Decode their real bytes before
// canvas insertion; the downloadable original remains available if decoding fails.
export async function imageForCanvas(image: SavedImage, decode: (url: string) => Promise<{ width: number; height: number }>) {
  const mimeType = image.url.slice(5, image.url.indexOf(';')) as 'image/png' | 'image/jpeg' | 'image/webp'
  let width = image.width, height = image.height
  if (!width || !height || !image.mimeType) {
    const decoded = await decode(image.url)
    if (!Number.isSafeInteger(decoded.width) || decoded.width <= 0 || !Number.isSafeInteger(decoded.height) || decoded.height <= 0 || decoded.width * decoded.height > 24_000_000
      || (width !== undefined && width !== decoded.width) || (height !== undefined && height !== decoded.height)) throw new Error('原图尺寸无法安全恢复')
    width = decoded.width; height = decoded.height
  }
  return { ...image, width, height, mimeType }
}

// One in-flight GET per identity/kind/key; no retry timer, POST or credentials.
export function createResultReader(fetchResult: (path: string, init: RequestInit) => Promise<unknown>, getOwner: () => string | null, getEpoch: () => number) {
  const pending = new Map<string, Promise<RequestRecovery>>()
  return (owner: string, kind: RequestKind, requestId: string) => {
    const epoch = getEpoch()
    const assertOwner = () => {
      if (!/^local:[1-9]\d*$/.test(owner) || owner !== getOwner() || epoch !== getEpoch()) throw new Error('账号已变化，未读取或应用原账号结果')
    }
    try {
      assertOwner()
      if (!['agent', 'image'].includes(kind) || !/^[\w-]{8,100}$/.test(requestId)) throw new Error('原请求标识无效')
    } catch (error) { return Promise.reject(error) }
    const key = `${epoch}:${owner}:${kind}:${requestId}`
    if (pending.has(key)) return pending.get(key)!
    const reading = Promise.resolve().then(async () => {
      assertOwner()
      const value = await fetchResult(`/api/studio/requests/${kind}/${requestId}/result`, { method: 'GET', cache: 'no-store' })
      assertOwner()
      return parseRequestResult(value, kind, requestId)
    }).finally(() => { pending.delete(key) })
    pending.set(key, reading)
    return reading
  }
}

export function requestStatusMessage(status: RequestStatus) {
  return { running: '后台仍在处理；可再次读取原请求，未重新生成。',
    unknown: '后台结果未知，原请求不会重发；已收到内容保留，费用与试用次数待核对。',
    completed: '已读取原请求终态；调用记录与实扣仍需核对。',
    cancelled_before_submission: '原任务已在外发前取消，没有生成结果；未重新生成。' }[status]
}

// Build a full server snapshot, retaining previously received successful images
// even if an incomplete/broken saved result omits them. No live deltas are added twice.
export function recoveredContentBlocks(events: StreamEvent[], previous: ContentBlock[]): ContentBlock[] {
  const failureMessages = new Set(events.filter(event => event.type === 'run.failed').map(event => event.error.message))
  const blocks: ContentBlock[] = events.some(event => event.type === 'run.failed') && !events.some(event => event.type === 'message.delta')
    ? previous.filter(block => block.type === 'text' && !failureMessages.has(block.text)).map(block => ({ ...block })) : []
  for (const event of events) {
    if (event.type === 'message.delta') {
      const last = blocks.at(-1)
      if (last?.type === 'text') last.text += event.delta
      else blocks.push({ type: 'text', text: event.delta })
    } else if (event.type === 'tool.started') {
      if (!blocks.some(b => b.type === 'tool' && b.toolCallId === event.toolCallId)) blocks.push({ type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, status: 'running', ...(event.input ? { input: event.input } : {}) })
    } else if (event.type === 'tool.completed') {
      const existing = blocks.find(b => b.type === 'tool' && b.toolCallId === event.toolCallId)
      const completed = { type: 'tool' as const, toolCallId: event.toolCallId, toolName: event.toolName, status: 'completed' as const, outputSummary: event.outputSummary, ...(event.artifacts ? { artifacts: event.artifacts } : {}) }
      if (existing) Object.assign(existing, completed)
      else blocks.push(completed)
    } else if (event.type === 'run.failed') {
      blocks.push({ type: 'text', text: event.error.message })
      for (const block of blocks) if (block.type === 'tool' && block.status === 'running') { block.status = 'completed'; block.outputSummary = '原请求失败' }
    }
  }
  for (const prior of previous) {
    if (prior.type !== 'tool' || !prior.artifacts?.some(a => a.type === 'image')) continue
    const saved = blocks.find(b => b.type === 'tool' && b.toolCallId === prior.toolCallId)
    if (saved?.type === 'tool') {
      if (!saved.artifacts?.some(a => a.type === 'image')) { saved.artifacts = prior.artifacts; saved.status = prior.status }
    } else blocks.push(prior)
  }
  return blocks
}
