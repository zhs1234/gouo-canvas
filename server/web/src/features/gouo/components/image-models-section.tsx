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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BadgeListCell,
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { requireServerSuccess } from '@/lib/server-error-message'

import { listGouoImageModels } from '../api'
import { GOUO_QUALITY_LABELS, GOUO_QUERY_KEYS } from '../constants'
import type { GouoImageModel } from '../types'
import { ImageModelDrawer } from './image-model-drawer'

const route = getRouteApi('/_authenticated/gouo/$section')

function useImageModelColumns(
  onEdit: (row: GouoImageModel) => void
): ColumnDef<GouoImageModel>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'model',
      header: t('Model'),
      meta: { mobileTitle: true },
      size: 260,
      cell: ({ row }) => (
        <div className='flex min-w-0 flex-col'>
          <span className='truncate font-medium'>
            {row.original.name || row.original.model}
          </span>
          {row.original.name && (
            <span className='text-muted-foreground truncate text-xs'>
              {row.original.model}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'status',
      accessorFn: (row) => (row.enabled ? 'enabled' : 'disabled'),
      header: t('Status'),
      meta: { mobileBadge: true },
      size: 130,
      filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
      cell: ({ row }) => {
        if (row.original.enabled && row.original.error) {
          return (
            <StatusBadge
              label={t('Unavailable')}
              variant='warning'
              copyable={false}
              title={t(row.original.error)}
            />
          )
        }
        return row.original.enabled ? (
          <StatusBadge
            label={t('Enabled')}
            variant='success'
            copyable={false}
          />
        ) : (
          <StatusBadge
            label={t('Not enabled')}
            variant='neutral'
            copyable={false}
          />
        )
      },
    },
    {
      accessorKey: 'price_cny',
      header: t('Price per request'),
      size: 130,
      cell: ({ row }) =>
        row.original.price_cny > 0 ? `¥${row.original.price_cny}` : '—',
    },
    {
      id: 'capabilities',
      header: t('Capabilities'),
      size: 200,
      cell: ({ row }) => (
        <BadgeListCell
          items={[
            t('Up to {{count}} per request', {
              count: row.original.max_outputs,
            }),
            ...(row.original.reference ? [t('Reference images')] : []),
            ...(row.original.mask ? [t('Mask')] : []),
          ].map((label) => (
            <Badge key={label} variant='outline'>
              {label}
            </Badge>
          ))}
        />
      ),
    },
    {
      id: 'limits',
      header: t('Resolution and quality'),
      size: 220,
      cell: ({ row }) => {
        const sizes = row.original.sizes.length
          ? row.original.sizes.join(' / ')
          : t('Auto size only')
        const qualities = row.original.qualities.length
          ? row.original.qualities
              .map((quality) => t(GOUO_QUALITY_LABELS[quality]))
              .join(' / ')
          : t('All qualities')
        return (
          <span className='text-sm'>
            {sizes} · {qualities}
          </span>
        )
      },
    },
    {
      id: 'groups',
      header: t('Channel groups'),
      size: 200,
      cell: ({ row }) =>
        row.original.groups.length ? (
          <BadgeListCell
            items={row.original.groups.map((group) => (
              <Badge key={group} variant='secondary'>
                {group}
              </Badge>
            ))}
          />
        ) : (
          <span className='text-muted-foreground text-sm'>
            {t('No enabled channel')}
          </span>
        ),
    },
    {
      id: 'actions',
      header: '',
      size: 90,
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          variant='outline'
          size='sm'
          onClick={() => onEdit(row.original)}
        >
          {t('Edit')}
        </Button>
      ),
    },
  ]
}

export function ImageModelsSection() {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<GouoImageModel | null>(null)
  const columns = useImageModelColumns(setEditing)
  const query = useQuery({
    queryKey: GOUO_QUERY_KEYS.imageModels,
    queryFn: async () => requireServerSuccess(await listGouoImageModels()),
  })
  const state = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      pageKey: 'iPage',
      pageSizeKey: 'iPageSize',
      defaultPageSize: 20,
    },
    globalFilter: { enabled: true, key: 'iFilter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'iStatus', type: 'array' },
    ],
  })
  const { table } = useDataTable({
    data: query.data?.data?.models ?? [],
    columns,
    getRowId: (row) => row.model,
    globalFilter: state.globalFilter,
    onGlobalFilterChange: state.onGlobalFilterChange,
    columnFilters: state.columnFilters,
    onColumnFiltersChange: state.onColumnFiltersChange,
    pagination: state.pagination,
    onPaginationChange: state.onPaginationChange,
    globalFilterFn: (row, _columnId, value) => {
      const keyword = String(value).toLowerCase()
      return (
        row.original.model.toLowerCase().includes(keyword) ||
        row.original.name.toLowerCase().includes(keyword)
      )
    },
  })

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        emptyTitle={t('No models found')}
        emptyDescription={t(
          'Configure a channel that supports image models first, then enable it here'
        )}
        skeletonKeyPrefix='gouo-image-models'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Filter by model ID or name...'),
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: [
                { value: 'enabled', label: t('Enabled') },
                { value: 'disabled', label: t('Not enabled') },
              ],
              singleSelect: true,
            },
          ],
        }}
        getRowClassName={(row, { isMobile }) => {
          if (row.original.enabled) return undefined
          return isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
        }}
      />
      <ImageModelDrawer
        row={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  )
}
