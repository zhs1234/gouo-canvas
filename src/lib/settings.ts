import type { AppSettings } from '../types'
import { isRecord } from './storeInputNormalization'

// 从 localStorage 和备份恢复时清洗旧格式：旧版的多套 API 配置、密钥等字段直接丢弃
export function normalizeSettings(input: unknown): AppSettings {
  const record = isRecord(input) ? input : {}
  const flag = (key: string, fallback: boolean) => typeof record[key] === 'boolean' ? record[key] as boolean : fallback
  return {
    model: typeof record.model === 'string' && record.model.trim() ? record.model : 'gpt-image-2',
    gouoModelSelected: record.gouoModelSelected === true,
    gouoPriceVersion: typeof record.gouoPriceVersion === 'string' ? record.gouoPriceVersion : undefined,
    clearInputAfterSubmit: flag('clearInputAfterSubmit', false),
    persistInputOnRestart: flag('persistInputOnRestart', true),
    alwaysShowRetryButton: flag('alwaysShowRetryButton', false),
    taskCompletionNotification: flag('taskCompletionNotification', false),
    enterSubmit: flag('enterSubmit', false),
    referenceImageEditAction: record.referenceImageEditAction === 'replace-reference' || record.referenceImageEditAction === 'add-mask' ? record.referenceImageEditAction : 'ask',
    // 旧版按入口分别设置 zipDownloadRoutes，开启过任一入口即视为开启
    zipBatchDownload: flag('zipBatchDownload', Array.isArray(record.zipDownloadRoutes) ? record.zipDownloadRoutes.length > 0 : true),
  }
}

export const DEFAULT_SETTINGS = normalizeSettings({})
