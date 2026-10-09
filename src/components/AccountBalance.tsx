import { useEffect, useState } from 'react'
import { getCurrentUser } from '../lib/gouoBackend'
import { useStore } from '../store'

export default function AccountBalance({ onClick, refreshKey }: { onClick: () => void; refreshKey?: boolean }) {
  const runningCount = useStore((state) => state.tasks.filter((task) => task.status === 'running').length)
  const [balance, setBalance] = useState<number | 'loading' | 'unavailable'>('loading')

  useEffect(() => {
    let cancelled = false
    let requestId = 0
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return
      const id = ++requestId
      try {
        const user = await getCurrentUser()
        if (cancelled || id !== requestId) return
        if (typeof user.balance_cny !== 'number' || !Number.isFinite(user.balance_cny)) throw new Error('账户接口未返回有效余额')
        setBalance(user.balance_cny)
      } catch (err) {
        if (cancelled || id !== requestId) return
        console.warn('读取账户余额失败', err)
        setBalance('unavailable')
      }
    }

    void refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(timer)
    }
  }, [runningCount, refreshKey])

  const text = typeof balance === 'number' ? `余额 ¥${balance.toFixed(2)}` : balance === 'loading' ? '余额 …' : '余额暂不可用'

  return (
    <button type="button" onClick={onClick} aria-label={`${text}，打开用户中心`} aria-busy={balance === 'loading'} className="whitespace-nowrap rounded-lg px-2.5 py-2 text-xs tabular-nums text-gray-400 outline-none hover:bg-white/[0.05] hover:text-gray-100 focus-visible:ring-2 focus-visible:ring-white/20">
      <span aria-live="polite">{text}</span>
    </button>
  )
}
