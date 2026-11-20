import { useCallback, useEffect, useState } from 'react'
import { formatPoints } from '../../lib/accountUsage'
import { createTopupOrder, formatPayAmount, getPaymentGateways, openPayUrl, type PaymentGateway, type TopupOptions, type TopupPayment } from '../../lib/topup'

const OPTION_CLASS = 'min-h-11 rounded-xl border px-3 py-2.5 text-left transition'
const optionState = (active: boolean) => active
  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15 dark:border-blue-400 dark:bg-blue-500/10'
  : 'border-gray-200 bg-white hover:border-blue-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-blue-400/50'

export default function OnlineTopupCard({ options, onOrderCreated, onOrderFailed }: { options: TopupOptions; onOrderCreated: (payment: TopupPayment) => void; onOrderFailed?: () => void }) {
  const [selected, setSelected] = useState<number | 'custom'>(options.packages.length ? 0 : 'custom')
  const [customAmount, setCustomAmount] = useState('')
  const [gateways, setGateways] = useState<PaymentGateway[] | null>(null)
  const [gatewayError, setGatewayError] = useState('')
  const [gatewayId, setGatewayId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const loadGateways = useCallback(() => {
    setGatewayError('')
    getPaymentGateways().then((list) => {
      setGateways(list)
      // 只有一种支付方式时直接选中
      if (list.length === 1) setGatewayId(list[0].uuid)
    }, (err) => setGatewayError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => { loadGateways() }, [loadGateways])

  const custom = options.custom
  const amount = Number(customAmount)
  const customValid = custom !== null && /^\d+$/.test(customAmount.trim()) && amount >= custom.min && amount <= custom.max
  const pack = selected === 'custom' ? null : options.packages[selected]
  const price = pack ? pack.price : customValid ? amount : null
  const gateway = gateways?.find((item) => item.uuid === gatewayId)

  const handlePay = async () => {
    if (price === null || !gateway) return
    setSubmitting(true)
    setError('')
    try {
      const payment = await createTopupOrder(pack ? { gateway: gateway.uuid, package: selected as number, price: pack.price, points: pack.points + pack.bonus } : { gateway: gateway.uuid, amount })
      // 下单后立即拉起支付页，离点击越近越不容易被浏览器拦截
      if (payment.type === 1) openPayUrl(payment.data)
      onOrderCreated(payment)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      // 失败可能是后台改了积分包或金额范围，重新读取最新配置
      onOrderFailed?.()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-100 p-5 dark:border-white/[0.08]" aria-label="在线充值">
      <p className="font-semibold text-gray-900 dark:text-white">在线充值</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">1 元 = 100 积分，支付后自动到账</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.packages.map((item, idx) => (
          <button key={idx} type="button" aria-pressed={selected === idx} onClick={() => setSelected(idx)} className={`${OPTION_CLASS} flex flex-col items-start ${optionState(selected === idx)}`}>
            <span className="block text-lg font-bold tabular-nums text-gray-900 dark:text-white">¥{item.price.toLocaleString('zh-CN')}</span>
            <span className="block text-sm tabular-nums text-gray-600 dark:text-gray-300">{item.points.toLocaleString('zh-CN')} 积分</span>
            {item.bonus > 0 && <span className="mt-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">赠送 {item.bonus.toLocaleString('zh-CN')}</span>}
          </button>
        ))}
        {custom && (
          <button type="button" aria-pressed={selected === 'custom'} onClick={() => setSelected('custom')} className={`${OPTION_CLASS} flex flex-col items-start ${optionState(selected === 'custom')}`}>
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">自定义金额</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">¥{custom.min}–{custom.max}</span>
          </button>
        )}
      </div>

      {custom && selected === 'custom' && (
        <div className="mt-3">
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-400/10 dark:border-white/10 dark:bg-gray-950/60">
            <span className="text-sm text-gray-500">¥</span>
            <input value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} inputMode="numeric" autoComplete="off" placeholder={`${custom.min}–${custom.max} 的整数`} aria-label="充值金额（元）" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 dark:text-white" />
            <span className="text-sm text-gray-500">元</span>
          </label>
          <p className={`mt-1.5 text-xs ${customAmount.trim() && !customValid ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
            {customValid ? `可得 ${formatPoints(amount)}` : customAmount.trim() ? `请输入 ${custom.min}–${custom.max} 之间的整数金额` : `单笔 ${custom.min}–${custom.max} 元，按 1 元 = 100 积分到账`}
          </p>
        </div>
      )}

      <p className="mt-5 text-sm font-medium text-gray-700 dark:text-gray-200">支付方式</p>
      {gatewayError ? (
        <div role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">支付方式读取失败：{gatewayError} <button type="button" onClick={loadGateways} className="underline">重试</button></div>
      ) : !gateways ? (
        <p className="mt-2 text-sm text-gray-400">正在读取支付方式…</p>
      ) : !gateways.length ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">暂无可用支付方式，请使用兑换码或联系客服</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {gateways.map((item) => (
            <button key={item.uuid} type="button" aria-pressed={gatewayId === item.uuid} onClick={() => setGatewayId(item.uuid)} className={`${OPTION_CLASS} flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100 ${optionState(gatewayId === item.uuid)}`}>
              {/^https?:\/\//.test(item.icon) && <img src={item.icon} alt="" className="h-5 w-5 rounded object-contain" />}
              {item.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-white/[0.08] sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="text-gray-900 dark:text-white">
            应付 <span className="text-lg font-bold tabular-nums">{price === null ? '—' : formatPayAmount(price, 'CNY')}</span>
            {price !== null && <span className="ml-2 text-gray-500 dark:text-gray-400">到账 {pack ? `${(pack.points + pack.bonus).toLocaleString('zh-CN')} 积分` : formatPoints(price)}</span>}
          </p>
          {gateway
            ? (gateway.fixed_fee > 0 || gateway.percent_fee > 0) && <p className="mt-0.5 text-xs text-gray-400">该支付方式收取手续费，实付金额以下单后显示为准</p>
            : gateways?.length ? <p className="mt-0.5 text-xs text-gray-400">请选择支付方式</p> : null}
        </div>
        <button type="button" onClick={() => void handlePay()} disabled={submitting || price === null || !gateway} className="min-h-11 rounded-xl bg-gradient-to-r from-blue-600 to-blue-800 px-6 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
          {submitting ? '正在下单…' : '立即支付'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  )
}
