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

export type GouoCatalogModel = {
  id: string
}

export type GouoCatalog = {
  image_models: GouoCatalogModel[]
  agent_models: GouoCatalogModel[]
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
