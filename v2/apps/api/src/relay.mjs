import { StudioError } from './images-error.mjs'

export function relayKey(config, model) {
  if (!model.channelId) return config.relayKey
  if (/-\d+$/.test(config.relayKey)) throw new StudioError('跨渠道配置需要未固定渠道的基础令牌', 503)
  // New API's token channel pin disables gateway retries for this operation.
  return `${config.relayKey}-${model.channelId}`
}
export function recordGatewayResponse(config, response) {
  config.onGatewayResponse?.({ requestId: response.headers.get('x-oneapi-request-id'), status: response.status })
}
