import { useTrial } from './trial'

export function TrialPanel({ userId }: { userId: number }) {
  const trial = useTrial(userId)
  const data = trial.data
  return <section className="gateway-status" aria-label="新用户试用">
    <div className="flex items-center justify-between"><p>新用户试用</p><button type="button" className="text-xs underline" disabled={trial.isFetching} onClick={() => { void trial.refetch() }}>重新查询试用</button></div>
    {trial.error ? <p role="alert">试用状态暂时无法读取，请重新查询。</p> : !data ? <p role="status">正在查询试用状态…</p> : <>
      <p>{data.message}</p>
      {data.state === 'eligible' && <p>首条发送满足开通条件后，自动开通 4 次聊天与 1 次生图。</p>}
      {['active', 'exhausted', 'pending', 'expired'].includes(data.state) && <p>试用剩余：聊天 {data.chat.remaining}/4 次 · 图片 {data.image.remaining}/1 次</p>}
      {(data.state === 'pending' || data.pendingReconciliation) && <p role="status">请求结果待核对，已占用的次数暂不退回。重新查询仅查看状态，不会重新生成。</p>}
      {data.state === 'exhausted' && <p>试用已用完，<a href="/wallet">前往 New API 充值</a>。</p>}
      <p className="text-xs text-muted-foreground">聊天按用户发送计次：一次发送最多调用 3 次聊天模型，仍占 1 次聊天。图片工具另扣 1 次生图。实际模型费用由 New API 记录。</p>
    </>}
  </section>
}
