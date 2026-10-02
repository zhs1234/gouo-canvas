const base = new URL(process.env.GOUO_STACK_URL || 'http://localhost:8080')
async function read(path) {
  const response = await fetch(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status)
  const body = await response.json()
  if (body.success !== true) throw new Error(path + ' 未就绪')
  return body
}
try {
  await read('/healthz')
  await read('/api/studio/health')
  const setup = await read('/api/setup')
  const catalog = await read('/api/studio/models')
  console.log(JSON.stringify({ edge: 'ready', studio: 'ready', newApi: 'ready', accountInitialized: setup.data.status === true, generationEnabled: catalog.data.generationEnabled }, null, 2))
  if (!setup.data.status) console.log('服务已连通；账号尚未初始化，请由用户在同源 /setup 原生页面自行完成。')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
