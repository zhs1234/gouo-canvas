// 网络分块可能落在 UTF-8 汉字或 SSE data 行中间。
export async function* readEventStream(response: Response): AsyncGenerator<unknown> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('生成服务未返回事件流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      // 图片端允许最多 40 MiB base64，事件还包含 JSON 元数据。
      if (buffer.length > 48 * 1024 * 1024) throw new Error('生成事件超过大小限制')
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
        if (data) yield JSON.parse(data)
      }
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
