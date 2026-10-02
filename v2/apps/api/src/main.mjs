import { loadConfig } from './config.mjs'
import { createServer } from './server.mjs'
const app = createServer(loadConfig())
const port = Number(process.env.GOUO_STUDIO_PORT || 3001)
await app.listen({ port, host: process.env.GOUO_STUDIO_HOST || '127.0.0.1' })
console.log(`Studio API: http://127.0.0.1:${port} (generation is gated by verified server-side configuration)`)
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0) })
