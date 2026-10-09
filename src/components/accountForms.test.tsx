import { type ReactElement, type ReactNode, isValidElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BackendAuthGate from './BackendAuthGate'
import LandingPage from './landing/LandingPage'
import UserCenterModal from './UserCenterModal'

// 直接驱动组件事件与 hook 状态，检查真实 JSX 的禁用条件；不发送网络请求或模拟验证码。
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }))
const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getBackendStatus: vi.fn(), sendEmailVerification: vi.fn(),
  sendPasswordReset: vi.fn(), updatePassword: vi.fn(), createBackendSettings: vi.fn(), bindEmail: vi.fn(),
  showToast: vi.fn(), setSettings: vi.fn(),
}))
vi.mock('react', async (load) => ({
  ...await load<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial
    return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value }]
  },
  useRef: (initial: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = { current: initial }
    return state.slots[index]
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => {
    const index = state.cursor++
    if (index in state.slots) return
    state.slots[index] = true
    state.effects.push(effect)
  },
}))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../lib/gouoBackend', () => ({ ...api, isBackendAuthEnabled: () => true }))
vi.mock('../store', () => ({ useStore: { getState: () => api } }))
vi.mock('../lib/cloudSync', () => ({ useCloudSyncSnapshot: () => ({}) }))
vi.mock('../hooks/useCloseOnEscape', () => ({ useCloseOnEscape: () => {} }))
vi.mock('../hooks/usePreventBackgroundScroll', () => ({ usePreventBackgroundScroll: () => {} }))

