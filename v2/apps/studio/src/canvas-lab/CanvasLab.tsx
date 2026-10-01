import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Excalidraw, CaptureUpdateAction, convertToExcalidrawElements, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { RestoredDataState } from '@excalidraw/excalidraw/data/restore'
import { createStore, get, set, setMany } from 'idb-keyval'
import '@excalidraw/excalidraw/index.css'
import './canvas-lab.css'
import { useAuth } from '../loomic/lib/auth-context'
import { Link, useSearchParams } from 'react-router-dom'
import { ServerCanvasEditor } from './ServerCanvasEditor'
import { useWorkspaceLeaveGuard } from '../workspace/WorkspaceNavigationProvider'
import { decodeDocument, readLegacyDrafts, type LegacyDraft } from './documents'

// 独立数据库，不读取或改写正式画布与会话草稿。
const store = createStore('gouo-canvas-lab-v1', 'documents')
const fixture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAYAAAABtjuPAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACFUlEQVR4nO2UQQ3AQACDTiq2Jm1qbjLWBB4YKKSH573RBvy0wSm+4uPHDQqwAG8BFsG1btADDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQEwBDkhATAEOSEBMAQ5IQMwHQEwQ0aAfKqcAAAAASUVORK5CYII='
const empty = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }

function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function CanvasLab() {
  const { user, loading } = useAuth()
  const [params] = useSearchParams()
  const projectId = params.get('project')
  const assetId = params.get('asset')
  const owner = `local:${user?.id ?? 'guest'}`
  if (loading) return <p>正在确认当前本地草稿范围</p>
  if (projectId) return user ? <ServerCanvasEditor key={`${owner}:${projectId}:${assetId ?? ''}`} owner={owner} projectId={projectId} assetId={assetId} /> : <main><Link to="/">返回创作画布</Link><p role="alert">请先登录 New API 账号后打开 Studio 项目</p></main>
  return <CanvasLabEditor key={owner} owner={owner} />
}
function CanvasLabEditor({ owner }: { owner: string }) {
  const { resolvedTheme } = useTheme()
  const storageKey = (name: string) => `${owner}:${name}`
  const [legacyDrafts, setLegacyDrafts] = useState<Array<{ key: string; draft: LegacyDraft }>>([])
  const [initial, setInitial] = useState<RestoredDataState>()
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const hydrated = useRef(false)
  const [status, setStatus] = useState('正在读取独立对照草稿')
  const [importError, setImportError] = useState('')
  const [failure, setFailure] = useState(false)
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef(Promise.resolve())
  const alive = useRef(true)
  const importing = useRef(false)

  const save = (raw = pending.current) => {
    if (!raw) return queue.current.then(() => true, () => false)
    queue.current = queue.current.catch(() => {}).then(() => set(storageKey('active'), raw, store))
    return queue.current.then(() => {
      if (pending.current === raw) pending.current = undefined
      if (alive.current) setStatus('已保存到本机对照草稿')
      return true
    }).catch(() => { if (alive.current) setStatus('保存失败，请立即导出文档备份'); return false })
  }
  useWorkspaceLeaveGuard(async () => {
    clearTimeout(timer.current)
    return await save() && !pending.current
  })
  useEffect(() => {
    alive.current = true
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (pending.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warnUnsaved)
    get<string>(storageKey('active'), store).then(async raw => raw ?? (owner === 'local:guest' ? await get<string>('active', store) : undefined)).then(raw => decodeDocument(raw ?? JSON.stringify(empty))).then(({ scene }) => {
      if (alive.current) { setInitial(scene); setStatus('独立对照草稿已打开') }
    }).catch(() => { if (alive.current) { setStatus('草稿读取失败，未覆盖原数据'); setFailure(true) } })
    return () => { alive.current = false; window.removeEventListener('beforeunload', warnUnsaved); clearTimeout(timer.current); void save() }
  }, [])

  const importCopy = async (file?: File, sourceDraft?: LegacyDraft) => {
    if (!file || importing.current) return
    importing.current = true
    setImportError('')
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('文档超过 32 MB，请保留原件并使用较小副本')
      const raw = await file.text()
      const { scene, legacy } = await decodeDocument(raw)
      // 导入前保存当前编辑；原始字节另存，SDK 恢复不覆盖原始快照。
      clearTimeout(timer.current)
      if (!await save()) throw new Error('当前草稿保存失败，停止导入以免丢失内容')
      const current = await get<string>(storageKey('active'), store)
      const snapshot = { name: file.name, raw, sourceDraft, importedAt: new Date().toISOString() }
      const writes: [string, unknown][] = [
        [storageKey(`import:${crypto.randomUUID()}`), snapshot],
        [storageKey('last-import'), raw],
        [storageKey('active'), raw],
      ]
      if (current) writes.push([storageKey(`before-import:${crypto.randomUUID()}`), current])
      await setMany(writes, store)
      pending.current = undefined
      api.current = null
      hydrated.current = false
      setReady(false)
      setInitial(scene)
      setRevision(value => value + 1)
      setStatus(legacy ? '已导入 Loomic 画布副本，完整原始草稿快照已保留；会话不迁入对照页' : '已导入副本，原始文档快照已保留')
    } catch (error) { setImportError(error instanceof Error ? error.message : '导入失败，原草稿未替换') }
    finally { importing.current = false }
  }
  const insertFixture = () => {
    const current = api.current
    if (!current) return
    const elements = current.getSceneElements()
    if (elements.some(element => element.customData?.artifactId === 'lab-fixture-1')) {
      setStatus('同一素材已在画布中，未重复插入')
      return
    }
    const view = current.getAppState()
    const x = view.width / (2 * view.zoom.value) - view.scrollX - 80
    const y = view.height / (2 * view.zoom.value) - view.scrollY - 50
    const [element] = convertToExcalidrawElements([{ type: 'image', x, y, width: 160, height: 100, fileId: 'lab-fixture-1' as FileId, customData: { artifactId: 'lab-fixture-1' } }])
    current.addFiles([{ id: 'lab-fixture-1', dataURL: fixture, mimeType: 'image/png', created: Date.now() }] as Parameters<ExcalidrawImperativeAPI['addFiles']>[0])
    current.updateScene({ elements: [...elements, element], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    setStatus('已插入测试素材（未调用模型）')
  }
  return <main className="gouo-canvas-lab">
    <header className="canvas-project-bar">
      <Link to="/">返回聊天</Link>
      <div className="canvas-project-title"><strong>本机画布</strong><span>保存在当前浏览器</span></div>
      <details className="canvas-more"><summary>更多操作</summary><div className="canvas-more-panel">
      <label>导入文档副本<input aria-label="导入文档副本" type="file" accept=".excalidraw,application/json" disabled={!ready} onChange={event => { void importCopy(event.target.files?.[0]); event.target.value = '' }} /></label>
      <button disabled={!ready} onClick={() => void save()}>保存本机画布</button>
      <button disabled={!ready} onClick={() => {
        if (api.current) download(serializeAsJSON(api.current.getSceneElements(), api.current.getAppState(), api.current.getFiles(), 'local'), 'gouo-lab.excalidraw')
      }}>导出文档副本</button>
      <button onClick={() => void get<string>(storageKey('last-import'), store).then(raw => raw ? download(raw, 'original-import.excalidraw') : setStatus('尚未导入文档'))}>下载原始导入文件</button>
      <button disabled={!ready} onClick={() => void (async () => {
        try {
          if (!api.current) return
          const blob = await exportToBlob({ elements: api.current.getSceneElements(), appState: api.current.getAppState(), files: api.current.getFiles(), mimeType: 'image/png' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = 'gouo-lab.png'; a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch { setStatus('PNG 导出失败，请先导出文档备份') }
      })()}>导出 PNG 副本</button>
      <button disabled={!ready} onClick={() => void readLegacyDrafts(owner).then(rows => { setLegacyDrafts(rows); setStatus(rows.length ? '仅列出当前账号或访客范围的旧草稿，点击导入副本' : '当前范围没有旧 Loomic 草稿') }).catch(error => setStatus(error.message))}>查看旧草稿（只读）</button>
      <div className="canvas-demo"><p>开发演示 · 不调用模型</p><button disabled={!ready} onClick={insertFixture}>插入测试素材</button></div>
      </div></details>
      <output role="status">{status}</output>
    </header>
    {importError && <p role="alert">{importError}；当前画布和原始导入文件未替换。</p>}
    {legacyDrafts.length > 0 && <aside aria-label="旧 Loomic 草稿副本">{legacyDrafts.map(({ key, draft }) => <button key={key} disabled={!ready} onClick={() => void importCopy(new File([JSON.stringify(draft)], `${draft.canvas.name}.json`, { type: 'application/json' }), draft)}>导入副本：{draft.canvas.name}</button>)}<p>仅导入画布；聊天与缩略图保留在独立数据库的原始快照，原项目不变。</p></aside>}
    {failure && <p>请保留浏览器数据。此页面不会自动清空损坏的草稿。</p>}
    {initial && <section className="gouo-canvas-lab-editor" aria-label="官方画布">
      <Excalidraw key={revision} theme={resolvedTheme === 'dark' ? 'dark' : 'light'} initialData={initial} langCode="zh-CN" excalidrawAPI={value => { api.current = value }} onChange={(elements, state, files) => {
        if (!alive.current || state.isLoading || !api.current || importing.current) return
        if (!hydrated.current) {
          if (elements.filter(element => !element.isDeleted).length < initial.elements.filter(element => !element.isDeleted).length) return
          hydrated.current = true
          setReady(true)
        }
        pending.current = serializeAsJSON(elements, state, files, 'local')
        clearTimeout(timer.current)
        timer.current = setTimeout(() => void save(), 500)
      }} />
    </section>}
  </main>
}
