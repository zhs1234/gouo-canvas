import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
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
      // 保留浏览器 Host（含端口），供后端与 Origin 核对同源请求。
      changeOrigin: false,
      secure: false,
    }
    proxy['/api'] = backendProxy
    proxy['/v1'] = backendProxy
    proxy['/panel'] = backendProxy
  }

  return {
    plugins: [react()],
    test: {
      include: ['src/**/*.test.{ts,tsx,mjs}'],
      env: { VITE_GOUO_BACKEND_ENABLED: 'false', VITE_SHOW_DEFAULT_CONFIG_ONLY: 'false', VITE_DEFAULT_API_URL: '', VITE_API_PROXY_AVAILABLE: 'false' },
    },
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      // 后端运行文件和数据库不参与前端热更新，Windows 文件锁会让监听进程退出。
      watch: { ignored: ['**/.local-runtime/**', '**/server/data/**'] },
      proxy: Object.keys(proxy).length ? proxy : undefined,
    },
  }
})
