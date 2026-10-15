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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SignOutDialog } from '@/components/sign-out-dialog'
import { Button } from '@/components/ui/button'

// 光构的用户在光构客户端里使用；这个后台面板只给管理员
export function GouoAdminOnly() {
  const { t } = useTranslation()
  const [signOutOpen, setSignOutOpen] = useState(false)
  return (
    <div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2 px-4'>
        <span className='text-2xl font-semibold'>
          {t('This console is for administrators')}
        </span>
        <p className='text-muted-foreground text-center'>
          {t('Please use the Gouo client to create and manage your works.')}
        </p>
        <div className='mt-6'>
          <Button variant='outline' onClick={() => setSignOutOpen(true)}>
            {t('Sign out')}
          </Button>
        </div>
      </div>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </div>
  )
}
