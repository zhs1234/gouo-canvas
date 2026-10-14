import { useEffect } from 'react'
import { HashRouter } from 'react-router-dom'
import Workspace from './components/Workspace'
import { initStore } from './store'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import OverlayLayer from './components/OverlayLayer'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { startServerLibrary } from './lib/serverLibrary'

export default function App() {
  useGlobalClickSuppression()

  useEffect(() => {
    void initStore().then(() => startServerLibrary())
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img') && !(e.target as HTMLElement).closest('.canvas-workspace')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <HashRouter><Workspace /></HashRouter>
      <OverlayLayer />
      <Toast />
      <ImageContextMenu />
    </>
  )
}
