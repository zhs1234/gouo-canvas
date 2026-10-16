import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { getMaxTaskImages, isLowModerationAllowed } from './gouoBackend'
import { normalizeImageSize } from './size'

export function normalizeTaskParams(params: TaskParams): TaskParams {
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    // 一次最多生成张数和宽松审核都由后台“光构设置”决定
    // 旧版本可能持久化了 2.5 这样的小数张数，取整后再夹到范围内
    n: Math.min(getMaxTaskImages(), Math.max(1, Math.floor(params.n) || DEFAULT_PARAMS.n)),
    moderation: isLowModerationAllowed() ? params.moderation : 'auto',
  }
  if (nextParams.output_format === 'png') nextParams.output_compression = DEFAULT_PARAMS.output_compression
  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
