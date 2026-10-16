import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskRecord, FavoriteCollection } from '../../types'
import {
  ALL_FAVORITES_COLLECTION_ID,
  deleteFavoriteCollection,
  renameFavoriteCollection,
  useStore,
} from '../../store'
import { useDragSelect } from '../../hooks/useDragSelect'
import { FavoriteIcon } from '../icons'
import { FavoriteCollectionOverviewCard } from './FavoriteCollectionOverviewCard'
import { getCollectionTasks, getLatestCoverTask, type CollectionCard } from './favoriteUtils'

export function FavoriteCollectionsView() {
  const tasks = useStore((s) => s.tasks)
  const collections = useStore((s) => s.favoriteCollections)
  const defaultFavoriteCollectionId = useStore((s) => s.defaultFavoriteCollectionId)
  const setDefaultFavoriteCollectionId = useStore((s) => s.setDefaultFavoriteCollectionId)
  const searchQuery = useStore((s) => s.searchQuery)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedFavoriteCollectionIds = useStore((s) => s.selectedFavoriteCollectionIds)
  const setSelectedFavoriteCollectionIds = useStore((s) => s.setSelectedFavoriteCollectionIds)
  const toggleFavoriteCollectionSelection = useStore((s) => s.toggleFavoriteCollectionSelection)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const suppressClickUntilRef = useRef(0)
  const navigate = useNavigate()

  const cards = useMemo<CollectionCard[]>(() => {
    const allTasks = getCollectionTasks(ALL_FAVORITES_COLLECTION_ID, tasks)
    return [
      { id: ALL_FAVORITES_COLLECTION_ID, name: '全部', tasks: allTasks },
      ...collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        collection,
        tasks: getCollectionTasks(collection.id, tasks),
      })),
    ]
  }, [collections, tasks])

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return cards
    const lowerQuery = searchQuery.toLowerCase()
    return cards.filter(c => c.name.toLowerCase().includes(lowerQuery))
  }, [cards, searchQuery])

  const handleCollectionSelectionChange = useCallback((ids: string[]) => {
    setSelectedFavoriteCollectionIds(ids)
  }, [setSelectedFavoriteCollectionIds])

  const { selectionBox } = useDragSelect({
    containerSelector: '[data-drag-select-surface]',
    itemSelector: '.favorite-collection-card-wrapper',
    getItemId: (element) => element.getAttribute('data-favorite-collection-id'),
    onSelectionChange: handleCollectionSelectionChange,
    initialSelectedIds: selectedFavoriteCollectionIds,
    onSuppressClick: () => {
      suppressClickUntilRef.current = Date.now() + 250
    },
  })

  const startRename = (e: React.MouseEvent, collection: FavoriteCollection) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(collection.id)
    setEditingName(collection.name)
  }

  const confirmRename = () => {
    if (editingId && editingName.trim()) renameFavoriteCollection(editingId, editingName.trim())
    setEditingId(null)
    setEditingName('')
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingId(null)
      setEditingName('')
    }
  }

  const handleDelete = (collection: FavoriteCollection, collectionTasks: TaskRecord[]) => {
    if (collections.length <= 1) return
    const imageCount = new Set(collectionTasks.flatMap((task) => task.outputImages || [])).size
    setConfirmDialog({
      title: '删除收藏夹',
      message: `确定要删除收藏夹「${collection.name}」吗？`,
      checkbox: imageCount > 0
        ? {
            label: `同时删除收藏夹中的图片（${imageCount} 张）`,
            tone: 'danger',
          }
        : undefined,
      action: (deleteImages = false) => {
        void deleteFavoriteCollection(collection.id, deleteImages)
      },
    })
  }

  const handleSetDefault = (collection: FavoriteCollection) => {
    if (collection.id === defaultFavoriteCollectionId) {
      setDefaultFavoriteCollectionId(null)
      return
    }
    const current = collections.find((item) => item.id === defaultFavoriteCollectionId)
    if (!current) {
      setDefaultFavoriteCollectionId(collection.id)
      return
    }
    setConfirmDialog({
      title: '修改默认收藏夹',
      message: `确定要将默认收藏夹从「${current.name}」改为「${collection.name}」吗？`,
      action: () => setDefaultFavoriteCollectionId(collection.id),
    })
  }

  // 还没有任何收藏时给出引导；只有默认收藏夹时不再展示空的收藏夹卡片
  const hasFavorites = cards[0].tasks.length > 0
  const showGuide = !hasFavorites && !searchQuery.trim()

  return (
    <div data-favorite-collections-root className="relative min-h-[50vh]">
      {showGuide && (
        <div data-no-drag-select className="mx-auto max-w-md py-16 text-center">
          <FavoriteIcon className="mx-auto mb-4 h-12 w-12 text-yellow-400/80" />
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">还没有收藏的作品</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
            在「我的作品」里点击作品上的星标即可收藏，收藏后会出现在这里；还可以新建收藏夹分类整理。
          </p>
          <button
            type="button"
            onClick={() => navigate('/works')}
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-blue-500 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
          >
            去我的作品
          </button>
        </div>
      )}
      {showGuide && collections.length <= 1 ? null : filteredCards.length === 0 ? (
        <div className="py-32 text-center text-gray-400 dark:text-gray-500">
          <FavoriteIcon className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="text-sm">{cards.length === 0 ? '还没有收藏的图片' : '没有找到匹配的收藏夹'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-10">
          {filteredCards.map((card) => {
            const coverTask = getLatestCoverTask(card.tasks)
            const isVirtualAll = card.id === ALL_FAVORITES_COLLECTION_ID
            const isDefault = card.id === defaultFavoriteCollectionId
            const canDelete = collections.length > 1
            return (
              <div
                key={card.id}
                className="favorite-collection-card-wrapper"
                data-favorite-collection-id={card.id}
              >
                <FavoriteCollectionOverviewCard
                  card={card}
                  coverTask={coverTask}
                  isVirtualAll={isVirtualAll}
                  isDefault={isDefault}
                  canDelete={canDelete}
                  isSelected={selectedFavoriteCollectionIds.includes(card.id)}
                  editingId={editingId}
                  editingName={editingName}
                  setEditingName={setEditingName}
                  confirmRename={confirmRename}
                  handleRenameKeyDown={handleRenameKeyDown}
                  startRename={startRename}
                  handleSetDefault={handleSetDefault}
                  handleDelete={handleDelete}
                  onOpen={() => setActiveFavoriteCollectionId(card.id)}
                  onToggleSelection={() => toggleFavoriteCollectionSelection(card.id)}
                  suppressClickUntilRef={suppressClickUntilRef}
                />
              </div>
            )
          })}
        </div>
      )}
      {selectionBox && (
        <div
          className="fixed bg-blue-500/20 border border-blue-500/50 pointer-events-none z-[30]"
          style={{
            left: Math.min(selectionBox.startPageX, selectionBox.currentPageX) - window.scrollX,
            top: Math.min(selectionBox.startPageY, selectionBox.currentPageY) - window.scrollY,
            width: Math.abs(selectionBox.currentPageX - selectionBox.startPageX),
            height: Math.abs(selectionBox.currentPageY - selectionBox.startPageY),
          }}
        />
      )}
    </div>
  )
}
