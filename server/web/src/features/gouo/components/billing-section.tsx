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
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { formatQuota, formatTimestamp } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { listGouoImageCharges, type GouoChargeQuery } from '../api'
import { GOUO_CHARGE_STATUSES, GOUO_QUERY_KEYS } from '../constants'
import { buildChargeQuery } from '../lib/charge-query'
import type { GouoChargeStatus, GouoImageCharge } from '../types'

const route = getRouteApi('/_authenticated/gouo/$section')

function useChargeColumns(): ColumnDef<GouoImageCharge>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'created_at',
      header: t('Time'),
      size: 170,
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {formatTimestamp(row.original.created_at)}
        </span>
      ),
    },
    {
      id: 'user',
      header: t('User'),
      meta: { mobileTitle: true },
      size: 170,
      cell: ({ row }) => (
        <div className='flex flex-col'>
          <span className='font-medium'>
            {row.original.username || t('Deleted user')}
          </span>
          <span className='text-muted-foreground text-xs'>
            ID {row.original.user_id}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'model_name',
      header: t('Model'),
      size: 180,
    },
    {
      id: 'price',
      header: t('Price'),
      size: 150,
      cell: ({ row }) => (
        <div className='flex flex-col text-sm'>
          <span>¥{row.original.price_cny}</span>
          <span className='text-muted-foreground text-xs'>
            {formatQuota(row.original.quota)}
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      size: 130,
      cell: ({ row }) => {
        const config = GOUO_CHARGE_STATUSES[row.original.status]
        return config ? (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            copyable={false}
          />
        ) : (
          row.original.status
        )
      },
    },
    {
      id: 'channel',
      header: t('Channel / attempts'),
      size: 140,
      cell: ({ row }) => (
        <span className='text-sm tabular-nums'>
          {row.original.channel_id || '—'} / {row.original.attempts}
        </span>
      ),
    },
    {
      accessorKey: 'note',
      header: t('Note'),
      size: 220,
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm'>
          {row.original.note || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'id',
      header: t('Request ID'),
      size: 160,
      cell: ({ row }) => (
        <span className='font-mono text-xs' title={row.original.id}>
          {row.original.id.slice(0, 12)}…
        </span>
      ),
    },
  ]
}

export function BillingSection() {
  const { t } = useTranslation()
  const columns = useChargeColumns()
  const state = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })
  const status =
    (
      state.columnFilters.find((filter) => filter.id === 'status')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  const params: GouoChargeQuery = buildChargeQuery({
    page: state.pagination.pageIndex + 1,
    pageSize: state.pagination.pageSize,
    keyword: state.globalFilter ?? '',
    status,
  })
  const query = useQuery({
    queryKey: GOUO_QUERY_KEYS.charges(params),
    queryFn: async () =>
      requireServerSuccess(await listGouoImageCharges(params)),
    placeholderData: (previous) => previous,
  })
  const { table } = useDataTable({
    data: query.data?.data?.items ?? [],
    columns,
    getRowId: (row) => row.id,
    globalFilter: state.globalFilter,
    onGlobalFilterChange: state.onGlobalFilterChange,
    columnFilters: state.columnFilters,
    onColumnFiltersChange: state.onColumnFiltersChange,
    pagination: state.pagination,
    onPaginationChange: state.onPaginationChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: query.data?.data?.total ?? 0,
    ensurePageInRange: state.ensurePageInRange,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      emptyTitle={t('No image requests found')}
      emptyDescription={t(
        'Unsettled requests are refunded automatically about 20 minutes after they are interrupted'
      )}
      skeletonKeyPrefix='gouo-charges'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t(
          'User ID, or user ID and request ID separated by a space'
        ),
        searchDebounceMs: 500,
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: (
              Object.keys(GOUO_CHARGE_STATUSES) as GouoChargeStatus[]
            ).map((value) => ({
              value,
              label: t(GOUO_CHARGE_STATUSES[value].labelKey),
            })),
            singleSelect: true,
          },
        ],
      }}
    />
  )
}
