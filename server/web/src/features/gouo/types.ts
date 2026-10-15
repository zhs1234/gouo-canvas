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

export type ApiResponse<T = unknown> = {
  success: boolean
  message?: string
  message_key?: string
  data?: T
}

export type PageData<T> = {
  items: T[] | null
  total: number
  page: number
  page_size: number
}

export type GouoSettings = {
  notice: string
  redemption_help: string
  support_contact: string
  default_image_model: string
  canvas_enabled: boolean
  agent_enabled: boolean
  agent_default_model: string
  agent_system_prompt: string
  max_images_per_task: number
  allow_low_moderation: boolean
  agent_max_rounds: number
  agent_confirm_images: number
  cloud_library_enabled: boolean
  asset_user_quota_bytes: number
  asset_max_file_bytes: number
  trash_retention_days: number
}

export type GouoSizeTier = '1K' | '2K' | '4K'
export type GouoQuality = 'low' | 'medium' | 'high'

export type GouoImageModel = {
  model: string
  enabled: boolean
  price_cny: number
  reference: boolean
  mask: boolean
  max_outputs: number
  sizes: GouoSizeTier[]
  qualities: GouoQuality[]
  max_inputs: number
  sort: number
  name: string
  description: string
  updated_at: number
  // 有启用中的渠道支持此模型的分组
  groups: string[]
  // 已启用但配置无法使用时的原因（message_key）
  error?: string
}

export type GouoAgentModel = {
  model: string
  listed: boolean
  vision: boolean
  sort: number
  name: string
  description: string
  max_tokens: number
  updated_at: number
  input_price_cny: number
  output_price_cny: number
  groups: string[]
  // 客户端看不到它的第一个原因（message_key），空表示可见
  reason: string
}

export type GouoModelList<T> = {
  default_model: string
  models: T[]
}

export type GouoStorageOverview = {
  summary: {
    total_bytes: number
    asset_count: number
    task_count: number
    hidden_count: number
    user_count: number
  }
  default_quota_bytes: number
  asset_dir: string
}

export type GouoStorageUser = {
  user_id: number
  username: string
  used_bytes: number
  quota_bytes: number
  asset_count: number
}

export type GouoTaskAsset = {
  asset_id: string
  role: string
  position: number
  asset: {
    id: string
    mime_type: string
    width: number
    height: number
    content_url: string
  }
}

export type GouoUserTask = {
  id: string
  status: string
  prompt: string
  model: string
  client_created_at: number
  hidden_at: number
  assets: GouoTaskAsset[]
}

export type GouoChargeStatus =
  | 'reserved'
  | 'dispatched'
  | 'settled'
  | 'refunded'

export type GouoImageCharge = {
  id: string
  user_id: number
  username: string
  channel_id: number
  model_name: string
  price_cny: number
  quota: number
  status: GouoChargeStatus
  attempts: number
  created_at: number
  updated_at: number
  note: string
}
