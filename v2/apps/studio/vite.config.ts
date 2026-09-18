import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const env = loadEnv(mode, root, '')
  const target = env.GOUO_BACKEND_DEV_TARGET || 'http://127.0.0.1:3000'
  return {
    plugins: [react()], base: '/studio/', envDir: root,
    server: { port: 5174, strictPort: true, fs: { allow: [root] }, proxy: { '/api': { target, changeOrigin: false } } },
    preview: { port: 4174, strictPort: true },
    build: { outDir: 'dist', sourcemap: false },
  }
})
