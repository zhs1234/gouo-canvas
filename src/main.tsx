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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BackendAuthGate>
      <App />
    </BackendAuthGate>
  </StrictMode>,
)
