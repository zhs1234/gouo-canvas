import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gouoBackendTarget = command === 'serve'
    ? (process.env.VITE_GOUO_BACKEND_DEV_TARGET || env.VITE_GOUO_BACKEND_DEV_TARGET)?.trim().replace(/\/+$/, '')
    : ''
  const proxy: Record<string, object> = {}

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
    },
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      host: true,
      // 后端运行文件和数据库不参与前端热更新，Windows 文件锁会让监听进程退出。
      watch: { ignored: ['**/.local-runtime/**', '**/server/data/**'] },
      proxy: Object.keys(proxy).length ? proxy : undefined,
    },
  }
})
