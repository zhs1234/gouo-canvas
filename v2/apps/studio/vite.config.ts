import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs'

// 直接从锁定的 npm 包提供字体，开发与构建都使用同源资源，不提交字体副本。
function excalidrawAssets() {
  const fontRoot = join(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts')
  let building = false
  return {
    name: 'excalidraw-local-assets',
    configResolved(config: import('vite').ResolvedConfig) { building = config.command === 'build' },
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const prefix = '/studio/excalidraw-assets/fonts/'
        const path = new URL(request.url || '/', 'http://localhost').pathname
        if (!path.startsWith(prefix)) return next()
        let target: string
        try { target = resolve(fontRoot, decodeURIComponent(path.slice(prefix.length))) } catch { response.statusCode = 400; response.end(); return }
        if (!target.startsWith(fontRoot + sep) || relative(fontRoot, target).startsWith('Liberation' + sep) || !/\.woff2$/.test(target)) { response.statusCode = 404; response.end(); return }
        try {
          if (!statSync(target).isFile()) return next()
          response.setHeader('Content-Type', 'font/woff2')
          createReadStream(target).pipe(response)
        } catch { response.statusCode = 404; response.end() }
      })
    },
    buildStart(this: import('rollup').PluginContext) {
      if (!building) return
      const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (!relative(fontRoot, path).startsWith('Liberation' + sep)) this.emitFile({ type: 'asset', fileName: `excalidraw-assets/fonts/${relative(fontRoot, path).split(sep).join('/')}`, source: readFileSync(path) })
        }
      }
      walk(fontRoot)
    },
  }
}
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const env = loadEnv(mode, root, '')
  const target = env.GOUO_BACKEND_DEV_TARGET || 'http://127.0.0.1:3000'
  return {
    plugins: [react(), tailwindcss(), excalidrawAssets()], base: '/studio/', envDir: root,
    // V2 使用 Tailwind 的 Vite 插件，禁止向上加载旧前端的 PostCSS 配置。
    css: { postcss: { plugins: [] } },
    resolve: { alias: {
      '@loomic/shared': fileURLToPath(new URL('./src/loomic/shared/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src/loomic', import.meta.url)),
      'next/navigation': fileURLToPath(new URL('./src/loomic/compat/navigation.ts', import.meta.url)),
      'next/dynamic': fileURLToPath(new URL('./src/loomic/compat/dynamic.tsx', import.meta.url)),
      'next/link': fileURLToPath(new URL('./src/loomic/compat/link.tsx', import.meta.url)),
    } },
    server: { port: 5174, strictPort: true, fs: { allow: [root] }, proxy: {
      '/api/studio': { target: env.GOUO_STUDIO_DEV_TARGET || 'http://127.0.0.1:3001', changeOrigin: false },
      '/api': { target, changeOrigin: false },
    } },
    preview: { port: 4174, strictPort: true },
    build: { outDir: 'dist', sourcemap: false },
  }
})
