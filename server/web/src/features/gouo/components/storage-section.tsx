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

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/features/channels/lib/ollama-utils'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getGouoStorage, listGouoStorageUsers } from '../api'
import { GOUO_QUERY_KEYS } from '../constants'
import type { GouoStorageUser } from '../types'
import { StorageQuotaDialog } from './storage-quota-dialog'
import { UserWorksSheet } from './user-works-sheet'

const route = getRouteApi('/_authenticated/gouo/$section')

function StorageSummary() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: GOUO_QUERY_KEYS.storage,
    queryFn: async () => requireServerSuccess(await getGouoStorage()),
  })
  const summary = query.data?.data?.summary
  const items = [
    {
      label: t('Used space'),
      value: summary ? formatBytes(summary.total_bytes) : '—',
    },
    {
      label: t('Images'),
      value: summary ? formatNumber(summary.asset_count) : '—',
    },
    {
      label: t('Works'),
      value: summary ? formatNumber(summary.task_count) : '—',
    },
    {
      label: t('Works in trash'),
      value: summary ? formatNumber(summary.hidden_count) : '—',
    },
    {
      label: t('Users with images'),
      value: summary ? formatNumber(summary.user_count) : '—',
    },
  ]
  return (
    <div className='grid gap-3 sm:grid-cols-3 lg:grid-cols-5'>
      {items.map((item) => (
        <Card key={item.label} size='sm'>
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className='text-xl tabular-nums'>{item.value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
      {query.data?.data && (
        <Card size='sm' className='sm:col-span-3 lg:col-span-5'>
          <CardContent className='text-muted-foreground text-sm'>
            {t(
              'Default storage per user: {{size}}. Files are stored in {{dir}}.',
              {
                size: formatBytes(query.data.data.default_quota_bytes),
                dir: query.data.data.asset_dir,
              }
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function useStorageUserColumns(actions: {
  onQuota: (row: GouoStorageUser) => void
  onWorks: (row: GouoStorageUser) => void
}): ColumnDef<GouoStorageUser>[] {
  const { t } = useTranslation()
  return [
    {
      id: 'user',
      header: t('User'),
      meta: { mobileTitle: true },
      size: 220,
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
      id: 'usage',
      header: t('Used / quota'),
      size: 260,
      cell: ({ row }) => (
        <div className='flex flex-col gap-1.5'>
          <span className='text-sm tabular-nums'>
            {formatBytes(row.original.used_bytes)} /{' '}
            {formatBytes(row.original.quota_bytes)}
          </span>
          <Progress
            value={Math.min(
              100,
              (row.original.used_bytes /
                Math.max(1, row.original.quota_bytes)) *
                100
            )}
          />
        </div>
      ),
    },
    {
      accessorKey: 'asset_count',
      header: t('Images'),
      size: 100,
      cell: ({ row }) => formatNumber(row.original.asset_count),
    },
    {
      id: 'actions',
      header: '',
      size: 200,
      enableHiding: false,
      cell: ({ row }) => (
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => actions.onWorks(row.original)}
          >
            {t('View works')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => actions.onQuota(row.original)}
          >
            {t('Set quota')}
          </Button>
        </div>
      ),
    },
  ]
}

export function StorageSection() {
  const { t } = useTranslation()
  const [quotaUser, setQuotaUser] = useState<GouoStorageUser | null>(null)
  const [worksUser, setWorksUser] = useState<GouoStorageUser | null>(null)
  const columns = useStorageUserColumns({
    onQuota: setQuotaUser,
    onWorks: setWorksUser,
  })
  const state = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      pageKey: 'sPage',
      pageSizeKey: 'sPageSize',
      defaultPageSize: 20,
    },
  })
  const page = state.pagination.pageIndex + 1
  const query = useQuery({
    queryKey: GOUO_QUERY_KEYS.storageUsers(page, state.pagination.pageSize),
    queryFn: async () =>
      requireServerSuccess(
        await listGouoStorageUsers({
          p: page,
          page_size: state.pagination.pageSize,
        })
      ),
    placeholderData: (previous) => previous,
  })
  const { table } = useDataTable({
    data: query.data?.data?.items ?? [],
    columns,
    getRowId: (row) => String(row.user_id),
    pagination: state.pagination,
    onPaginationChange: state.onPaginationChange,
    manualPagination: true,
    totalCount: query.data?.data?.total ?? 0,
    ensurePageInRange: state.ensurePageInRange,
  })

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <StorageSummary />
      <div className='min-h-0 flex-1'>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          emptyTitle={t('No cloud storage usage yet')}
          skeletonKeyPrefix='gouo-storage-users'
          applyHeaderSize
          toolbarProps={null}
        />
      </div>
      <StorageQuotaDialog
        user={quotaUser}
        onOpenChange={(open) => !open && setQuotaUser(null)}
      />
      <UserWorksSheet
        user={worksUser}
        onOpenChange={(open) => !open && setWorksUser(null)}
      />
    </div>
  )
}
