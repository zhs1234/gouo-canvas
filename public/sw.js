const CACHE_NAME = 'gouo-canvas-v0.1.0-assets-3'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './gouo-logo-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/v1' ||
    url.pathname.startsWith('/v1/') ||
    url.pathname === '/panel' ||
    url.pathname.startsWith('/panel/')
  ) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 只把应用页面存为离线首页；打开的文本、图片或网关错误页不能覆盖它
          if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy))
          }
          return response
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  if (!['font', 'image', 'manifest', 'script', 'style'].includes(request.destination)) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached

      return fetch(request).then((response) => {
        // 回落成 index.html 的旧脚本地址也是 200，按类型过滤，避免把 HTML 缓存成脚本
        if (response.ok && !(response.headers.get('content-type') || '').includes('text/html')) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
