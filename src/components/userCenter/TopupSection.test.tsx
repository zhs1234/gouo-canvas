import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { GouoUser } from '../../lib/gouoBackend'

vi.mock('../../hooks/useImageModels', () => ({ useImageModels: () => [] }))
vi.mock('../../lib/gouoBackend', () => ({ redeemCode: vi.fn() }))

import TopupSection from './TopupSection'

it('后台填写的网址可点击、二维码图片直接显示，并提供购买兑换码按钮', () => {
  const status = {
    emailService: false, turnstileEnabled: false, turnstileSiteKey: '', loading: false, error: '', reload: () => {},
    redemptionHelp: '在卡网购买：https://shop.example/c/1，付款后自动发码\nhttps://img.example/wechat-qr.png',
    supportContact: '微信：gouo-help',
    topupUrl: 'https://shop.example/',
  }
  const markup = renderToStaticMarkup(<TopupSection user={{ id: 1 } as GouoUser} status={status} onRedeemed={async () => {}} />)
  expect(markup).toContain('<a href="https://shop.example/c/1" target="_blank" rel="noopener noreferrer"')
  expect(markup).toContain('，付款后自动发码')
  expect(markup).toContain('<img src="https://img.example/wechat-qr.png"')
  expect(markup).toContain('购买兑换码 →')
  expect(markup).toContain('微信：gouo-help')
})
