/*
Copyright (C) 2026 Gouo Canvas contributors

This file is part of Gouo Canvas, a modified version of New API.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import type { StatusBadgeProps } from '@/components/status-badge'

import type { GouoChargeStatus, GouoQuality, GouoSizeTier } from './types'

export const GOUO_SIZE_TIERS = [
  '1K',
  '2K',
  '4K',
] as const satisfies readonly GouoSizeTier[]
export const GOUO_QUALITIES = [
  'low',
  'medium',
  'high',
] as const satisfies readonly GouoQuality[]

// labelKey 是 i18n 键，组件里用 t(labelKey) 显示
export const GOUO_QUALITY_LABELS: Record<GouoQuality, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const GOUO_CHARGE_STATUSES: Record<
  GouoChargeStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  reserved: { labelKey: 'Reserved', variant: 'warning' },
  dispatched: { labelKey: 'Sent upstream', variant: 'info' },
  settled: { labelKey: 'Settled', variant: 'success' },
  refunded: { labelKey: 'Refunded', variant: 'neutral' },
}

// Agent 价格在 New API 的「系统设置 → 计费 → 模型定价」里修改
export const GOUO_MODEL_PRICING_SECTION = 'model-pricing'

export const GOUO_QUERY_KEYS = {
  settings: ['gouo', 'settings'] as const,
  imageModels: ['gouo', 'image-models'] as const,
  agentModels: ['gouo', 'agent-models'] as const,
  storage: ['gouo', 'storage'] as const,
  storageUsers: (page: number, pageSize: number) =>
    ['gouo', 'storage-users', page, pageSize] as const,
  userTasks: (userId: number, page: number) =>
    ['gouo', 'user-tasks', userId, page] as const,
  charges: (params: Record<string, unknown>) =>
    ['gouo', 'charges', params] as const,
}

export const SUCCESS_MESSAGES = {
  SETTINGS_SAVED: 'Gouo settings saved',
  MODEL_SAVED: 'Model saved',
  QUOTA_SAVED: 'Storage quota updated',
} as const

export const ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load',
  SAVE_FAILED: 'Failed to save',
} as const

export const BYTES_PER_MB = 1024 * 1024
export const BYTES_PER_GB = 1024 * BYTES_PER_MB
