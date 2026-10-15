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
import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SideDrawerSection } from '@/components/drawer-layout'
import { Form } from '@/components/ui/form'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { saveGouoAgentModel } from '../api'
import {
  GOUO_MODEL_PRICING_SECTION,
  GOUO_QUERY_KEYS,
  SUCCESS_MESSAGES,
} from '../constants'
import {
  agentModelToFormValues,
  getAgentModelSchema,
  type AgentModelFormValues,
} from '../lib/model-forms'
import type { GouoAgentModel } from '../types'
import {
  DrawerInputField,
  DrawerSwitchField,
  ModelEditDrawer,
} from './model-drawer-fields'

type AgentModelDrawerProps = {
  row: GouoAgentModel | null
  onOpenChange: (open: boolean) => void
}

export function AgentModelDrawer(props: AgentModelDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<AgentModelFormValues>({
    resolver: zodResolver(
      getAgentModelSchema(t)
    ) as unknown as Resolver<AgentModelFormValues>,
  })
  const row = props.row
  useEffect(() => {
    if (row) form.reset(agentModelToFormValues(row))
  }, [row, form])
  const save = useMutation({
    mutationFn: async (values: AgentModelFormValues) =>
      requireServerSuccess(
        await saveGouoAgentModel({ ...values, model: row?.model ?? '' })
      ),
    onSuccess: () => {
      toast.success(t(SUCCESS_MESSAGES.MODEL_SAVED))
      void queryClient.invalidateQueries({
        queryKey: GOUO_QUERY_KEYS.agentModels,
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
      title={t('Edit Agent model')}
      description={row?.model ?? ''}
      formId='gouo-agent-model-form'
      isSaving={save.isPending}
    >
      <Form {...form}>
        <form
          id='gouo-agent-model-form'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className='flex flex-col gap-6'
        >
          <SideDrawerSection>
            <DrawerSwitchField
              control={control}
              name='listed'
              label={t('List in the client Agent catalog')}
            />
            <DrawerSwitchField
              control={control}
              name='vision'
              label={t('Understands images')}
              description={t(
                'Agent sends reference images to the model directly'
              )}
            />
            <DrawerInputField
              control={control}
              name='max_tokens'
              type='number'
              label={t('Max output tokens per reply')}
              description={t(
                '0 means unlimited; client requests are capped to this value'
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Billed by tokens with the New API model price and the user group ratio.'
              )}{' '}
              <Link
                to='/system-settings/billing/$section'
                params={{ section: GOUO_MODEL_PRICING_SECTION }}
                className='text-primary underline-offset-4 hover:underline'
              >
                {t('Edit model pricing')}
              </Link>
            </p>
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
