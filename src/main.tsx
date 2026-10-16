import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import BackendAuthGate from './components/BackendAuthGate'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'

installMobileViewportGuards()

// 纯 HTTP 局域网访问不是安全上下文，没有 randomUUID；getRandomValues 不受此限制。
if (!crypto.randomUUID) {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as ReturnType<Crypto['randomUUID']>
  }
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

const rootElement = document.getElementById('root')!

createRoot(rootElement, {
  // 渲染出错时 React 会卸载整棵树，页面只剩背景色；改为显示错误信息和刷新入口，便于反馈定位
  onUncaughtError: (error, info) => {
    console.error(error, info.componentStack)
    document.getElementById('boot-skeleton')?.remove()
    const panel = document.createElement('div')
    panel.style.cssText = 'max-width:760px;margin:12vh auto;padding:24px;font:14px/1.7 system-ui,sans-serif;color:#eee;background:#1a1a1a;border:1px solid #333;border-radius:16px'
    const title = document.createElement('p')
    title.textContent = '页面出错了，请截图本页反馈给管理员'
    title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 12px'
    const detail = document.createElement('pre')
    detail.textContent = `${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)}\n${info.componentStack ?? ''}`
    detail.style.cssText = 'white-space:pre-wrap;word-break:break-all;max-height:50vh;overflow:auto;font-size:12px;color:#f3b88a;user-select:text'
    const reload = document.createElement('button')
    reload.textContent = '刷新页面'
    reload.style.cssText = 'margin-top:16px;padding:8px 16px;border-radius:10px;border:0;background:#eee;color:#111;cursor:pointer'
    reload.onclick = () => window.location.reload()
    panel.append(title, detail, reload)
    rootElement.replaceChildren(panel)
  },
}).render(
  <StrictMode>
    <BackendAuthGate>
      <App />
    </BackendAuthGate>
  </StrictMode>,
)
