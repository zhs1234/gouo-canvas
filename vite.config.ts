import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command, mode }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null
  const env = loadEnv(mode, process.cwd(), '')
  const gouoBackendTarget = command === 'serve'
    ? (process.env.VITE_GOUO_BACKEND_DEV_TARGET || env.VITE_GOUO_BACKEND_DEV_TARGET)?.trim().replace(/\/+$/, '')
    : ''
  const proxy: Record<string, object> = {}

  if (devProxyConfig?.enabled) {
    proxy[devProxyConfig.prefix] = {
      target: devProxyConfig.target,
      changeOrigin: devProxyConfig.changeOrigin,
      secure: devProxyConfig.secure,
      rewrite: (path: string) =>
        path.replace(
          new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
          '',
        ),
    }
  }

  if (gouoBackendTarget) {
    const backendProxy = {
      target: gouoBackendTarget,
      changeOrigin: true,
      secure: false,
    }
    proxy['/api'] = backendProxy
    proxy['/v1'] = backendProxy
    proxy['/panel'] = backendProxy
  }

  return {
    plugins: [react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy: Object.keys(proxy).length ? proxy : undefined,
    },
  }
})
