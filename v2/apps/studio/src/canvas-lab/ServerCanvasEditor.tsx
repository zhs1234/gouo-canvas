import { useEffect, useRef, useState } from 'react'
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
  const controller = useRef(new AbortController())
  const backupKey = `${owner}:server:${projectId}:backup`
  const recoveryKey = `${backupKey}:recovery`
  const serialize = () => api.current ? JSON.stringify({ ...JSON.parse(serializeAsJSON(api.current.getSceneElementsIncludingDeleted(), api.current.getAppState(), api.current.getFiles(), 'local')), processedSourceIds: processed.current }) : pending.current
  const save = (raw = pending.current) => {
    if (!raw) return queue.current
    queue.current = queue.current.catch(() => {}).then(async () => {
      await set(backupKey, raw, store)
      if (!alive.current || stopped.current || raw === lastSaved.current) return
      try {
        const { elements, appState, files, processedSourceIds } = JSON.parse(raw) as StudioDocument
        const next = await saveProject(projectId, revision.current, { document: { elements, appState, files, processedSourceIds } }, controller.current.signal)
        if (!alive.current) return
        revision.current = next.revision
        lastSaved.current = raw
        if (pending.current === raw) pending.current = undefined
        setProject(next); setStatus('已保存到 Studio 项目')
      } catch (error) {
        if (!alive.current) return
        await set(recoveryKey, raw, store)
        stopped.current = true; setBlocked(true)
        const conflict = typeof error === 'object' && error !== null && 'status' in error && error.status === 409
        setStatus(conflict ? '项目版本冲突：自动保存已暂停，请导出本机备份后重新加载' : `保存失败：${error instanceof Error ? error.message : '请求失败'}；自动保存已暂停，本机备份已保留`)
      }
    }).catch(() => { if (alive.current) { stopped.current = true; setBlocked(true); setStatus('本机备份失败，自动保存已暂停，请立即导出文档') } })
    return queue.current
  }
  useEffect(() => {
    alive.current = true
    const requestController = new AbortController()
    controller.current = requestController
    let cancelled = false
    void (async () => {
      try {
        const current = await getProject(projectId, requestController.signal)
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
      if (pending.current) void set(recoveryKey, pending.current, store).catch(() => {})
    }
  }, [])
  return <main className="gouo-canvas-lab">
    <header><a href="/studio/projects">项目库</a><a href="/studio/">返回创作画布</a><strong>{project?.title ?? 'Studio 项目'}</strong><span>官方 Excalidraw · 账号私有项目</span>
      <button disabled={!ready || blocked} onClick={() => void save(serialize())}>保存 Studio 项目</button>
      <button disabled={!ready} onClick={() => { const raw = serialize(); if (raw) download(raw, `${project?.title ?? 'studio'}.excalidraw`) }}>导出文档备份</button>
      <button onClick={() => void get<string>(recoveryKey, store).then(async raw => raw ?? await get<string>(backupKey, store)).then(raw => raw ? download(raw, 'studio-recovery.excalidraw') : setStatus('本机没有此项目备份'))}>下载本机备份</button>
      {blocked && <button onClick={() => window.location.reload()}>重新加载服务器版本</button>}
      <output role={blocked ? 'alert' : 'status'}>{status}</output>
    </header>
    {initial && <section className="gouo-canvas-lab-editor" aria-label="官方画布"><Excalidraw initialData={initial} langCode="zh-CN" excalidrawAPI={value => { api.current = value }} onChange={(elements, state, files) => {
      if (state.isLoading || !api.current) return
      if (!hydrated.current) {
        if (elements.filter(element => !element.isDeleted).length < initial.elements.filter(element => !element.isDeleted).length) return
        hydrated.current = true; setReady(true)
      }
      pending.current = JSON.stringify({ ...JSON.parse(serializeAsJSON(elements, state, files, 'local')), processedSourceIds: processed.current })
      clearTimeout(timer.current); timer.current = setTimeout(() => void save(), 500)
    }} /></section>}
  </main>
}
