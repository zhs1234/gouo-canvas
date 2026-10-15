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

import { GOUO_DEFAULT_SECTION } from '@/features/gouo/section-registry'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/gouo/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({
        to: '/403',
      })
    }

    throw redirect({
      to: '/gouo/$section',
      params: { section: GOUO_DEFAULT_SECTION },
    })
  },
})
