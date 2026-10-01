import { useCallback, useEffect, useId, useRef, useState } from 'react'

export function useBalanceConsent(scope: string) {
  const [choice, setChoice] = useState({ scope, allowed: false })
  const current = useRef(choice)
  current.current = choice.scope === scope ? choice : { scope, allowed: false }
  useEffect(() => { setChoice({ scope, allowed: false }) }, [scope])
  const consume = useCallback(() => {
    const allowed = current.current.scope === scope && current.current.allowed
    current.current = { scope, allowed: false }
    setChoice(current.current)
    return allowed
  }, [scope])
  return { checked: current.current.allowed, change: (allowed: boolean) => setChoice({ scope, allowed }), consume }
}

export function BalanceConsent({ checked, change, disabled }: { checked: boolean; change: (allowed: boolean) => void; disabled?: boolean }) {
  const help = useId()
  return <div className="px-2 py-1 text-xs">
    <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={event => change(event.target.checked)} disabled={disabled} aria-describedby={help} />本次允许使用本人 New API 余额</label>
    <p id={help} className="text-muted-foreground mt-1">优先使用剩余试用，耗尽的类别使用余额。仅限本次发送；聊天最多调用 3 次聊天模型，图片工具另计。实际费用以 New API 用量记录为准。</p>
  </div>
}
