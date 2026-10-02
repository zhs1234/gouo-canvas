import { StudioError } from './images-error.mjs'

const unknown = () => new StudioError('原生账号操作结果待确认，请勿重新提交', 502)
const textLength = value => typeof value === 'string' ? [...value].length : -1
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function validateAccountUpdate(input) {
  if (!plain(input)) throw new StudioError('账号更新内容无效', 422)
  const keys = Object.keys(input)
  if (keys.length === 1 && keys[0] === 'display_name' && textLength(input.display_name) >= 1 && textLength(input.display_name) <= 20) {
    return { kind: 'profile', body: { display_name: input.display_name } }
  }
  if (keys.includes('password') && keys.every(key => ['password', 'original_password'].includes(key))
      && textLength(input.password) >= 8 && textLength(input.password) <= 128
      && (!keys.includes('original_password') || typeof input.original_password === 'string')) {
    return { kind: 'password', body: { password: input.password, ...(keys.includes('original_password') ? { original_password: input.original_password } : {}) } }
  }
  throw new StudioError('仅支持显示名称或原生密码更新，请勿包含其他字段', 422)
}

function headers(authorization, options) {
  if (typeof authorization !== 'string' || !authorization || /[\r\n]/.test(authorization)) throw new StudioError('账号认证无效', 401)
  const result = { Authorization: authorization }
  for (const [key, value] of [['X-Security-Proof', options.securityProof], ['X-Auth-Session', options.authSession]]) {
    if (value === undefined) continue
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) throw new StudioError('原生安全验证请求头无效', 422)
    result[key] = value
  }
  return result
}

async function request(config, authorization, options, fetcher, body) {
  const requestHeaders = headers(authorization, options)
  let response, result
  try {
    response = await fetcher(new URL('/api/user/self', config.authOrigin), {
      method: body === undefined ? 'GET' : 'PUT', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { ...requestHeaders, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    result = await response.json()
  } catch { throw unknown() }
  if (!plain(result) || typeof result.success !== 'boolean' || typeof result.message !== 'string'
      || (result.success && !response.ok)) throw unknown()
  return { status: response.status, body: result }
}

export async function passthroughAccountUpdate(config, authorization, input, options = {}, fetcher = fetch) {
  const update = validateAccountUpdate(input)
  const result = await request(config, authorization, options, fetcher, update.body)
  if (result.body.success && update.kind === 'password') {
    const data = result.body.data
    if (!plain(data) || typeof data.access_token !== 'string' || !data.access_token || data.token_type !== 'Bearer'
        || !Number.isSafeInteger(data.access_expires_at) || data.access_expires_at <= 0
        || !plain(data.session) || typeof data.session.sid !== 'string' || !data.session.sid || data.session.current !== true
        || data.has_password !== true || typeof data.notification_warning !== 'boolean') throw unknown()
  }
  return result
}

export async function confirmAccountProfile(config, authorization, expectedOwner, displayName, fetcher = fetch) {
  validateAccountUpdate({ display_name: displayName })
  if (!Number.isSafeInteger(expectedOwner) || expectedOwner <= 0) throw new StudioError('账号身份无效', 403)
  const result = await request(config, authorization, {}, fetcher)
  if (!result.body.success) throw new StudioError('原生账号确认失败', result.status === 401 ? 401 : result.status === 403 ? 403 : 502)
  const account = result.body.data
  if (!plain(account) || !Number.isSafeInteger(account.id) || typeof account.display_name !== 'string') throw unknown()
  if (account.id !== expectedOwner) throw new StudioError('原生账号不属于当前用户', 403)
  if (account.display_name !== displayName) throw unknown()
  return { confirmed: true }
}
