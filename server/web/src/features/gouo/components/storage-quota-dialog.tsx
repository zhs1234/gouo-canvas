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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatBytes } from '@/features/channels/lib/ollama-utils'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { updateGouoStorageQuota } from '../api'
import { BYTES_PER_GB, SUCCESS_MESSAGES } from '../constants'
import type { GouoStorageUser } from '../types'

type StorageQuotaDialogProps = {
  user: GouoStorageUser | null
  onOpenChange: (open: boolean) => void
}

export function StorageQuotaDialog(props: StorageQuotaDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [quotaGb, setQuotaGb] = useState('')
  useEffect(() => {
    if (props.user) {
      setQuotaGb(
        String(
          Math.round((props.user.quota_bytes / BYTES_PER_GB) * 1000) / 1000
        )
      )
    }
  }, [props.user])
  const quotaBytes = Math.round(Number(quotaGb) * BYTES_PER_GB)
  const valid =
    Number.isFinite(quotaBytes) &&
    quotaBytes >= (props.user?.used_bytes ?? 0) &&
    quotaBytes <= 1024 * BYTES_PER_GB
  const save = useMutation({
    mutationFn: async () =>
      requireServerSuccess(
        await updateGouoStorageQuota(props.user?.user_id ?? 0, quotaBytes)
      ),
    onSuccess: () => {
      toast.success(t(SUCCESS_MESSAGES.QUOTA_SAVED))
      void queryClient.invalidateQueries({
        queryKey: ['gouo', 'storage-users'],
      })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <Dialog
      open={props.user !== null}
      onOpenChange={props.onOpenChange}
      title={t('Set storage quota')}
      description={
        props.user
          ? `${props.user.username} · ${t('Used {{size}}', { size: formatBytes(props.user.used_bytes) })}`
          : ''
      }
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-2'>
        <Label htmlFor='gouo-quota-gb'>{t('Storage quota (GB)')}</Label>
        <Input
          id='gouo-quota-gb'
          type='number'
          step='0.001'
          min={0}
          value={quotaGb}
          onChange={(event) => setQuotaGb(event.target.value)}
          aria-invalid={!valid}
        />
        <p className='text-muted-foreground text-sm'>
          {t('Cannot be lower than the space the user already uses')}
        </p>
      </div>
    </Dialog>
  )
}