type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (isValidElement<Record<string, unknown>>(node)) return text(node.props.children as ReactNode)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function field(node: ReactNode, prop: string, value: string) {
  const found = elements(node).find((element) => element.type === 'input' && element.props[prop] === value)
  if (!found) throw new Error(`Missing input ${prop}=${value}`)
  return found
}
function button(node: ReactNode, label: string) {
  const found = elements(node).find((element) => element.type === 'button' && text(element) === label)
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
function fire(element: Element, event: string, value?: string) {
  return (element.props[event] as (event: unknown) => unknown)({ target: { value }, preventDefault() {} })
}
function render(component: () => ReactNode) {
  state.cursor = 0
  return component()
}
async function flush() {
  for (const effect of state.effects.splice(0)) effect()
  for (let step = 0; step < 8; step++) await Promise.resolve()
}

beforeEach(() => {
  state.slots = []
  state.effects = []
  state.cursor = 0
  vi.resetAllMocks()
  vi.stubGlobal('window', { location: { search: '', origin: 'http://localhost' }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { body: {} })
  api.getCurrentUser.mockRejectedValue(new Error('HTTP 401'))
  api.getBackendStatus.mockResolvedValue({ email_service: true, email_verification: true })
  api.sendEmailVerification.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('account email and password forms', () => {
  it('restores the reset recipient and locks it while sending, then clears the old code on recipient change', async () => {
    window.location.search = '?email=creator%2Breset%40example.invalid&token=reset-code'
    const draw = () => BackendAuthGate({ children: null })
    render(draw)
    await flush()
    let tree = render(draw)
    expect(field(tree, 'type', 'email').props.value).toBe('creator+reset@example.invalid')
    let finish!: () => void
    api.sendPasswordReset.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    fire(button(tree, '发送邮件'), 'onClick')
    tree = render(draw)
    expect(field(tree, 'type', 'email').props.disabled).toBe(true)
    expect(button(tree, '返回登录').props.disabled).toBe(true)
    finish()
    await flush()
    tree = render(draw)
    expect(button(tree, '重新发送')).toBeDefined()
    fire(field(tree, 'type', 'email'), 'onChange', 'other@example.invalid')
    tree = render(draw)
    expect(field(tree, 'placeholder', '邮件验证码').props.value).toBe('')
    expect(button(tree, '发送邮件')).toBeDefined()
  })

  it('locks registration recipient and mode until its verification request completes', async () => {
    const draw = () => BackendAuthGate({ children: null })
    render(draw)
    await flush()
    // 未登录先显示首页，由首页的注册入口进入表单。
    const landing = elements(render(draw)).find((element) => element.type === LandingPage)
    if (!landing) throw new Error('Missing landing page')
    ;(landing.props.onRegister as () => void)()
    fire(field(render(draw), 'type', 'email'), 'onChange', 'first@example.invalid')
    let finish!: () => void
    api.sendEmailVerification.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    fire(button(render(draw), '发送验证码'), 'onClick')
    let tree = render(draw)
    expect(field(tree, 'type', 'email').props.disabled).toBe(true)
    expect(button(tree, '返回登录').props.disabled).toBe(true)
    finish()
    await flush()
    tree = render(draw)
    expect(field(tree, 'type', 'email').props.disabled).toBe(false)
    fire(field(tree, 'type', 'email'), 'onChange', 'second@example.invalid')
    expect(text(render(draw))).not.toContain('验证码已发送，请检查邮箱')
    expect(api.sendEmailVerification).toHaveBeenCalledWith('first@example.invalid', '')
  })

  it('locks binding and resend together and clears verification when the recipient changes', async () => {
    api.getCurrentUser.mockResolvedValue({ id: 1, username: 'creator' })
    const draw = () => UserCenterModal({ initialSection: 'security', onClose: vi.fn() })
    render(draw)
    await flush()
    fire(field(render(draw), 'placeholder', '邮箱地址'), 'onChange', 'first@example.invalid')
    fire(field(render(draw), 'placeholder', '邮箱验证码'), 'onChange', '123456')
    let finish!: () => void
    api.sendEmailVerification.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    fire(button(render(draw), '发送验证码'), 'onClick')
    let tree = render(draw)
    expect(field(tree, 'placeholder', '邮箱地址').props.disabled).toBe(true)
    expect(button(tree, '绑定邮箱').props.disabled).toBe(true)
    finish()
    await flush()
    tree = render(draw)
    fire(field(tree, 'placeholder', '邮箱地址'), 'onChange', 'second@example.invalid')
    expect(field(render(draw), 'placeholder', '邮箱验证码').props.value).toBe('')
    fire(field(render(draw), 'placeholder', '邮箱验证码'), 'onChange', '654321')
    api.bindEmail.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const form = elements(render(draw)).find((element) => element.type === 'form' && text(element).includes('绑定邮箱'))!
    const pending = fire(form, 'onSubmit')
    tree = render(draw)
    expect(field(tree, 'placeholder', '邮箱地址').props.disabled).toBe(true)
    expect(button(tree, '发送验证码').props.disabled).toBe(true)
    finish()
    await pending
  })

  it('keeps successful password change separate from token refresh failure and retries only the token', async () => {
    api.getCurrentUser.mockResolvedValue({ id: 1, username: 'creator' })
    api.updatePassword.mockResolvedValue(undefined)
    api.createBackendSettings.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue({ apiKey: 'new-token' })
    const draw = () => UserCenterModal({ initialSection: 'security', onClose: vi.fn() })
    render(draw)
    await flush()
    for (const [placeholder, value] of [['当前密码', 'old-password'], ['新密码（8–20 个字符）', 'new-password'], ['再次输入新密码', 'new-password']]) {
      fire(field(render(draw), 'placeholder', placeholder), 'onChange', value)
    }
    const form = elements(render(draw)).find((element) => element.type === 'form' && text(element).includes('修改密码'))!
    await fire(form, 'onSubmit')
    let tree = render(draw)
    expect(field(tree, 'placeholder', '当前密码').props.value).toBe('')
    expect(field(tree, 'placeholder', '新密码（8–20 个字符）').props.value).toBe('')
    expect(text(tree)).toContain('密码已修改，但创作凭据刷新失败')
    expect(api.showToast).toHaveBeenCalledWith('密码已修改', 'success')
    fire(button(tree, '重新刷新创作凭据'), 'onClick')
    await flush()
    tree = render(draw)
    expect(text(tree)).not.toContain('密码已修改，但创作凭据刷新失败')
    expect(api.updatePassword).toHaveBeenCalledTimes(1)
    expect(api.createBackendSettings).toHaveBeenCalledTimes(2)
    expect(api.setSettings).toHaveBeenCalledWith({ apiKey: 'new-token' })
  })
})
