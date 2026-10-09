export interface TurnstileApi {
  render: (container: HTMLElement, options: {
    sitekey: string
    theme: 'auto'
    size: 'flexible'
    callback: (token: string) => void
    'expired-callback': () => void
    'error-callback': () => void
    'timeout-callback': () => void
  }) => string
  remove: (id: string) => void
}

let loading: Promise<TurnstileApi> | null = null

export function loadTurnstile(): Promise<TurnstileApi> {
  const host = window as Window & { turnstile?: TurnstileApi }
  if (host.turnstile) return Promise.resolve(host.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const fail = () => {
      clearTimeout(timer)
      script.onload = script.onerror = null
      script.remove()
      reject(new Error('安全验证加载失败，请检查网络后重试'))
    }
    const timer = setTimeout(fail, 15_000)
    script.onload = () => {
      clearTimeout(timer)
      if (!host.turnstile) { fail(); return }
      resolve(host.turnstile)
    }
    script.onerror = fail
    document.head.appendChild(script)
  }).catch((err) => { loading = null; throw err })
  return loading
}
