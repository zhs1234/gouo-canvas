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
import { describe, expect, test } from 'vitest'

import { buildChargeQuery } from '../lib/charge-query'

const page = { page: 2, pageSize: 20, status: '' }

describe('image billing search', () => {
  test('sends only pagination when the search box is empty', () => {
    expect(buildChargeQuery({ ...page, keyword: '  ' })).toEqual({
      p: 2,
      page_size: 20,
    })
  })

  test('treats a number as a user ID', () => {
    expect(buildChargeQuery({ ...page, keyword: '42' })).toEqual({
      p: 2,
      page_size: 20,
      user_id: 42,
    })
  })

  test('treats a user ID followed by text as that user client request ID', () => {
    expect(
      buildChargeQuery({ ...page, keyword: '42  req-1:0', status: 'refunded' })
    ).toEqual({
      p: 2,
      page_size: 20,
      user_id: 42,
      request_id: 'req-1:0',
      status: 'refunded',
    })
  })

  test('treats other text as a ledger ID', () => {
    expect(buildChargeQuery({ ...page, keyword: 'abc123' })).toEqual({
      p: 2,
      page_size: 20,
      request_id: 'abc123',
    })
  })
})
