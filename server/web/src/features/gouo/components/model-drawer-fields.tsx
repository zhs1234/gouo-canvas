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
import type { ReactNode } from 'react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

type ModelEditDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  formId: string
  isSaving: boolean
  children: ReactNode
}

export function ModelEditDrawer(props: ModelEditDrawerProps) {
  const { t } = useTranslation()
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[560px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription className='font-mono'>
            {props.description}
          </SheetDescription>
        </SheetHeader>
        <div className={sideDrawerFormClassName()}>{props.children}</div>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button form={props.formId} type='submit' disabled={props.isSaving}>
            {props.isSaving ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

type FieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  label: string
  description?: string
}

export function DrawerSwitchField<T extends FieldValues>(props: FieldProps<T>) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem className={sideDrawerSwitchItemClassName()}>
          <div className='flex flex-col gap-1'>
            <FormLabel>{props.label}</FormLabel>
            {props.description && (
              <FormDescription>{props.description}</FormDescription>
            )}
            <FormMessage />
          </div>
          <FormControl>
            <Switch
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </FormItem>
      )}
    />
  )
}

export function DrawerInputField<T extends FieldValues>(
  props: FieldProps<T> & { type?: 'number' | 'text'; step?: string }
) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            <Input
              type={props.type ?? 'text'}
              step={props.step}
              name={field.name}
              value={String(field.value ?? '')}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
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

export function DrawerCheckboxGroupField<T extends FieldValues>(
  props: FieldProps<T> & { options: Array<{ value: string; label: string }> }
) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => {
        const selected = (field.value ?? []) as string[]
        return (
          <FormItem>
            <FormLabel>{props.label}</FormLabel>
            <div className='flex flex-wrap gap-4'>
              {props.options.map((option) => (
                <label
                  key={option.value}
                  className='flex items-center gap-2 text-sm'
                >
                  <Checkbox
                    checked={selected.includes(option.value)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? props.options
                              .map((item) => item.value)
                              .filter(
                                (value) =>
                                  value === option.value ||
                                  selected.includes(value)
                              )
                          : selected.filter((value) => value !== option.value)
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {props.description && (
              <FormDescription>{props.description}</FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
