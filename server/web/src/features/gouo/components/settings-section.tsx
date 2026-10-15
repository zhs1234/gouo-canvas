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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Form } from '@/components/ui/form'
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  getGouoSettings,
  listGouoModels,
  updateGouoSettings,
} from '../api'
import { GOUO_QUERY_KEYS, SUCCESS_MESSAGES } from '../constants'
import {
  formValuesToSettings,
  getGouoSettingsSchema,
  settingsToFormValues,
  type GouoSettingsFormValues,
} from '../lib/settings-form'
import type { GouoSettings } from '../types'
import {
  SettingsModelSelect,
  SettingsSwitchField,
  SettingsTextField,
} from './settings-fields'

type ModelOption = { value: string; label: string }

function GouoSettingsForm(props: {
  settings: GouoSettings
  imageModels: ModelOption[]
  agentModels: ModelOption[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<GouoSettingsFormValues>({
    resolver: zodResolver(
      getGouoSettingsSchema(t)
    ) as unknown as Resolver<GouoSettingsFormValues>,
    defaultValues: settingsToFormValues(props.settings),
  })
  const save = useMutation({
    mutationFn: async (values: GouoSettingsFormValues) =>
      requireServerSuccess(
        await updateGouoSettings(formValuesToSettings(values))
      ),
    onSuccess: (result, values) => {
      toast.success(t(SUCCESS_MESSAGES.SETTINGS_SAVED))
      form.reset(values)
      queryClient.setQueryData(GOUO_QUERY_KEYS.settings, result)
    },
    onError: (error) => handleServerError(error),
  })
  const control = form.control
  const onSave = form.handleSubmit((values) => save.mutate(values))

  return (
    <Form {...form}>
      <SettingsForm onSubmit={onSave} autoComplete='off'>
        <SettingsPageFormActions
          onSave={onSave}
          isSaving={save.isPending}
          isSaveDisabled={!form.formState.isDirty}
          saveLabel='Save Gouo settings'
        />
        <SettingsSection title={t('Client content')}>
          <SettingsTextField
            control={control}
            name='support_contact'
            label={t('Support contact')}
            multiline
          />
          <SettingsTextField
            control={control}
            name='redemption_help'
            label={t('How to get redemption codes')}
            multiline
          />
        </SettingsSection>
        <SettingsSection title={t('Features and generation')}>
          <SettingsModelSelect
            control={control}
            name='default_image_model'
            label={t('Default image model')}
            options={props.imageModels}
            description={t(
              'Image models come from Models; add the edit tag for reference images and mask for mask edits'
            )}
          />
          <SettingsSwitchField
            control={control}
            name='canvas_enabled'
            label={t('Open canvas')}
            description={t(
              'When off, the client hides the canvas; saved canvases are kept'
            )}
          />
          <SettingsSwitchField
            control={control}
            name='allow_low_moderation'
            label={t('Allow relaxed moderation')}
            description={t(
              'When on, users may set upstream moderation to low; otherwise the server rejects it'
            )}
          />
          <SettingsTextField
            control={control}
            name='max_images_per_task'
            type='number'
            label={t('Max images per task')}
          />
        </SettingsSection>
        <SettingsSection title={t('Agent')}>
          <SettingsSwitchField
            control={control}
            name='agent_enabled'
            label={t('Open Agent')}
            description={t(
              'When off, the client hides Agent and the Agent model catalog is empty; saved conversations are kept'
            )}
          />
          <SettingsModelSelect
            control={control}
            name='agent_default_model'
            label={t('Default Agent model')}
            options={props.agentModels}
            description={t(
              'Agent models are priced text models tagged tools in Models; add vision to let them read images'
            )}
          />
          <SettingsTextField
            control={control}
            name='agent_system_prompt'
            label={t('Agent additional prompt')}
            multiline
          />
          <SettingsTextField
            control={control}
            name='agent_max_rounds'
            type='number'
            label={t('Max tool rounds per message')}
          />
          <SettingsTextField
            control={control}
            name='agent_confirm_images'
            type='number'
            label={t('Ask for confirmation above this many images')}
          />
        </SettingsSection>
        <SettingsSection title={t('Cloud library')}>
          <SettingsSwitchField
            control={control}
            name='cloud_library_enabled'
            label={t('Open cloud library')}
            description={t(
              'When off, works, canvases and conversations stay in the browser only; saved cloud content is kept'
            )}
          />
          <SettingsTextField
            control={control}
            name='asset_user_quota_gb'
            type='number'
            step='0.001'
            label={t('Default storage per user (GB)')}
          />
          <SettingsTextField
            control={control}
            name='asset_max_file_mb'
            type='number'
            label={t('Upload size limit (MB)')}
          />
          <SettingsTextField
            control={control}
            name='trash_retention_days'
            type='number'
            label={t('Trash retention (days)')}
          />
        </SettingsSection>
      </SettingsForm>
    </Form>
  )
}

export function GouoSettingsSection() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: GOUO_QUERY_KEYS.settings,
    queryFn: async () => requireServerSuccess(await getGouoSettings()),
  })
  const models = useQuery({
    queryKey: GOUO_QUERY_KEYS.models,
    queryFn: async () => requireServerSuccess(await listGouoModels()),
  })
  // 默认模型只能从会出现在客户端的原生模型里选
  const imageOptions = useMemo(
    () =>
      (models.data?.data?.image_models ?? []).map((row) => ({
        value: row.id,
        label: row.id,
      })),
    [models.data]
  )
  const agentOptions = useMemo(
    () =>
      (models.data?.data?.agent_models ?? []).map((row) => ({
        value: row.id,
        label: row.id,
      })),
    [models.data]
  )

  if (settings.isError || models.isError) {
    return (
      <ErrorState
        title={t('Failed to load')}
        onRetry={() => {
          void settings.refetch()
          void models.refetch()
        }}
      />
    )
  }
  if (!settings.data?.data || !models.data) {
    return <LoadingState message={t('Loading settings...')} />
  }
  return (
    <GouoSettingsForm
      settings={settings.data.data}
      imageModels={imageOptions}
      agentModels={agentOptions}
    />
  )
}
