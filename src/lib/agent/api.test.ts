import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeChatStream, getAgentModels, streamAgentCompletion } from './api'

const backend = vi.hoisted(() => ({ refreshes: [] as boolean[] }))
vi.mock('../gouoBackend', async (importOriginal) => ({
  ...await importOriginal<typeof import('../gouoBackend')>(),
  createBackendSettings: async (refresh = false) => {
    backend.refreshes.push(refresh)
    return { baseUrl: 'https://gouo.test/v1', apiKey: refresh ? 'new-token' : 'old-token' }
  },
}))

afterEach(() => {
  backend.refreshes = []
  vi.unstubAllGlobals()
})

function stream(text: string, size = 7) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size))
      controller.close()
    },
  })
}

function event(delta: unknown, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\r\n\r\n`
}

describe('Agent SSE', () => {
  it('assembles split UTF-8 text, CRLF and function arguments', async () => {
    const content = event({ content: '你好，' }) + event({ content: '光构' })
      + event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_canvas', arguments: '{' } }] })
      + event({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }, 'tool_calls') + 'data: [DONE]\r\n\r\n'
    const updates: string[] = []
    const result = await consumeChatStream(stream(content, 1), (text) => updates.push(text), new AbortController().signal)
    expect(result.content).toBe('你好，光构')
    expect(result.calls).toEqual([{ id: 'call_1', name: 'get_canvas', arguments: '{}', status: 'pending' }])
    expect(updates).toContain('你好，')
  })

  it('keeps the same 37-character tool ID when upstream repeats it on six frames', async () => {
    const id = `call_${'x'.repeat(32)}`
    const parts = ['{"prompt":"', 'a', 'a', 'a', 'a', '"}']
    const frames = parts.map((argumentsPart, index) => event({ tool_calls: [{
      index: 0,
      id,
      function: { ...(index === 0 ? { name: 'create_image_task' } : {}), arguments: argumentsPart },
    }] }, index === parts.length - 1 ? 'tool_calls' : null)).join('') + 'data: [DONE]\n\n'
    const result = await consumeChatStream(stream(frames), () => {}, new AbortController().signal)
    expect(result.calls).toEqual([{ id, name: 'create_image_task', arguments: '{"prompt":"aaaa"}', status: 'pending' }])
  })

  it.each(['stop', 'tool_calls'])('returns on %s without waiting for the upstream to close', async (finish) => {
    let cancelled = false
    const delta = finish === 'stop' ? { content: '已完成' } : { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_canvas', arguments: '{}' } }] }
    const body = new ReadableStream<Uint8Array>({
      start(reader) { reader.enqueue(new TextEncoder().encode(event(delta, finish))) },
      cancel() { cancelled = true },
    })
    const result = await consumeChatStream(body, () => {}, new AbortController().signal)
    expect(cancelled).toBe(true)
    if (finish === 'stop') expect(result.content).toBe('已完成')
    else expect(result.calls).toEqual([{ id: 'call_1', name: 'get_canvas', arguments: '{}', status: 'pending' }])
  })

  it.each(['length', 'content_filter'])('rejects %s even when a tool call looks complete', async (finish) => {
    const body = stream(event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_canvas', arguments: '{}' } }] }, finish))
    await expect(consumeChatStream(body, () => {}, new AbortController().signal)).rejects.toThrow(finish === 'length' ? '长度上限' : '未能完成')
  })

  it('ignores repeated and empty metadata while preserving repeated argument text', async () => {
    const parts = ['{"prompt":"', '哈', '哈', '哈', '哈', '哈', '哈', '"}']
    const frames = parts.map((argumentsPart, index) => event({ tool_calls: [{
      index: 0,
      id: index === 2 ? '' : 'call_1',
      function: { name: index === 2 ? '' : 'create_image_task', arguments: argumentsPart },
    }] }, index === parts.length - 1 ? 'tool_calls' : null)).join('')
    const result = await consumeChatStream(stream(frames, 1), () => {}, new AbortController().signal)
    expect(result.calls).toEqual([{ id: 'call_1', name: 'create_image_task', arguments: '{"prompt":"哈哈哈哈哈哈"}', status: 'pending' }])
  })

  it('rejects a changed tool name on the same tool call', async () => {
    const frames = event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'create_image_task', arguments: '{' } }] })
      + event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_canvas', arguments: '}' } }] }, 'tool_calls')
    await expect(consumeChatStream(stream(frames), () => {}, new AbortController().signal)).rejects.toThrow('工具名在流式响应中发生变化')
  })

  it('treats a new tool ID on an already used index as the next call', async () => {
    // 旧版 Claude 渠道转换把同一回复里的多个工具调用都标成 index 0
    const frames = event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_canvas', arguments: '' } }] })
      + event({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] })
      + event({ tool_calls: [{ index: 0, id: 'call_2', function: { name: 'get_task_status', arguments: '' } }] })
      + event({ tool_calls: [{ index: 0, function: { arguments: '{"taskId":"t"}' } }] }, 'tool_calls')
    const result = await consumeChatStream(stream(frames), () => {}, new AbortController().signal)
    expect(result.calls).toEqual([
      { id: 'call_1', name: 'get_canvas', arguments: '{}', status: 'pending' },
      { id: 'call_2', name: 'get_task_status', arguments: '{"taskId":"t"}', status: 'pending' },
    ])
  })

  it('accepts tool metadata and arguments exactly at their existing limits', async () => {
    const call = { index: 0, id: 'i'.repeat(200), function: { name: 'n'.repeat(100), arguments: `${' '.repeat(99_998)}{}` } }
    const result = await consumeChatStream(stream(event({ tool_calls: [call] }, 'tool_calls'), 4096), () => {}, new AbortController().signal)
    expect(result.calls[0]).toMatchObject({ id: call.id, name: call.function.name, arguments: call.function.arguments })
  })

  it.each([
    [{ id: 'i'.repeat(201), function: { name: 'get_canvas', arguments: '{}' } }, '工具调用 ID 超过长度上限（200）'],
    [{ id: 'call_1', function: { name: 'n'.repeat(101), arguments: '{}' } }, '工具名超过长度上限（100）'],
    [{ id: 'call_1', function: { name: 'get_canvas', arguments: `${' '.repeat(99_999)}{}` } }, '工具参数超过长度上限（100000）'],
  ])('reports the actual field exceeding its limit', async (fragment, message) => {
    await expect(consumeChatStream(stream(event({ tool_calls: [{ index: 0, ...fragment }] }, 'tool_calls'), 4096), () => {}, new AbortController().signal)).rejects.toThrow(message)
  })

  it('still rejects one tool ID reused for two different indexes', async () => {
    const frames = event({ tool_calls: [0, 1].map((index) => ({ index, id: 'call_1', function: { name: 'get_canvas', arguments: '{}' } })) }, 'tool_calls')
    await expect(consumeChatStream(stream(frames), () => {}, new AbortController().signal)).rejects.toThrow('重复的工具调用标识')
  })

  it('applies the argument limit to the accumulated deltas', async () => {
    const frames = event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_canvas', arguments: ' '.repeat(99_999) } }] })
      + event({ tool_calls: [{ index: 0, id: 'call_1', function: { arguments: '{}' } }] }, 'tool_calls')
    await expect(consumeChatStream(stream(frames, 4096), () => {}, new AbortController().signal)).rejects.toThrow('工具参数超过长度上限（100000）')
  })

  it('rejects a disconnected stream rather than treating partial tool arguments as executable', async () => {
    await expect(consumeChatStream(stream(event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'create_image_task', arguments: '{' } }] })), () => {}, new AbortController().signal)).rejects.toThrow('连接意外中断')
  })

  it('rejects excessive tool indexes', async () => {
    await expect(consumeChatStream(stream(event({ tool_calls: [{ index: 8 }] })), () => {}, new AbortController().signal)).rejects.toThrow('工具调用数量')
  })

  it('honors cancellation without consuming a request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(consumeChatStream(stream(event({ content: 'pending' })), () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels an unfinished response after receiving tool metadata without returning an executable call', async () => {
    const controller = new AbortController()
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(reader) { reader.enqueue(new TextEncoder().encode(event({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'create_image_task', arguments: '{' } }] }))) },
      cancel() { cancelled = true },
    })
    await expect(consumeChatStream(body, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled).toBe(true)
  })

  it('平台令牌失效时换新令牌重试一次 Agent 对话和模型目录', async () => {
    const auth: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      const token = headers.Authorization?.replace('Bearer ', '') ?? headers['X-Gouo-Token']
      auth.push(token)
      if (token === 'old-token') return Response.json({ success: false, message: '无效的令牌' }, { status: 401 })
      if (url.endsWith('/chat/completions')) return new Response(stream(event({ content: '好的' }, 'stop') + 'data: [DONE]\n\n'))
      return Response.json({ success: true, data: [{ id: 'm', name: '模型', tool_calls: true, vision: false }] })
    }))
    const result = await streamAgentCompletion({ model: 'm', messages: [], tools: [], signal: new AbortController().signal, onUpdate: () => {} })
    expect(result.content).toBe('好的')
    expect((await getAgentModels()).models.map((model) => model.id)).toEqual(['m'])
    expect(auth).toEqual(['old-token', 'new-token', 'old-token', 'new-token'])
    expect(backend.refreshes).toEqual([false, true, false, true])
  })
})
