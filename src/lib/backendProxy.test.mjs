import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import { createServer, loadConfigFromFile } from 'vite'
import { expect, it, vi } from 'vitest'

it('preserves the browser host and origin through the backend development proxy', async () => {
  const backend = createHttpServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin }))
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  vi.stubEnv('VITE_GOUO_BACKEND_DEV_TARGET', `http://127.0.0.1:${address.port}`)
  let proxy
  try {
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' })
    proxy = await createServer({
      configFile: false,
      logLevel: 'silent',
      server: { host: '127.0.0.1', hmr: false, watch: null, proxy: loaded.config.server.proxy },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    // Vite 的 listen() 将 0 当作默认端口，直接监听才能使用系统分配的空闲端口。
    proxy.httpServer.listen(0, '127.0.0.1')
    await once(proxy.httpServer, 'listening')
    const proxyAddress = proxy.httpServer.address()
    const origin = `http://127.0.0.1:${proxyAddress.port}`
    for (const path of ['/api/user/login', '/v1/chat/completions', '/panel']) {
      const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { Origin: origin } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ host: `127.0.0.1:${proxyAddress.port}`, origin })
    }
  } finally {
    await proxy?.close()
    backend.closeAllConnections()
    await new Promise((resolve, reject) => backend.close((err) => err ? reject(err) : resolve()))
    vi.unstubAllEnvs()
  }
})
