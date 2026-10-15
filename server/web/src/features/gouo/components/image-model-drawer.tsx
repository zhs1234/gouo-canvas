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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SideDrawerSection } from '@/components/drawer-layout'
import { Form } from '@/components/ui/form'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { saveGouoImageModel } from '../api'
import {
  GOUO_QUALITIES,
  GOUO_QUALITY_LABELS,
  GOUO_QUERY_KEYS,
  GOUO_SIZE_TIERS,
  SUCCESS_MESSAGES,
} from '../constants'
import {
  getImageModelSchema,
  imageModelToFormValues,
  type ImageModelFormValues,
} from '../lib/model-forms'
import type { GouoImageModel } from '../types'
import {
  DrawerCheckboxGroupField,
  DrawerInputField,
  DrawerSwitchField,
  ModelEditDrawer,
} from './model-drawer-fields'

type ImageModelDrawerProps = {
  row: GouoImageModel | null
  onOpenChange: (open: boolean) => void
}

export function ImageModelDrawer(props: ImageModelDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<ImageModelFormValues>({
    resolver: zodResolver(
      getImageModelSchema(t)
    ) as unknown as Resolver<ImageModelFormValues>,
  })
  const row = props.row
  useEffect(() => {
    if (row) form.reset(imageModelToFormValues(row))
  }, [row, form])
  const save = useMutation({
    mutationFn: async (values: ImageModelFormValues) =>
      requireServerSuccess(
        await saveGouoImageModel({ ...values, model: row?.model ?? '' })
      ),
    onSuccess: () => {
      toast.success(t(SUCCESS_MESSAGES.MODEL_SAVED))
      void queryClient.invalidateQueries({
        queryKey: GOUO_QUERY_KEYS.imageModels,
      })
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })
  const control = form.control

  return (
    <ModelEditDrawer
      open={row !== null}
      onOpenChange={props.onOpenChange}
      title={t('Edit image model')}
      description={row?.model ?? ''}
      formId='gouo-image-model-form'
      isSaving={save.isPending}
    >
      <Form {...form}>
        <form
          id='gouo-image-model-form'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className='flex flex-col gap-6'
        >
          <SideDrawerSection>
            <DrawerSwitchField
              control={control}
              name='enabled'
              label={t('Enable in the client')}
              description={t(
                'Charged per successful request; generation and editing cost the same and group ratios do not apply'
              )}
            />
            <DrawerInputField
              control={control}
              name='price_cny'
              type='number'
              step='0.01'
              label={t('Price per request (CNY)')}
            />
            <DrawerInputField
              control={control}
              name='max_outputs'
              type='number'
              label={t('Max images per request')}
            />
          </SideDrawerSection>
          <SideDrawerSection>
            <DrawerSwitchField
              control={control}
              name='reference'
              label={t('Supports reference images')}
            />
            <DrawerSwitchField
              control={control}
              name='mask'
              label={t('Supports mask editing')}
            />
            <DrawerInputField
              control={control}
              name='max_inputs'
              type='number'
              label={t('Max reference images')}
              description={t('0 means unlimited')}
            />
            <DrawerCheckboxGroupField
              control={control}
              name='sizes'
              label={t('Open resolution tiers')}
              description={t(
                'Leave all unchecked to allow only automatic size'
              )}
              options={GOUO_SIZE_TIERS.map((tier) => ({
                value: tier,
                label: tier,
              }))}
            />
            <DrawerCheckboxGroupField
              control={control}
              name='qualities'
              label={t('Open qualities')}
              description={t(
                'Leave all unchecked for no limit; automatic quality is only offered when high quality is open'
              )}
              options={GOUO_QUALITIES.map((quality) => ({
                value: quality,
                label: t(GOUO_QUALITY_LABELS[quality]),
              }))}
            />
          </SideDrawerSection>
          <SideDrawerSection>
            <DrawerInputField
              control={control}
              name='name'
              label={t('Display name')}
              description={t('Leave empty to show the model ID')}
            />
            <DrawerInputField
              control={control}
              name='description'
              label={t('Description')}
            />
            <DrawerInputField
              control={control}
              name='sort'
              type='number'
              label={t('Sort order')}
              description={t('Smaller numbers come first in the client')}
            />
          </SideDrawerSection>
        </form>
      </Form>
    </ModelEditDrawer>
  )
}
