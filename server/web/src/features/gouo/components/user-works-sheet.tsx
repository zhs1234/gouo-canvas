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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatTimestampToDate } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { fetchGouoUserAsset, listGouoUserTasks } from '../api'
import { GOUO_QUERY_KEYS } from '../constants'
import type { GouoStorageUser, GouoUserTask } from '../types'

const PAGE_SIZE = 12

function WorkThumbnail(props: {
  userId: number
  assetId: string
  alt: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    fetchGouoUserAsset(props.userId, props.assetId)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [props.userId, props.assetId])
  if (failed) return <div className='bg-muted size-full' />
  if (!url) return <div className='bg-muted size-full animate-pulse' />
  return <img src={url} alt={props.alt} className='size-full object-cover' />
}

function WorkCard(props: { userId: number; task: GouoUserTask }) {
  const { t } = useTranslation()
  const outputs = props.task.assets.filter((asset) => asset.role === 'output')
  return (
    <div className='flex flex-col overflow-hidden rounded-lg border'>
      <div className='grid aspect-square grid-cols-2 gap-px'>
        {outputs.length === 0 ? (
          <div className='text-muted-foreground col-span-2 flex items-center justify-center text-xs'>
            {t('No output images')}
          </div>
        ) : (
          outputs.slice(0, 4).map((asset) => (
            <div
              key={asset.asset_id}
              className={outputs.length === 1 ? 'col-span-2 row-span-2' : ''}
            >
              <WorkThumbnail
                userId={props.userId}
                assetId={asset.asset_id}
                alt={props.task.prompt}
              />
            </div>
          ))
        )}
      </div>
      <div className='flex flex-col gap-1 p-2'>
        <p className='line-clamp-2 text-sm' title={props.task.prompt}>
          {props.task.prompt || t('No prompt')}
        </p>
        <div className='text-muted-foreground flex flex-wrap items-center gap-1 text-xs'>
          <span>
            {formatTimestampToDate(
              Math.floor(props.task.client_created_at / 1000)
            )}
          </span>
          {props.task.hidden_at > 0 && (
            <Badge variant='outline'>{t('In trash')}</Badge>
          )}
        </div>
      </div>
    </div>
  )
}

type UserWorksSheetProps = {
  user: GouoStorageUser | null
  onOpenChange: (open: boolean) => void
}

export function UserWorksSheet(props: UserWorksSheetProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const userId = props.user?.user_id ?? 0
  useEffect(() => setPage(1), [userId])
  const query = useQuery({
    queryKey: GOUO_QUERY_KEYS.userTasks(userId, page),
    queryFn: async () =>
      requireServerSuccess(
        await listGouoUserTasks(userId, { p: page, page_size: PAGE_SIZE })
      ),
    enabled: userId > 0,
    placeholderData: (previous) => previous,
  })
  const tasks = query.data?.data?.items ?? []
  const total = query.data?.data?.total ?? 0
  let content = (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
      {tasks.map((task) => (
        <WorkCard key={task.id} userId={userId} task={task} />
      ))}
    </div>
  )
  if (query.isLoading) {
    content = <LoadingState />
  } else if (query.isError) {
    content = (
      <ErrorState
        title={t('Failed to load')}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (tasks.length === 0) {
    content = <EmptyState title={t('No works yet')} />
  }

  return (
    <Sheet open={props.user !== null} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[720px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('User works')}</SheetTitle>
          <SheetDescription>
            {props.user?.username} · {t('{{count}} works', { count: total })}
          </SheetDescription>
        </SheetHeader>
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'>
          {content}
          {total > PAGE_SIZE && (
            <div className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('Previous')}
              </Button>
              <span className='text-muted-foreground text-sm'>
                {page} / {Math.ceil(total / PAGE_SIZE)}
              </span>
              <Button
                variant='outline'
                size='sm'
                disabled={page * PAGE_SIZE >= total}
                onClick={() => setPage(page + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
