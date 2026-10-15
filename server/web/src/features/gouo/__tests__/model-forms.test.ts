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

import { getImageModelSchema, imageModelToFormValues } from '../lib/model-forms'
import type { GouoImageModel } from '../types'

const t = ((key: string) => key) as TFunction

const channelOnlyModel: GouoImageModel = {
  model: 'new-image-model',
  enabled: false,
  price_cny: 0,
  reference: false,
  mask: false,
  max_outputs: 0,
  sizes: [],
  qualities: [],
  max_inputs: 0,
  sort: 0,
  name: '',
  description: '',
  updated_at: 0,
  groups: ['default'],
}

describe('image model form', () => {
  test('gives a model that only exists on a channel a valid editable default', () => {
    const values = imageModelToFormValues(channelOnlyModel)

    expect(values.price_cny).toBeGreaterThan(0)
    expect(values.max_outputs).toBe(1)
    expect(getImageModelSchema(t).safeParse(values).success).toBe(true)
  })

  test('requires reference image support for mask editing', () => {
    const values = {
      ...imageModelToFormValues(channelOnlyModel),
      mask: true,
      reference: false,
    }

    const result = getImageModelSchema(t).safeParse(values)

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['mask'])
  })

  test('rejects prices and counts the server would reject', () => {
    const schema = getImageModelSchema(t)
    const base = imageModelToFormValues(channelOnlyModel)

    for (const patch of [
      { price_cny: 0 },
      { price_cny: 10001 },
      { max_outputs: 11 },
      { max_inputs: 17 },
      { name: 'x'.repeat(41) },
    ]) {
      expect(
        schema.safeParse({ ...base, ...patch }).success,
        JSON.stringify(patch)
      ).toBe(false)
    }
  })
})
