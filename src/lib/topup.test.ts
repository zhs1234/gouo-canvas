import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./gouoBackend', () => ({ backendRequest: mocks.request }))

import { createTopupOrder, formatPayAmount, getPaymentGateways, getTopupOptions, getTopupOrders, openPayUrl, watchTopupOrder } from './topup'

const order = (status: string, extra = {}) => ({ trade_no: 'T1', status, points: 1150, pay_amount: 10.06, currency: 'CNY', created_at: 1_700_000_000, ...extra })

afterEach(() => {
  mocks.request.mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('getTopupOptions', () => {
  it('旧后端没有在线充值字段或未开放时视为未开放', () => {
    expect(getTopupOptions({})).toBeNull()
    expect(getTopupOptions({ turnstile_check: false, gouo_topup_url: 'https://shop.example/' })).toBeNull()
    expect(getTopupOptions({ gouo_online_topup: false, gouo_topup_packages: [{ price: 10, points: 1000, bonus: 0 }] })).toBeNull()
  })

  it('解析积分包和自定义金额范围', () => {
    expect(getTopupOptions({
      gouo_online_topup: true,
      gouo_topup_packages: [{ price: 10, points: 1000, bonus: 0 }, { price: 50, points: 5000, bonus: 150, extra: 'x' }],
      gouo_topup_custom: { min: 5, max: 2000 },
    })).toEqual({ packages: [{ price: 10, points: 1000, bonus: 0 }, { price: 50, points: 5000, bonus: 150 }], custom: { min: 5, max: 2000 } })
    expect(getTopupOptions({ gouo_online_topup: true, gouo_topup_packages: [{ price: 10, points: 1000, bonus: 0 }], gouo_topup_custom: null }))
      .toEqual({ packages: [{ price: 10, points: 1000, bonus: 0 }], custom: null })
  })

  it('积分包有一项格式错误时整体不用，避免下单下标错位；没有可买的选项时视为未开放', () => {
    expect(getTopupOptions({ gouo_online_topup: true, gouo_topup_packages: [{ price: 10, points: 1000, bonus: 0 }, { price: '50', points: 5000, bonus: 0 }], gouo_topup_custom: { min: 1, max: 100 } }))
      .toEqual({ packages: [], custom: { min: 1, max: 100 } })
    expect(getTopupOptions({ gouo_online_topup: true, gouo_topup_packages: [{ price: 0, points: 0, bonus: 0 }] })).toBeNull()
    expect(getTopupOptions({ gouo_online_topup: true, gouo_topup_packages: 'oops', gouo_topup_custom: { min: 10, max: 5 } })).toBeNull()
    expect(getTopupOptions({ gouo_online_topup: true, gouo_topup_custom: { min: 1.5, max: 5 } })).toBeNull()
  })
})

describe('支付接口', () => {
  it('支付方式按 sort 从大到小排列，缺省字段补默认值，null 视为没有可用方式', async () => {
    mocks.request.mockResolvedValueOnce([
      { uuid: 'a', name: '微信', icon: '', fixed_fee: 0, percent_fee: 0.006, currency: 'CNY', sort: 1 },
      { uuid: 'b', name: '支付宝', icon: 'https://img.example/alipay.png', currency: 'CNY', sort: 5, id: 3 },
    ])
    const list = await getPaymentGateways()
    expect(mocks.request).toHaveBeenCalledWith('/api/user/payment')
    expect(list.map((item) => item.uuid)).toEqual(['b', 'a'])
    expect(list[0]).toEqual({ uuid: 'b', name: '支付宝', icon: 'https://img.example/alipay.png', fixed_fee: 0, percent_fee: 0, currency: 'CNY', sort: 5 })
    mocks.request.mockResolvedValueOnce(null)
    expect(await getPaymentGateways()).toEqual([])
    mocks.request.mockResolvedValueOnce([{ name: '缺少 uuid' }])
    await expect(getPaymentGateways()).rejects.toThrow('支付方式格式无效')
  })

  it('下单请求积分包或自定义金额，并校验返回的支付信息', async () => {
    const payment = { trade_no: 'T1', type: 1, data: { url: 'https://pay.example/submit', method: 'POST', params: { pid: 1001, sign: 'abc' } }, pay_amount: 10.06, currency: 'CNY', points: 1150 }
    mocks.request.mockResolvedValueOnce(payment)
    expect(await createTopupOrder({ gateway: 'g1', package: 1 })).toEqual(payment)
    expect(mocks.request).toHaveBeenCalledWith('/api/gouo/topup/order', { method: 'POST', body: '{"gateway":"g1","package":1}' })

    mocks.request.mockResolvedValueOnce({ ...payment, type: 2, data: { url: 'https://qr.alipay.com/abc' } })
    expect((await createTopupOrder({ gateway: 'g1', amount: 20 })).type).toBe(2)
    expect(mocks.request).toHaveBeenLastCalledWith('/api/gouo/topup/order', { method: 'POST', body: '{"gateway":"g1","amount":20}' })

    for (const invalid of [
      { ...payment, data: { url: 'javascript:alert(1)' } },
      { ...payment, type: 3 },
      { ...payment, pay_amount: '10' },
      { ...payment, data: { url: 'https://pay.example', params: { nested: {} } } },
      { ...payment, trade_no: '' },
      null,
    ]) {
      mocks.request.mockResolvedValueOnce(invalid)
      await expect(createTopupOrder({ gateway: 'g1', package: 0 })).rejects.toThrow('支付订单格式无效')
    }
  })

  it('查询订单并校验状态取值', async () => {
    mocks.request.mockResolvedValueOnce([order('pending'), order('success', { trade_no: 'T2' })])
    expect(await getTopupOrders()).toHaveLength(2)
    expect(mocks.request).toHaveBeenLastCalledWith('/api/gouo/topup/orders')
    mocks.request.mockResolvedValueOnce(null)
    expect(await getTopupOrders('T 1&x')).toEqual([])
    expect(mocks.request).toHaveBeenLastCalledWith('/api/gouo/topup/orders?trade_no=T%201%26x')
    mocks.request.mockResolvedValueOnce([order('paid')])
    await expect(getTopupOrders()).rejects.toThrow('充值订单格式无效')
  })

  it('实付金额按币种显示', () => {
    expect(formatPayAmount(10, 'CNY')).toBe('¥10')
    expect(formatPayAmount(10.064, '')).toBe('¥10.06')
    expect(formatPayAmount(1.5, 'USD')).toBe('1.5 USD')
  })
})

describe('openPayUrl', () => {
  it('网关要求 POST 时用表单提交到新窗口', () => {
    const form = { method: '', action: '', target: '', inputs: [] as Array<Record<string, string>>, appendChild(input: Record<string, string>) { this.inputs.push(input) }, submit: vi.fn(), remove: vi.fn() }
    const body = { appendChild: vi.fn() }
    vi.stubGlobal('document', { body, createElement: (tag: string) => tag === 'form' ? form : {} })
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    openPayUrl({ url: 'https://pay.example/submit', method: 'post', params: { pid: 1001, sign: 'abc' } })
    expect(form).toMatchObject({ method: 'POST', action: 'https://pay.example/submit', target: '_blank' })
    expect(form.inputs).toEqual([{ type: 'hidden', name: 'pid', value: '1001' }, { type: 'hidden', name: 'sign', value: 'abc' }])
    expect(body.appendChild).toHaveBeenCalledWith(form)
    expect(form.submit).toHaveBeenCalledOnce()
    expect(form.remove).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
  })

  it('其他情况直接在新窗口打开链接，并断开与本页的关联', () => {
    const win = { opener: {} }
    const open = vi.fn().mockReturnValue(win)
    vi.stubGlobal('window', { open })
    openPayUrl({ url: 'https://pay.example/cashier?id=1', method: 'GET', params: { a: 1 } })
    expect(open).toHaveBeenCalledWith('https://pay.example/cashier?id=1', '_blank')
    expect(win.opener).toBeNull()
    // 被浏览器拦截时 window.open 返回 null，不报错
    open.mockReturnValue(null)
    expect(() => openPayUrl({ url: 'https://pay.example/cashier' })).not.toThrow()
  })
})

describe('watchTopupOrder', () => {
  it('立即并每 3 秒查询，出错继续重试，到账后停止', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.request
      .mockResolvedValueOnce([order('pending')])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([order('success')])
    const onSettle = vi.fn()
    watchTopupOrder('T1', 60_000, onSettle)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('/api/gouo/topup/orders?trade_no=T1')
    await vi.advanceTimersByTimeAsync(9000)
    expect(onSettle).toHaveBeenCalledExactlyOnceWith(order('success'))
    expect(console.warn).toHaveBeenCalledWith('查询充值订单失败', expect.any(Error))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.request).toHaveBeenCalledTimes(4)
  })

  it('超时回调 null；停止后不再查询或回调', async () => {
    vi.useFakeTimers()
    mocks.request.mockResolvedValue([order('pending')])
    const onSettle = vi.fn()
    watchTopupOrder('T1', 10_000, onSettle)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(onSettle).toHaveBeenCalledExactlyOnceWith(null)

    mocks.request.mockClear()
    const other = vi.fn()
    const stop = watchTopupOrder('T1', 60_000, other)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    mocks.request.mockResolvedValue([order('closed')])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })
})
