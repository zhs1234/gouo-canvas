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

import type { GouoChargeStatus } from './types'

export const GOUO_CHARGE_STATUSES: Record<
  GouoChargeStatus,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  reserved: { labelKey: 'Reserved', variant: 'warning' },
  dispatched: { labelKey: 'Sent upstream', variant: 'info' },
  settled: { labelKey: 'Settled', variant: 'success' },
  refunded: { labelKey: 'Refunded', variant: 'neutral' },
}

export const GOUO_QUERY_KEYS = {
  settings: ['gouo', 'settings'] as const,
  models: ['gouo', 'models'] as const,
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
