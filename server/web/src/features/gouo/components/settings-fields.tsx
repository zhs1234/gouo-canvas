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
import type { Control, FieldPath } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'

import type { GouoSettingsFormValues } from '../lib/settings-form'

type FieldProps = {
  control: Control<GouoSettingsFormValues>
  name: FieldPath<GouoSettingsFormValues>
  label: string
  description?: string
}

export function SettingsTextField(
  props: FieldProps & {
    multiline?: boolean
    type?: 'number' | 'text'
    step?: string
  }
) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            {props.multiline ? (
              <Textarea
                rows={4}
                value={String(field.value ?? '')}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
              />
            ) : (
              <Input
                type={props.type ?? 'text'}
                step={props.step}
                value={String(field.value ?? '')}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
              />
            )}
          </FormControl>
          {props.description && (
            <FormDescription>{props.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function SettingsSwitchField(props: FieldProps) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <SettingsSwitchItem>
          <SettingsSwitchContent>
            <FormLabel>{props.label}</FormLabel>
            {props.description && (
              <FormDescription>{props.description}</FormDescription>
            )}
          </SettingsSwitchContent>
          <FormControl>
            <Switch
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </SettingsSwitchItem>
      )}
    />
  )
}

// 选择器不能用空字符串作选项值，“未设置”用占位值表示
const NONE_VALUE = '__none__'

export function SettingsModelSelect(
  props: FieldProps & { options: Array<{ value: string; label: string }> }
) {
  const { t } = useTranslation()
  const items = [
    { value: NONE_VALUE, label: t('Not set (use the first in the catalog)') },
    ...props.options,
  ]
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <Select
            items={items}
            value={String(field.value) || NONE_VALUE}
            onValueChange={(value) =>
              value !== null &&
              field.onChange(value === NONE_VALUE ? '' : value)
            }
          >
            <FormControl>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {props.description && (
            <FormDescription>{props.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
