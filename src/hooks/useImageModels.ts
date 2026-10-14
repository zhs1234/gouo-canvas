import { useEffect, useSyncExternalStore } from 'react'
import { getCachedImageModels, getImageModels, subscribeImageModels } from '../lib/gouoBackend'

// 多张作品卡片同时挂载时共用一次目录请求
let loading: Promise<unknown> | undefined

// 后台下发的图片模型目录（含尺寸、画质、参考图限制），模型列表刷新后同步更新
export function useImageModels() {
  useEffect(() => {
    if (getCachedImageModels().length) return
    loading ??= getImageModels().catch((err) => {
      loading = undefined
      console.warn('读取图片模型目录失败', err)
    })
  }, [])
  return useSyncExternalStore(subscribeImageModels, getCachedImageModels)
}
