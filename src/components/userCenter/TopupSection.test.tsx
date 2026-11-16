import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { GouoUser } from '../../lib/gouoBackend'
import type { TopupPayment } from '../../lib/topup'
import type { UserCenterServiceStatus } from '../UserCenterModal'

vi.mock('react-dom', async (load) => ({ ...await load<typeof import('react-dom')>(), createPortal: (node: unknown) => node }))
vi.mock('../../hooks/useImageModels', () => ({ useImageModels: () => [] }))
vi.mock('../../lib/gouoBackend', () => ({ redeemCode: vi.fn(), backendRequest: vi.fn() }))

import TopupPayDialog from './TopupPayDialog'
import TopupSection from './TopupSection'

const status: UserCenterServiceStatus = {
  emailService: false, turnstileEnabled: false, turnstileSiteKey: '', loading: false, error: '', reload: () => {},
  redemptionHelp: '在卡网购买：https://shop.example/c/1，付款后自动发码\nhttps://img.example/wechat-qr.png',
  supportContact: '微信：gouo-help',
  topupUrl: 'https://shop.example/',
  onlineTopup: null,
}
const render = (value = status) => renderToStaticMarkup(<TopupSection user={{ id: 1 } as GouoUser} status={value} onRedeemed={async () => {}} />)

it('后台填写的网址可点击、二维码图片直接显示，并提供购买兑换码按钮', () => {
  const markup = render()
  expect(markup).toContain('<a href="https://shop.example/c/1" target="_blank" rel="noopener noreferrer"')
  expect(markup).toContain('，付款后自动发码')
  expect(markup).toContain('<img src="https://img.example/wechat-qr.png"')
  expect(markup).toContain('购买兑换码 →')
  expect(markup).toContain('微信：gouo-help')
})

it('未开放在线充值时保持兑换码充值页面不变', () => {
  const markup = render()
  expect(markup).not.toContain('在线充值')
  expect(markup).not.toContain('最近充值订单')
  expect(markup).toContain('兑换码充值')
  expect(markup).toContain('图片模型价格')
})

it('开放在线充值时在兑换码之上显示积分包、自定义金额、支付方式和订单列表', () => {
  const markup = render({
    ...status,
    onlineTopup: { packages: [{ price: 10, points: 1000, bonus: 0 }, { price: 50, points: 5000, bonus: 150 }], custom: { min: 5, max: 2000 } },
  })
  expect(markup).toContain('1 元 = 100 积分，支付后自动到账')
  expect(markup.indexOf('在线充值')).toBeLessThan(markup.indexOf('兑换码充值'))
  expect(markup).toMatch(/aria-pressed="true"[^>]*>.*?¥10<\/span>.*?1,000 积分/)
  expect(markup).toContain('赠送 150')
  expect(markup).toContain('自定义金额')
  expect(markup).toContain('¥5–2000')
  expect(markup).toContain('正在读取支付方式…')
  expect(markup).toContain('应付 <span class="text-lg font-bold tabular-nums">¥10</span>')
  expect(markup).toContain('最近充值订单')
  expect(markup).toContain('暂无充值订单')
  expect(markup).toContain('购买兑换码 →')
})

// 弹窗通过 portal 挂到 body，测试里直接渲染内容
vi.stubGlobal('document', { body: {} })

const payment = (type: 1 | 2, url: string): TopupPayment => ({ trade_no: 'T100', type, data: { url }, pay_amount: 10.06, currency: 'CNY', points: 1150 })

it('扫码支付显示二维码、实付金额，支付宝链接在手机上可直接打开', () => {
  const markup = renderToStaticMarkup(<TopupPayDialog payment={payment(2, 'https://qr.alipay.com/abc123')} onPaid={() => {}} onClose={() => {}} />)
  expect(markup).toContain('实付 ¥10.06')
  expect(markup).toContain('到账 1,150 积分')
  expect(markup).toMatch(/<img src="data:image\/svg\+xml;utf8,%3Csvg[^"]+" alt="支付二维码"/)
  expect(markup).toContain('<a href="https://qr.alipay.com/abc123" target="_blank" rel="noopener noreferrer"')
  expect(markup).toContain('打开支付宝')
  expect(markup).not.toContain('点击跳转支付')
  expect(renderToStaticMarkup(<TopupPayDialog payment={payment(2, 'weixin://wxpay/bizpayurl?pr=1')} onPaid={() => {}} onClose={() => {}} />)).not.toContain('打开支付宝')
})

it('跳转支付提供手动跳转按钮，不显示二维码', () => {
  const markup = renderToStaticMarkup(<TopupPayDialog payment={payment(1, 'https://pay.example/submit')} onPaid={() => {}} onClose={() => {}} />)
  expect(markup).toContain('实付 ¥10.06')
  expect(markup).toContain('点击跳转支付')
  expect(markup).not.toContain('支付二维码')
})
