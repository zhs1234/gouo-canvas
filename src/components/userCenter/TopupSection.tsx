import { type FormEvent, useState } from 'react'
import type { GouoUser } from '../../lib/gouoBackend'
import { redeemCode } from '../../lib/gouoBackend'
import { copyTextToClipboard } from '../../lib/clipboard'
import { formatPoints } from '../../lib/accountUsage'
import { useImageModels } from '../../hooks/useImageModels'
import type { UserCenterServiceStatus } from '../UserCenterModal'

// 运营方在后台填写的充值说明和客服信息：网址可点击，单独一行的图片网址显示为图片（如微信、群二维码）
const URL_PATTERN = /(https?:\/\/[^\s，。；、）)】]+)/
const IMAGE_LINE = /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i

function RichText({ text, className }: { text: string; className: string }) {
  return <div data-selectable-text className={className}>{text.split('\n').map((line, idx) => IMAGE_LINE.test(line.trim())
    ? <img key={idx} src={line.trim()} alt="" loading="lazy" className="my-2 max-h-48 rounded-lg" />
    : <p key={idx} className="min-h-[1.25em] whitespace-pre-wrap break-words">{line.split(URL_PATTERN).map((part, partIdx) => partIdx % 2 ? <a key={partIdx} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">{part}</a> : part)}</p>)}</div>
}

export default function TopupSection({ user, status, onRedeemed }: { user: GouoUser; status: UserCenterServiceStatus; onRedeemed: () => Promise<void> }) {
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const models = useImageModels()

  const handleRedeem = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return
    setRedeeming(true)
    setError('')
    setMessage('')
    try {
      const quota = await redeemCode(code)
      setCode('')
      const rate = user.quota_cny_rate
      setMessage(typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? `充值成功，已增加 ${formatPoints(quota * rate)}` : '充值成功，余额已更新')
      await onRedeemed()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-blue-100/60 p-5 dark:border-blue-500/15 dark:from-blue-500/[0.08] dark:to-blue-700/[0.04]">
        <p className="font-semibold text-gray-900 dark:text-white">兑换码充值</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">积分充入当前账户，每个兑换码只能使用一次。</p>
        {status.redemptionHelp && <RichText text={status.redemptionHelp} className="mt-3 text-sm text-gray-600 dark:text-gray-300" />}
        {/^https?:\/\//.test(status.topupUrl) && <a href={status.topupUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 transition hover:border-blue-400 hover:bg-blue-50 dark:border-blue-500/30 dark:bg-white/[0.04] dark:text-blue-400">购买兑换码 →</a>}
        <form onSubmit={handleRedeem} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" placeholder="请输入光构兑换码" className="min-w-0 flex-1 rounded-xl border border-blue-100 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 dark:border-white/10 dark:bg-gray-950/60 dark:text-white" />
          <button type="submit" disabled={redeeming || !code.trim()} className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-800 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
            {redeeming ? '兑换中…' : '立即兑换'}
          </button>
        </form>
        {message && <p className="mt-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>

      <section className="rounded-2xl border border-gray-100 p-5 text-sm dark:border-white/[0.08]" aria-label="图片模型价格">
        <p className="font-semibold text-gray-900 dark:text-white">图片模型价格</p>
        <p className="mt-1 text-xs text-gray-400">按成功生成的张数计费，没有返回图片的请求自动退回积分。</p>
        {models.length ? (
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-white/[0.06]">
            {models.map((model) => (
              <li key={model.id} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">{model.name}</span>
                <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{formatPoints(model.price_cny)}/张</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-gray-400">正在读取模型价格…</p>}
      </section>

      <section className="rounded-2xl border border-gray-100 p-5 text-sm dark:border-white/[0.08]" aria-label="充值与账务帮助">
        <p className="font-semibold text-gray-900 dark:text-white">充值与账务帮助</p>
        {status.error ? (
          <div role="alert" className="mt-2 space-y-1 text-red-600 dark:text-red-400">
            <p>客服信息读取失败：{status.error}</p>
            <button type="button" onClick={status.reload} disabled={status.loading} className="underline">重新加载</button>
          </div>
        ) : (
          status.supportContact ? <RichText text={status.supportContact} className="mt-2 text-gray-500 dark:text-gray-400" /> : <p className="mt-2 text-gray-500 dark:text-gray-400">{status.loading ? '正在读取客服信息…' : '客服联系方式暂未配置。'}</p>
        )}
        {status.supportContact && <div className="mt-3 flex flex-wrap items-center gap-4">
          <button type="button" className="text-blue-600 underline dark:text-blue-400" onClick={async () => {
            try { await copyTextToClipboard(status.supportContact); setCopied(true) }
            catch { setError('复制失败，请手动选中并复制上方联系方式') }
          }}>{copied ? '已复制联系方式' : '复制联系方式'}</button>
        </div>}
        <p className="mt-3 text-xs text-gray-400">反馈时请附用户 ID {user.id}、发生时间与图片请求编号。请勿发送密码、完整兑换码或 API 密钥。</p>
      </section>
    </div>
  )
}
