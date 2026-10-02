import { StudioError } from './images-error.mjs'
import { validateAccountUpdate, passthroughAccountUpdate, confirmAccountProfile } from './account-update.mjs'

export function profileBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'display_name')
      || typeof input.display_name !== 'string') throw new StudioError('仅支持修改本人显示名称', 422)
  const body = { display_name: input.display_name.trim() }
  validateAccountUpdate(body)
  return body
}

export async function updateStudioProfile(config, authorization, owner, input, fetcher = fetch) {
  const body = profileBody(input)
  if (!Number.isSafeInteger(owner) || owner <= 0) throw new StudioError('账号身份无效', 403)
  // Fixed Native UpdateSelf builds a clean User and Updates(struct) preserves
  // omitted fields. Never send a setting snapshot or auth/security headers.
  try {
    const result = await passthroughAccountUpdate(config, authorization, body, {}, fetcher)
    if (!result.body.success) throw new Error('unconfirmed')
    await confirmAccountProfile(config, authorization, owner, body.display_name, fetcher)
  } catch {
    // Native may commit before a cache/response/confirmation failure.
    throw new StudioError('显示名称更新结果待确认，请勿再次提交；可只读刷新核对，不会自动重试', 502)
  }
  return { id: owner, display_name: body.display_name, confirmed: true }
}
