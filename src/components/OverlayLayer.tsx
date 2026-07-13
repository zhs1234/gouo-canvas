import { lazy, Suspense } from 'react'
import { useStore } from '../store'

const ConfirmDialog = lazy(() => import('./ConfirmDialog'))
const DetailModal = lazy(() => import('./DetailModal'))
const Lightbox = lazy(() => import('./Lightbox'))
const MaskEditorModal = lazy(() => import('./MaskEditorModal'))
const SettingsModal = lazy(() => import('./SettingsModal'))
const FavoriteCollectionPickerModal = lazy(() =>
  import('./favorites/FavoriteCollectionPickerModal').then((module) => ({ default: module.FavoriteCollectionPickerModal })),
)
const ManageCollectionsModal = lazy(() =>
  import('./favorites/ManageCollectionsModal').then((module) => ({ default: module.ManageCollectionsModal })),
)

export default function OverlayLayer() {
  const showSettings = useStore((s) => s.showSettings)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const confirmDialog = useStore((s) => s.confirmDialog)
  const favoritePickerTaskIds = useStore((s) => s.favoritePickerTaskIds)
  const isManageCollectionsModalOpen = useStore((s) => s.isManageCollectionsModalOpen)

  return (
    <Suspense fallback={null}>
      {showSettings && <SettingsModal />}
      {detailTaskId && <DetailModal />}
      {lightboxImageId && <Lightbox />}
      {maskEditorImageId && <MaskEditorModal />}
      {confirmDialog && <ConfirmDialog />}
      {Boolean(favoritePickerTaskIds?.length) && <FavoriteCollectionPickerModal />}
      {isManageCollectionsModalOpen && <ManageCollectionsModal />}
    </Suspense>
  )
}
