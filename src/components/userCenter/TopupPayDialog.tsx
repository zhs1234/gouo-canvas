import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import { formatPayAmount, openPayUrl, watchTopupOrder, type TopupOrder, type TopupOrderStatus, type TopupPayment } from '../../lib/topup'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { CloseIcon } from '../icons'

// 支付二维码一般 15 分钟内有效，超时后停止查询，到账结果可在订单列表查看
const PAY_TIMEOUT_MS = 15 * 60 * 1000

const RESULT_TEXT: Record<Exclude<TopupOrderStatus, 'pending' | 'success'> | 'timeout', string> = {
  failed: '支付失败，积分未到账。如已扣款请联系客服。',
  closed: '订单已关闭，积分未到账。如需充值请重新下单。',
  timeout: '已停止自动查询。如已付款，到账后可在「最近充值订单」中查看。',
}

export default function TopupPayDialog({ payment, onPaid, onClose }: { payment: TopupPayment; onPaid: (order: TopupOrder) => void; onClose: () => void }) {
  const [result, setResult] = useState<keyof typeof RESULT_TEXT | null>(null)

  useCloseOnEscape(true, onClose)

  useEffect(() => watchTopupOrder(payment.trade_no, PAY_TIMEOUT_MS, (order) => {
    if (order?.status === 'success') return onPaid(order)
    setResult(order?.status === 'failed' || order?.status === 'closed' ? order.status : 'timeout')
  }), [payment, onPaid])

  const qr = payment.type === 2 ? qrcode(0, 'M') : null
  if (qr) {
    qr.addData(payment.data.url)
    qr.make()
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-gray-950/45 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label="支付订单" className="w-full rounded-t-[28px] border border-gray-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-gray-950 sm:max-w-sm sm:rounded-[28px]">
        <div className="flex items-center justify-between gap-4">
          <p className="text-base font-bold text-gray-900 dark:text-white">{payment.type === 2 ? '扫码支付' : '前往支付'}</p>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200" aria-label="关闭支付">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">实付 {formatPayAmount(payment.pay_amount, payment.currency)}</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">到账 {payment.points.toLocaleString('zh-CN')} 积分 · 订单号 <span data-selectable-text className="break-all">{payment.trade_no}</span></p>

        {qr ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))}`} alt="支付二维码" className="h-52 w-52 rounded-xl border border-gray-100 bg-white p-1 dark:border-white/10" />
            <p className="text-sm text-gray-500 dark:text-gray-400">请使用支付应用扫码，付款后自动到账</p>
            {/^https:\/\/qr\.alipay\.com\//i.test(payment.data.url) && <a href={payment.data.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:brightness-110 sm:hidden">打开支付宝</a>}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">已在新窗口打开支付页面，完成付款后回到这里，积分会自动到账。支付页面没有打开时请点击下方按钮。</p>
            <button type="button" onClick={() => openPayUrl(payment.data)} className="min-h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-800 px-4 text-sm font-semibold text-white transition hover:brightness-110">点击跳转支付</button>
          </div>
        )}

        {result ? (
          <p role="alert" className={`mt-4 rounded-xl px-3 py-2 text-sm ${result === 'timeout' ? 'bg-gray-50 text-gray-600 dark:bg-white/[0.04] dark:text-gray-300' : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300'}`}>{RESULT_TEXT[result]}</p>
        ) : <p aria-live="polite" className="mt-4 text-center text-xs text-gray-400">正在等待支付结果…</p>}
      </div>
    </div>,
    document.body,
  )
}
