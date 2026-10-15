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

import { listGouoAgentModels } from '../api'
import { GOUO_QUERY_KEYS } from '../constants'
import type { GouoAgentModel } from '../types'
import { AgentModelDrawer } from './agent-model-drawer'

const route = getRouteApi('/_authenticated/gouo/$section')

function formatPrice(value: number) {
  return `¥${Number(value.toFixed(4))}`
}

function useAgentModelColumns(
  onEdit: (row: GouoAgentModel) => void
): ColumnDef<GouoAgentModel>[] {
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
      accessorFn: (row) => (row.listed ? 'listed' : 'unlisted'),
      header: t('Client visibility'),
      meta: { mobileBadge: true },
      size: 220,
      filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
      cell: ({ row }) =>
        row.original.reason ? (
          <StatusBadge
            label={t(row.original.reason)}
            variant={row.original.listed ? 'warning' : 'neutral'}
            copyable={false}
          />
        ) : (
          <StatusBadge
            label={t('Visible')}
            variant='success'
            copyable={false}
          />
        ),
    },
    {
      id: 'price',
      header: t('Price per million tokens'),
      size: 200,
      cell: ({ row }) =>
        row.original.input_price_cny || row.original.output_price_cny ? (
          <span className='text-sm'>
            {t('Input')} {formatPrice(row.original.input_price_cny)} ·{' '}
            {t('Output')} {formatPrice(row.original.output_price_cny)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'capabilities',
      header: t('Capabilities'),
      size: 200,
      cell: ({ row }) => (
        <BadgeListCell
          items={[
            row.original.vision ? t('Understands images') : t('Text only'),
            ...(row.original.max_tokens > 0
              ? [
                  t('Max {{count}} output tokens', {
                    count: row.original.max_tokens,
                  }),
                ]
              : []),
          ].map((label) => (
            <Badge key={label} variant='outline'>
              {label}
            </Badge>
          ))}
        />
      ),
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

export function AgentModelsSection() {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<GouoAgentModel | null>(null)
  const columns = useAgentModelColumns(setEditing)
  const query = useQuery({
    queryKey: GOUO_QUERY_KEYS.agentModels,
    queryFn: async () => requireServerSuccess(await listGouoAgentModels()),
  })
  const state = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      pageKey: 'aPage',
      pageSizeKey: 'aPageSize',
      defaultPageSize: 20,
    },
    globalFilter: { enabled: true, key: 'aFilter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'aStatus', type: 'array' },
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
          'Configure a channel that supports text models first, then list it here'
        )}
        skeletonKeyPrefix='gouo-agent-models'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Filter by model ID or name...'),
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: [
                { value: 'listed', label: t('Listed') },
                { value: 'unlisted', label: t('Not listed') },
              ],
              singleSelect: true,
            },
          ],
        }}
        getRowClassName={(row, { isMobile }) => {
          if (row.original.listed) return undefined
          return isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
        }}
      />
      <AgentModelDrawer
        row={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  )
}
