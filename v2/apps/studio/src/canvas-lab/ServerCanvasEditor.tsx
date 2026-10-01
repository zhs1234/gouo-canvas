import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Excalidraw, convertToExcalidrawElements, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { RestoredDataState } from '@excalidraw/excalidraw/data/restore'
import { createStore, get, set } from 'idb-keyval'
import { getProject, getAsset, saveProject, type StudioDocument, type StudioProject } from './projects-api'
import { decodeDocument } from './documents'
const store = createStore('gouo-canvas-lab-v1', 'documents')
function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
// A processed source remains processed after deletion, independent of SDK serialization.
export function ServerCanvasEditor({ owner, projectId, assetId }: { owner: string; projectId: string; assetId: string | null }) {
  const navigate = useNavigate()
  const navigating = useRef(false)
  const [project, setProject] = useState<StudioProject>()
  const [initial, setInitial] = useState<RestoredDataState>()
  const [status, setStatus] = useState('正在读取 Studio 项目')
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const pending = useRef<string | undefined>(undefined)
  const processed = useRef<string[]>([])
  const revision = useRef(0)
  const lastSaved = useRef<string | undefined>(undefined)
  const hydrated = useRef(false)
  const queue = useRef(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  const stopped = useRef(false)
  const priorRecovery = useRef<string | undefined>(undefined)
  const openingContent = useRef<string | undefined>(undefined)
  const edited = useRef(false)
  const controller = useRef(new AbortController())
  const backupKey = `${owner}:server:${projectId}:backup`
  const recoveryKey = `${backupKey}:recovery`
  const retainRecovery = async (raw: string) => {
    // Merely reopening an unsaved server version must not erase the failed edits.
    if (!priorRecovery.current || edited.current) await set(recoveryKey, raw, store)
  }
  const serialize = () => api.current ? JSON.stringify({ ...JSON.parse(serializeAsJSON(api.current.getSceneElementsIncludingDeleted(), api.current.getAppState(), api.current.getFiles(), 'local')), processedSourceIds: processed.current }) : pending.current
  const save = (raw = pending.current) => {
    if (!raw) return queue.current
    queue.current = queue.current.catch(() => {}).then(async () => {
      await set(backupKey, raw, store)
      if (!alive.current) return
      if (stopped.current) {
        await retainRecovery(raw)
        return
      }
      if (raw === lastSaved.current) return
      try {
        setStatus('正在保存到 Studio 项目；请等待保存确认')
        const { elements, appState, files, processedSourceIds } = JSON.parse(raw) as StudioDocument
        const next = await saveProject(projectId, revision.current, { document: { elements, appState, files, processedSourceIds } }, controller.current.signal)
        if (!alive.current) return
        revision.current = next.revision
        lastSaved.current = raw
        if (pending.current === raw) pending.current = undefined
        setProject(next); setStatus(pending.current ? '有新修改尚未保存到 Studio 项目' : '已保存到 Studio 项目')
      } catch (error) {
        if (!alive.current) return
        stopped.current = true; setBlocked(true)
        await retainRecovery(pending.current ?? raw)
        const conflict = typeof error === 'object' && error !== null && 'status' in error && error.status === 409
        setStatus(conflict ? '项目版本冲突：自动保存已暂停，请导出本机备份后重新加载' : `保存失败：${error instanceof Error ? error.message : '请求失败'}；自动保存已暂停，本机备份已保留`)
      }
    }).catch(() => { if (alive.current) { stopped.current = true; setBlocked(true); setStatus('本机备份失败，自动保存已暂停，请立即导出文档') } })
    return queue.current
  }
  const leave = async (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (navigating.current) return
    navigating.current = true
    try {
      clearTimeout(timer.current)
      if (pending.current && pending.current !== lastSaved.current) {
        // Client routing does not trigger beforeunload: finish the pending save first.
        if (stopped.current) {
          if (!window.confirm('此项目有未保存到服务器的修改。离开前将保留本机恢复副本，建议先导出文档备份。确定离开？')) return
          await retainRecovery(pending.current)
        } else {
          await save(serialize())
          if (stopped.current || (pending.current && pending.current !== lastSaved.current)) return
        }
      }
      navigate(path)
    } catch { setStatus('本机恢复副本保存失败，请先导出文档备份再离开') }
    finally { navigating.current = false }
  }
  useEffect(() => {
    alive.current = true
    const requestController = new AbortController()
    controller.current = requestController
    let cancelled = false
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (pending.current && pending.current !== lastSaved.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warnUnsaved)
    void (async () => {
      try {
        const current = await getProject(projectId, requestController.signal)
        // A failed local read must not prevent opening or exporting the server scene.
        priorRecovery.current = await get<string>(recoveryKey, store).catch(() => undefined)
        const source = assetId ?? current.sourceAssetId
        processed.current = [...(current.document.processedSourceIds ?? [])]
        const document = { type: 'excalidraw', version: 2, ...current.document }
        for (const element of document.elements as Array<{ customData?: { assetId?: string } }>) {
          if (element.customData?.assetId && !processed.current.includes(element.customData.assetId)) processed.current.push(element.customData.assetId)
        }
        if (source && !processed.current.includes(source)) {
          const asset = await getAsset(source, requestController.signal)
          if (!asset.dataURL || !asset.dataURL.startsWith('data:image/')) throw new Error('素材缺少可恢复的原始图片')
          const width = Math.min(asset.width, 640), height = width * asset.height / asset.width
          const [element] = convertToExcalidrawElements([{ type: 'image', x: 350, y: 200, width, height, fileId: asset.id as FileId, customData: { assetId: asset.id, sourceId: asset.id } }])
          document.elements = [...document.elements, element]
          document.files = { ...document.files, [asset.id]: { id: asset.id, assetId: asset.id, dataURL: asset.dataURL, mimeType: asset.mimeType, created: Date.now() } }
          processed.current.push(asset.id)
        }
        const { scene } = await decodeDocument(JSON.stringify(document))
        if (cancelled) return
        revision.current = current.revision
        setProject(current); setInitial(scene); setStatus('Studio 项目已打开；原始素材独立保存')
      } catch (error) { if (!cancelled) setStatus(`项目读取失败：${error instanceof Error ? error.message : '请求失败'}；未覆盖项目或本机备份`) }
    })()
    return () => {
      cancelled = true; alive.current = false; requestController.abort(); clearTimeout(timer.current)
      window.removeEventListener('beforeunload', warnUnsaved)
      if (pending.current) void retainRecovery(pending.current).catch(() => {})
    }
  }, [])
  return <main className="gouo-canvas-lab">
    <header className="canvas-project-bar"><Link to="/projects" onClick={event => { void leave(event, '/projects') }}>项目库</Link><div className="canvas-project-title"><strong>{project?.title ?? 'Studio 项目'}</strong><span>Excalidraw · 私有项目</span></div>
      <button disabled={!ready || blocked} onClick={() => void save(serialize())}>保存 Studio 项目</button>
      <button disabled={!ready} onClick={() => { const raw = serialize(); if (raw) download(raw, `${project?.title ?? 'studio'}.excalidraw`) }}>导出文档备份</button>
      <details className="canvas-more"><summary>更多操作</summary><div className="canvas-more-panel">
      <Link to="/" onClick={event => { void leave(event, '/') }}>返回创作画布</Link>
      <button onClick={() => void (async () => {
        // Local export must not wait for an in-flight or unresponsive remote save.
        const current = pending.current
        if (current) {
          await set(backupKey, current, store)
          await retainRecovery(current)
        }
        const raw = priorRecovery.current && !edited.current ? priorRecovery.current : current ?? await get<string>(recoveryKey, store) ?? await get<string>(backupKey, store)
        if (raw) download(raw, 'studio-recovery.excalidraw')
        else setStatus('本机没有此项目备份')
      })().catch(() => setStatus('本机备份读取失败，请使用导出文档备份保存当前画布'))}>下载本机备份</button>
      </div></details>
      {blocked && <button onClick={() => window.location.reload()}>重新加载服务器版本</button>}
      <output role={blocked ? 'alert' : 'status'}>{status}</output>
    </header>
    {initial && <section className="gouo-canvas-lab-editor" aria-label="官方画布"><Excalidraw initialData={initial} langCode="zh-CN" excalidrawAPI={value => { api.current = value }} onChange={(elements, state, files) => {
      if (state.isLoading || !api.current) return
      if (!hydrated.current) {
        if (elements.filter(element => !element.isDeleted).length < initial.elements.filter(element => !element.isDeleted).length) return
        hydrated.current = true; setReady(true)
        openingContent.current = JSON.stringify({ elements, files })
      }
      if (JSON.stringify({ elements, files }) !== openingContent.current) edited.current = true
      pending.current = JSON.stringify({ ...JSON.parse(serializeAsJSON(elements, state, files, 'local')), processedSourceIds: processed.current })
      if (!stopped.current && pending.current !== lastSaved.current) setStatus('有修改尚未保存到 Studio 项目')
      clearTimeout(timer.current); timer.current = setTimeout(() => void save(), 500)
    }} /></section>}
  </main>
}
