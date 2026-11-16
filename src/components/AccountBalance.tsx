import { useEffect, useState } from 'react'
import { getCachedBackendStatus, getCurrentUser } from '../lib/gouoBackend'
import { useStore } from '../store'
import { formatPoints, toPoints } from '../lib/accountUsage'

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

  const remindPoints = getCachedBackendStatus()?.gouo_balance_remind_points
  // 用尽，或低于后台设置的提醒阈值时标出余额不足
  const low = typeof balance === 'number' && (balance <= 0 || (typeof remindPoints === 'number' && remindPoints > 0 && toPoints(balance) < remindPoints))
  const text = typeof balance === 'number' ? `余额 ${formatPoints(balance)}${low ? ' · 不足' : ''}` : balance === 'loading' ? '余额 …' : '余额暂不可用'

  return (
    <button type="button" onClick={onClick} aria-label={`${text}，去充值`} aria-busy={balance === 'loading'} className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-xs tabular-nums outline-none hover:bg-black/[0.04] hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-black/10 dark:hover:bg-white/[0.05] dark:hover:text-gray-100 dark:focus-visible:ring-white/20 ${low ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-gray-400'}`}>
      <span aria-live="polite">{text}</span>
    </button>
  )
}
