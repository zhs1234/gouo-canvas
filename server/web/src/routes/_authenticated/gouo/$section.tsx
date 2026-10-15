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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { GouoAdmin } from '@/features/gouo'
import {
  GOUO_DEFAULT_SECTION,
  GOUO_SECTION_IDS,
} from '@/features/gouo/section-registry'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

// 各分区的表格分页和筛选分别用不同的参数名，切换分区时互不影响
const gouoSearchSchema = z.object({
  iPage: z.number().optional().catch(1),
  iPageSize: z.number().optional().catch(20),
  iFilter: z.string().optional().catch(''),
  iStatus: z.array(z.string()).optional().catch([]),
  aPage: z.number().optional().catch(1),
  aPageSize: z.number().optional().catch(20),
  aFilter: z.string().optional().catch(''),
  aStatus: z.array(z.string()).optional().catch([]),
  sPage: z.number().optional().catch(1),
  sPageSize: z.number().optional().catch(20),
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(20),
  filter: z.string().optional().catch(''),
  status: z.array(z.string()).optional().catch([]),
})

export const Route = createFileRoute('/_authenticated/gouo/$section')({
  beforeLoad: ({ params }) => {
    const { auth } = useAuthStore.getState()

    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({
        to: '/403',
      })
    }

    const validSections = GOUO_SECTION_IDS as unknown as string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/gouo/$section',
        params: { section: GOUO_DEFAULT_SECTION },
      })
    }
  },
  validateSearch: gouoSearchSchema,
  component: GouoAdmin,
})
