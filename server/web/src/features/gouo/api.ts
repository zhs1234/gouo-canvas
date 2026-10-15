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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  GouoAgentModel,
  GouoImageCharge,
  GouoImageModel,
  GouoModelList,
  GouoSettings,
  GouoStorageOverview,
  GouoStorageUser,
  GouoUserTask,
  PageData,
} from './types'

const BASE = '/api/gouo/admin'

export async function getGouoSettings(): Promise<ApiResponse<GouoSettings>> {
  const res = await api.get(`${BASE}/settings`)
  return res.data
}

export async function updateGouoSettings(
  data: Partial<GouoSettings>
): Promise<ApiResponse<GouoSettings>> {
  const res = await api.put(`${BASE}/settings`, data)
  return res.data
}

export async function listGouoImageModels(): Promise<
  ApiResponse<GouoModelList<GouoImageModel>>
> {
  const res = await api.get(`${BASE}/models`)
  return res.data
}

export async function saveGouoImageModel(
  data: Omit<GouoImageModel, 'groups' | 'error' | 'updated_at'>
): Promise<ApiResponse> {
  const res = await api.put(`${BASE}/models`, data)
  return res.data
}

export async function listGouoAgentModels(): Promise<
  ApiResponse<GouoModelList<GouoAgentModel>>
> {
  const res = await api.get(`${BASE}/agent-models`)
  return res.data
}

export async function saveGouoAgentModel(
  data: Pick<
    GouoAgentModel,
    | 'model'
    | 'listed'
    | 'vision'
    | 'sort'
    | 'name'
    | 'description'
    | 'max_tokens'
  >
): Promise<ApiResponse> {
  const res = await api.put(`${BASE}/agent-models`, data)
  return res.data
}

export async function getGouoStorage(): Promise<
  ApiResponse<GouoStorageOverview>
> {
  const res = await api.get(`${BASE}/storage`)
  return res.data
}

export async function listGouoStorageUsers(params: {
  p: number
  page_size: number
}): Promise<ApiResponse<PageData<GouoStorageUser>>> {
  const res = await api.get(`${BASE}/storage/users`, { params })
  return res.data
}

export async function listGouoUserTasks(
  userId: number,
  params: { p: number; page_size: number }
): Promise<ApiResponse<PageData<GouoUserTask>>> {
  const res = await api.get(`${BASE}/storage/users/${userId}/tasks`, {
    params,
  })
  return res.data
}

export async function updateGouoStorageQuota(
  userId: number,
  quotaBytes: number
): Promise<ApiResponse> {
  const res = await api.put(`${BASE}/storage/users/${userId}/quota`, {
    quota_bytes: quotaBytes,
  })
  return res.data
}

// 作品图片需要登录凭据，不能直接作为 <img src>；取回后转成本地 URL 显示
export async function fetchGouoUserAsset(
  userId: number,
  assetId: string
): Promise<Blob> {
  const res = await api.get(
    `${BASE}/storage/users/${userId}/assets/${assetId}/content`,
    { responseType: 'blob' }
  )
  return res.data
}

export type GouoChargeQuery = {
  p: number
  page_size: number
  user_id?: number
  request_id?: string
  status?: string
}

export async function listGouoImageCharges(
  params: GouoChargeQuery
): Promise<ApiResponse<PageData<GouoImageCharge>>> {
  const res = await api.get(`${BASE}/image-charges`, { params })
  return res.data
}
