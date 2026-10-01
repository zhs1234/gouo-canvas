import { money, usageEvidence, type StudioBilling, type StudioUsage } from '../lib/billing'

export function BillingPanel({ data, error, loading, refresh, usage }: { data?: StudioBilling; error?: Error | null; loading: boolean; refresh: () => void; usage?: StudioUsage }) {
  return <div className="gateway-status" aria-label="账户用量">
    <div className="flex items-center justify-between"><p>余额与用量</p><button type="button" onClick={refresh} className="text-xs underline" disabled={loading}>刷新用量</button></div>
    {error ? <p role="alert">{error.message}</p> : !data ? <p>正在读取账户用量…</p> : <>
      <div className="grid grid-cols-2 gap-4 mb-4"><div><span className="text-xs text-muted-foreground">可用余额</span><div className="text-xl font-medium">{money(data.balance)}</div></div><div><span className="text-xs text-muted-foreground">累计用量折算</span><div className="text-xl font-medium">{money(data.spent, true)}</div></div></div>
      <p>余额为 New API 当前余额；累计用量为 New API 用量记录折算，不代表钱包实扣。</p>
      <p>New API 用量记录 · {data.groupRatio} 倍 · 已调用 {data.requestCount} 次</p>
      {usage && <p>{usageEvidence(usage)}</p>}
      {data.prices.length > 0 && <details><summary className="cursor-pointer text-xs mb-3">查看模型单价</summary>{data.prices.map(model => <div key={model.id} className="text-xs mb-3"><div className="font-medium mb-1">{model.displayName}</div>{model.mode === 'per-request' && model.price !== undefined ? <div>{money(model.price * data.usdExchangeRate, true)} / 次</div> : model.tiers.length ? model.tiers.map((tier, i) => <div key={tier.name} className="text-muted-foreground leading-6">
        {model.longContextAfter ? `${i ? '长上下文' : '标准'} · ` : ''}
        输入 {money((tier.rates.p ?? 0) * data.usdExchangeRate, true)} · 输出 {money((tier.rates.c ?? 0) * data.usdExchangeRate, true)} / 100万 token
        {tier.rates.img !== undefined && <div>图片输入 {money(tier.rates.img * data.usdExchangeRate, true)} / 100万 token</div>}
      </div>) : <div>按已配置的网关规则结算</div>}</div>)}<p>人民币换算：1 美元 = {data.usdExchangeRate} 元。按对应模型规则结算；余额换算不是供应商成本硬上限。</p></details>}
      {data.recentCalls.length > 0 && <details><summary className="cursor-pointer text-xs mb-3">最近调用记录折算（实扣待核对）</summary>{data.recentCalls.map(call => <div key={call.id} className="flex justify-between text-xs gap-2 mb-2"><span>{call.model}</span><span>{money(call.cost, true)}</span></div>)}</details>}
    </>}
  </div>
}
