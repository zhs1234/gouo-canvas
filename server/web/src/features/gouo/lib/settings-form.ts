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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { BYTES_PER_GB, BYTES_PER_MB } from '../constants'
import type { GouoSettings } from '../types'

function integerBetween(t: TFunction, min: number, max: number) {
  const message = t('Enter an integer from {{min}} to {{max}}', { min, max })
  return z.coerce.number().int(message).min(min, message).max(max, message)
}

function textAtMost(t: TFunction, max: number) {
  return z.string().max(max, t('Must be at most {{max}} characters', { max }))
}

// 空间和上传上限在界面上按 GB / MB 填写，服务端按字节保存，范围与服务端校验一致
export function getGouoSettingsSchema(t: TFunction) {
  const storageMessage = t('Enter a value from {{min}} to {{max}}', {
    min: 0.001,
    max: 1024,
  })
  return z.object({
    notice: textAtMost(t, 200),
    redemption_help: textAtMost(t, 2000),
    support_contact: textAtMost(t, 2000),
    default_image_model: z.string(),
    agent_default_model: z.string(),
    canvas_enabled: z.boolean(),
    agent_enabled: z.boolean(),
    cloud_library_enabled: z.boolean(),
    allow_low_moderation: z.boolean(),
    agent_system_prompt: textAtMost(t, 4000),
    max_images_per_task: integerBetween(t, 1, 10),
    agent_max_rounds: integerBetween(t, 1, 20),
    agent_confirm_images: integerBetween(t, 1, 10),
    trash_retention_days: integerBetween(t, 1, 30),
    asset_user_quota_gb: z.coerce
      .number()
      .min(0.001, storageMessage)
      .max(1024, storageMessage),
    asset_max_file_mb: integerBetween(t, 1, 100),
  })
}

export type GouoSettingsFormValues = z.infer<
  ReturnType<typeof getGouoSettingsSchema>
>

export function settingsToFormValues(
  settings: GouoSettings
): GouoSettingsFormValues {
  return {
    notice: settings.notice,
    redemption_help: settings.redemption_help,
    support_contact: settings.support_contact,
    default_image_model: settings.default_image_model,
    agent_default_model: settings.agent_default_model,
    canvas_enabled: settings.canvas_enabled,
    agent_enabled: settings.agent_enabled,
    cloud_library_enabled: settings.cloud_library_enabled,
    allow_low_moderation: settings.allow_low_moderation,
    agent_system_prompt: settings.agent_system_prompt,
    max_images_per_task: settings.max_images_per_task,
    agent_max_rounds: settings.agent_max_rounds,
    agent_confirm_images: settings.agent_confirm_images,
    trash_retention_days: settings.trash_retention_days,
    asset_user_quota_gb:
      Math.round((settings.asset_user_quota_bytes / BYTES_PER_GB) * 1000) /
      1000,
    asset_max_file_mb: Math.round(settings.asset_max_file_bytes / BYTES_PER_MB),
  }
}

export function formValuesToSettings(
  values: GouoSettingsFormValues
): GouoSettings {
  return {
    notice: values.notice.trim(),
    redemption_help: values.redemption_help.trim(),
    support_contact: values.support_contact.trim(),
    default_image_model: values.default_image_model,
    agent_default_model: values.agent_default_model,
    canvas_enabled: values.canvas_enabled,
    agent_enabled: values.agent_enabled,
    cloud_library_enabled: values.cloud_library_enabled,
    allow_low_moderation: values.allow_low_moderation,
    agent_system_prompt: values.agent_system_prompt.trim(),
    max_images_per_task: values.max_images_per_task,
    agent_max_rounds: values.agent_max_rounds,
    agent_confirm_images: values.agent_confirm_images,
    trash_retention_days: values.trash_retention_days,
    asset_user_quota_bytes: Math.round(
      values.asset_user_quota_gb * BYTES_PER_GB
    ),
    asset_max_file_bytes: values.asset_max_file_mb * BYTES_PER_MB,
  }
}
