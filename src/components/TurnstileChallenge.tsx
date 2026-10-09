import { useEffect, useRef, useState } from 'react'
import { loadTurnstile, type TurnstileApi } from '../lib/turnstile'

export default function TurnstileChallenge({ siteKey, resetKey, onToken }: { siteKey: string; resetKey: number; onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  callback.current = onToken
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let widget: string | undefined
    let api: TurnstileApi | undefined
    callback.current('')
    setError('')
    if (!siteKey.trim()) { setError('安全验证尚未配置，请联系管理员'); return }
    void loadTurnstile().then((loaded) => {
      if (!active || !container.current) return
      api = loaded
      const failed = () => {
        if (!active) return
        callback.current('')
        setError('安全验证失效，请重新验证')
      }
      widget = api.render(container.current, {
        sitekey: siteKey, theme: 'auto', size: 'flexible',
        callback: (token) => { if (active) { callback.current(token); setError('') } },
        'expired-callback': failed, 'error-callback': failed, 'timeout-callback': failed,
      })
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)) })
    return () => {
      active = false
      if (api && widget !== undefined) api.remove(widget)
    }
  }, [siteKey, resetKey, attempt])

  return <div className="space-y-2" aria-label="安全验证">
    <div ref={container} />
    {error && <p role="alert" className="text-xs text-amber-600 dark:text-amber-300">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)} className="underline">重新验证</button></p>}
  </div>
}
