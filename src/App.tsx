import { useEffect } from 'react'
import { HashRouter } from 'react-router-dom'
import Workspace from './components/Workspace'
import { initStore } from './store'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import OverlayLayer from './components/OverlayLayer'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { startServerLibrary } from './lib/serverLibrary'
import { useCanvasStore } from './stores/canvasStore'

export default function App() {
  useGlobalClickSuppression()

  useEffect(() => {
    void initStore().then(() => startServerLibrary(), (err) => {
      // 本地数据库打不开时不会再拉取云端文档，画布页不必一直等待
      console.error('初始化本地数据失败', err)
      useCanvasStore.setState({ documentsPulled: true })
    })
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
