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
import { describe, expect, test } from 'vitest'

import { BYTES_PER_GB, BYTES_PER_MB } from '../constants'
import {
  formValuesToSettings,
  getGouoSettingsSchema,
  settingsToFormValues,
} from '../lib/settings-form'
import type { GouoSettings } from '../types'

const t = ((key: string) => key) as TFunction

const settings: GouoSettings = {
  redemption_help: '',
  support_contact: '',
  default_image_model: 'gpt-image-2',
  canvas_enabled: true,
  agent_enabled: false,
  agent_default_model: '',
  agent_system_prompt: '',
  max_images_per_task: 4,
  allow_low_moderation: false,
  agent_max_rounds: 8,
  agent_confirm_images: 4,
  cloud_library_enabled: true,
  asset_user_quota_bytes: 2 * BYTES_PER_GB,
  asset_max_file_bytes: 25 * BYTES_PER_MB,
  trash_retention_days: 3,
}

describe('gouo settings form', () => {
  test('converts byte limits to GB and MB for editing and back to bytes for saving', () => {
    const values = settingsToFormValues(settings)

    expect(values.asset_user_quota_gb).toBe(2)
    expect(values.asset_max_file_mb).toBe(25)
    expect(formValuesToSettings(values)).toEqual(settings)
  })

  test('trims text fields before saving', () => {
    const values = {
      ...settingsToFormValues(settings),
      support_contact: '  客服微信  ',
      agent_system_prompt: '\n提示\n',
    }

    const saved = formValuesToSettings(values)

    expect(saved.support_contact).toBe('客服微信')
    expect(saved.agent_system_prompt).toBe('提示')
  })

  test('rejects limits outside the ranges the server accepts', () => {
    const schema = getGouoSettingsSchema(t)
    const base = settingsToFormValues(settings)

    for (const patch of [
      { max_images_per_task: 11 },
      { agent_max_rounds: 0 },
      { trash_retention_days: 31 },
      { asset_max_file_mb: 101 },
      { asset_user_quota_gb: 0 },
      { support_contact: 'x'.repeat(2001) },
    ]) {
      expect(
        schema.safeParse({ ...base, ...patch }).success,
        JSON.stringify(patch)
      ).toBe(false)
    }
    expect(schema.safeParse(base).success).toBe(true)
  })
})
