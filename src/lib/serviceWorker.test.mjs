import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// 在模拟环境里运行 public/sw.js，记录写入缓存的内容
function loadServiceWorker() {
  const listeners = {}
  const stored = new Map()
  const cache = { put: async (key, response) => { stored.set(typeof key === 'string' ? key : key.url, response) }, addAll: async () => {} }
  const context = {
    self: { location: { origin: 'https://gouo.test' }, addEventListener: (type, fn) => { listeners[type] = fn }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, match: async () => undefined, keys: async () => [], delete: async () => true },
    fetch: async () => { throw new Error('未设置响应') },
    URL,
    Promise,
  }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), context)
  const handle = async (request, response) => {
    context.fetch = async () => response
    let result
    listeners.fetch({ request, respondWith: (value) => { result = value } })
    await result
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { stored, handle }
}

const page = (body, type, status = 200) => new Response(body, { status, headers: { 'content-type': type } })

describe('Service Worker 缓存', () => {
  it('只把应用页面存为离线首页', async () => {
    const sw = loadServiceWorker()
    await sw.handle({ method: 'GET', url: 'https://gouo.test/inspiration-license.txt', mode: 'navigate' }, page('LICENSE', 'text/plain'))
    await sw.handle({ method: 'GET', url: 'https://gouo.test/canvas', mode: 'navigate' }, page('<html>502</html>', 'text/html', 502))
    expect(sw.stored.has('./index.html')).toBe(false)
    await sw.handle({ method: 'GET', url: 'https://gouo.test/canvas', mode: 'navigate' }, page('<html>app</html>', 'text/html; charset=utf-8'))
    expect(await sw.stored.get('./index.html').text()).toBe('<html>app</html>')
  })

  it('旧脚本地址回落成 HTML 时不缓存为脚本', async () => {
    const sw = loadServiceWorker()
    await sw.handle({ method: 'GET', url: 'https://gouo.test/assets/old.js', mode: 'no-cors', destination: 'script' }, page('<html>app</html>', 'text/html'))
    expect(sw.stored.size).toBe(0)
    await sw.handle({ method: 'GET', url: 'https://gouo.test/assets/new.js', mode: 'no-cors', destination: 'script' }, page('export {}', 'text/javascript'))
    expect(sw.stored.has('https://gouo.test/assets/new.js')).toBe(true)
  })
})
