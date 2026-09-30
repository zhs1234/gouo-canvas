import { StudioError } from './images-error.mjs'

export const NEW_API_ROUTING_COMMIT = '0aec08fee811ec6136828fda790551b49e410301'
export function validateNormalRouting(evidence, gateway, models) {
  if (!evidence || evidence.sourceCommit !== NEW_API_ROUTING_COMMIT || evidence.retryTimes !== 0 ||
      evidence.gatewayOrigin !== new URL(gateway).origin || evidence.operatorVerified !== true ||
      typeof evidence.verifiedAt !== 'string' || !Number.isFinite(Date.parse(evidence.verifiedAt))) {
    throw new Error('普通模型路由需要当前网关固定版本与 RetryTimes=0 的人工核验记录')
  }
  if (models.some(model => model.channelId !== undefined)) throw new Error('普通模型路由不能配置 channelId；请使用独立目录，不要静默删除固定渠道')
}
export function relayKey(config, model) {
  if (config.relayRoutingMode === 'model') {
    validateNormalRouting(config.normalRoutingEvidence, config.gateway, [model])
    if (/-\d+$/.test(config.relayKey)) throw new StudioError('普通模型路由需要无渠道后缀的基础令牌', 503)
    return config.relayKey
  }
  if (!model.channelId) return config.relayKey
  if (/-\d+$/.test(config.relayKey)) throw new StudioError('跨渠道配置需要未固定渠道的基础令牌', 503)
  // New API's token channel pin disables gateway retries for this operation.
  return `${config.relayKey}-${model.channelId}`
}
export function recordGatewayResponse(config, response) {
  config.onGatewayResponse?.({ requestId: response.headers.get('x-oneapi-request-id'), status: response.status })
}
