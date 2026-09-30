import { useEffect, useRef, useState } from 'react'
import { Excalidraw, CaptureUpdateAction, convertToExcalidrawElements, loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { RestoredDataState } from '@excalidraw/excalidraw/data/restore'
import { createStore, get, set } from 'idb-keyval'
import '@excalidraw/excalidraw/index.css'
import './canvas-lab.css'

// 独立数据库，不读取或改写正式画布与会话草稿。
const store = createStore('gouo-canvas-lab-v1', 'documents')
const fixture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
const empty = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }

async function decode(raw: string) {
  const data = JSON.parse(raw)
  if (data?.type !== 'excalidraw' || !Array.isArray(data.elements) || typeof data.version !== 'number') {
    throw new Error('请选择 Excalidraw 文档；不支持直接导入 Fabric 或其他画布格式')
  }
  return loadFromBlob(new Blob([raw], { type: 'application/json' }), null, null)
}
function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function CanvasLab() {
  const [initial, setInitial] = useState<RestoredDataState>()
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const hydrated = useRef(false)
  const [status, setStatus] = useState('正在读取独立对照草稿')
  const [failure, setFailure] = useState(false)
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef(Promise.resolve())
  const alive = useRef(true)
  const importing = useRef(false)

  const save = (raw = pending.current) => {
    if (!raw) return queue.current.then(() => true, () => false)
    queue.current = queue.current.catch(() => {}).then(() => set('active', raw, store))
    return queue.current.then(() => {
      if (pending.current === raw) pending.current = undefined
      if (alive.current) setStatus('已保存到本机对照草稿')
      return true
    }).catch(() => { if (alive.current) setStatus('保存失败，请立即导出文档备份'); return false })
  }
  useEffect(() => {
    alive.current = true
    get<string>('active', store).then(raw => decode(raw ?? JSON.stringify(empty))).then(scene => {
      if (alive.current) { setInitial(scene); setStatus('独立对照草稿已打开') }
    }).catch(() => { if (alive.current) { setStatus('草稿读取失败，未覆盖原数据'); setFailure(true) } })
    return () => { alive.current = false; clearTimeout(timer.current); void save() }
  }, [])

  const importCopy = async (file?: File) => {
    if (!file || importing.current) return
    importing.current = true
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('文档超过 32 MB，请保留原件并使用较小副本')
      const raw = await file.text()
      const scene = await decode(raw)
      // 导入前保存当前编辑；原始字节另存，SDK 恢复不覆盖原始快照。
      clearTimeout(timer.current)
      if (!await save()) throw new Error('当前草稿保存失败，停止导入以免丢失内容')
      await set(`import:${crypto.randomUUID()}`, { name: file.name, raw, importedAt: new Date().toISOString() }, store)
      await set('last-import', raw, store)
      await set('active', raw, store)
      pending.current = undefined
      api.current = null
      hydrated.current = false
      setReady(false)
      setInitial(scene)
      setRevision(value => value + 1)
      setStatus('已导入副本，原始文档快照已保留')
    } catch (error) { setStatus(error instanceof Error ? error.message : '导入失败，原草稿未替换') }
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
    const [element] = convertToExcalidrawElements([{ type: 'image', x: 120, y: 120, width: 120, height: 120, fileId: 'lab-fixture-1' as FileId, customData: { artifactId: 'lab-fixture-1' } }])
    current.addFiles([{ id: 'lab-fixture-1', dataURL: fixture, mimeType: 'image/png', created: Date.now() }] as Parameters<ExcalidrawImperativeAPI['addFiles']>[0])
    current.updateScene({ elements: [...elements, element], captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    setStatus('已插入测试素材（未调用模型）')
  }
  return <main className="gouo-canvas-lab">
    <header>
      <a href="/studio/">返回创作画布</a>
      <strong>官方 Excalidraw 对照</strong>
      <span>本机独立副本 · 不迁移原项目 · 不调用模型</span>
      <label>导入文档副本<input aria-label="导入文档副本" type="file" accept=".excalidraw,application/json" disabled={!ready} onChange={event => { void importCopy(event.target.files?.[0]); event.target.value = '' }} /></label>
      <button disabled={!ready} onClick={() => void save()}>保存对照草稿</button>
      <button disabled={!ready} onClick={() => {
        if (api.current) download(serializeAsJSON(api.current.getSceneElements(), api.current.getAppState(), api.current.getFiles(), 'local'), 'gouo-lab.excalidraw')
      }}>导出文档副本</button>
      <button onClick={() => void get<string>('last-import', store).then(raw => raw ? download(raw, 'original-import.excalidraw') : setStatus('尚未导入文档'))}>下载原始导入文件</button>
      <button disabled={!ready} onClick={insertFixture}>插入测试素材</button>
      <output role="status">{status}</output>
    </header>
    {failure && <p>请保留浏览器数据。此页面不会自动清空损坏的草稿。</p>}
    {initial && <section className="gouo-canvas-lab-editor" aria-label="官方画布">
      <Excalidraw key={revision} initialData={initial} langCode="zh-CN" excalidrawAPI={value => { api.current = value }} onChange={(elements, state, files) => {
        if (state.isLoading || !api.current || importing.current) return
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
