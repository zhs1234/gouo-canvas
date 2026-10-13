import { useSyncExternalStore } from 'react'
import { getCachedImageModels, subscribeImageModels } from '../lib/gouoBackend'

// 后台下发的图片模型目录（含尺寸、画质、参考图限制），模型列表刷新后同步更新
export function useImageModels() {
  return useSyncExternalStore(subscribeImageModels, getCachedImageModels)
}
