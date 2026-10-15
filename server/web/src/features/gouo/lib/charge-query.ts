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
import type { GouoChargeQuery } from '../api'

/**
 * 把账本搜索框的内容转成查询参数：
 * - 纯数字：按用户 ID 查
 * - 「用户 ID 空格 请求号」：按该用户的客户端请求号查（服务端按用户换算成账本 ID）
 * - 其他：当作账本 ID 原样查
 */
export function buildChargeQuery(input: {
  page: number
  pageSize: number
  keyword: string
  status: string
}): GouoChargeQuery {
  const query: GouoChargeQuery = { p: input.page, page_size: input.pageSize }
  if (input.status) query.status = input.status
  const parts = input.keyword.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return query
  const userId = Number(parts[0])
  if (Number.isInteger(userId) && userId > 0) {
    query.user_id = userId
    if (parts[1]) query.request_id = parts[1]
    return query
  }
  query.request_id = parts[0]
  return query
}
