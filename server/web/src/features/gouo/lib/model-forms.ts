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

import { GOUO_QUALITIES, GOUO_SIZE_TIERS } from '../constants'
import type { GouoAgentModel, GouoImageModel } from '../types'

function displayTextFields(t: TFunction) {
  return {
    name: z
      .string()
      .max(40, t('Must be at most {{max}} characters', { max: 40 })),
    description: z
      .string()
      .max(100, t('Must be at most {{max}} characters', { max: 100 })),
    sort: z.coerce.number().int(t('Enter an integer')),
  }
}

// 与服务端校验一致：单价 (0, 10000] 元、单次 1–10 张、遮罩需要参考图、参考图 0–16 张
export function getImageModelSchema(t: TFunction) {
  return z
    .object({
      enabled: z.boolean(),
      price_cny: z.coerce
        .number()
        .gt(0, t('Price must be greater than 0'))
        .max(10000, t('Price must be at most {{max}} CNY', { max: 10000 })),
      reference: z.boolean(),
      mask: z.boolean(),
      max_outputs: z.coerce
        .number()
        .int()
        .min(
          1,
          t('Enter an integer from {{min}} to {{max}}', { min: 1, max: 10 })
        )
        .max(
          10,
          t('Enter an integer from {{min}} to {{max}}', { min: 1, max: 10 })
        ),
      sizes: z.array(z.enum(GOUO_SIZE_TIERS)),
      qualities: z.array(z.enum(GOUO_QUALITIES)),
      max_inputs: z.coerce
        .number()
        .int()
        .min(
          0,
          t('Enter an integer from {{min}} to {{max}}', { min: 0, max: 16 })
        )
        .max(
          16,
          t('Enter an integer from {{min}} to {{max}}', { min: 0, max: 16 })
        ),
      ...displayTextFields(t),
    })
    .refine((values) => !values.mask || values.reference, {
      path: ['mask'],
      message: t('Mask editing requires reference image support'),
    })
}

export type ImageModelFormValues = z.infer<
  ReturnType<typeof getImageModelSchema>
>

export function imageModelToFormValues(
  row: GouoImageModel
): ImageModelFormValues {
  return {
    enabled: row.enabled,
    // 渠道上新出现、还没配置过的模型没有价格，表单给一个可直接修改的默认值
    price_cny: row.price_cny > 0 ? row.price_cny : 0.1,
    reference: row.reference,
    mask: row.mask,
    max_outputs: Math.max(1, row.max_outputs),
    sizes: row.sizes,
    qualities: row.qualities,
    max_inputs: row.max_inputs,
    name: row.name,
    description: row.description,
    sort: row.sort,
  }
}

export function getAgentModelSchema(t: TFunction) {
  return z.object({
    listed: z.boolean(),
    vision: z.boolean(),
    max_tokens: z.coerce
      .number()
      .int()
      .min(
        0,
        t('Enter an integer from {{min}} to {{max}}', { min: 0, max: 1000000 })
      )
      .max(
        1000000,
        t('Enter an integer from {{min}} to {{max}}', { min: 0, max: 1000000 })
      ),
    ...displayTextFields(t),
  })
}

export type AgentModelFormValues = z.infer<
  ReturnType<typeof getAgentModelSchema>
>

export function agentModelToFormValues(
  row: GouoAgentModel
): AgentModelFormValues {
  return {
    listed: row.listed,
    vision: row.vision,
    max_tokens: row.max_tokens,
    name: row.name,
    description: row.description,
    sort: row.sort,
  }
}
