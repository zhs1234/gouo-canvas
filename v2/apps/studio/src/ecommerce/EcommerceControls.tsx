import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaptureUpdateAction, getCommonBounds, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { getIdentityEpoch } from '../api'
import { createLayout, exportFrame, LayoutError, presets, readyImages, selectedFrame, selectedProduct, validateSize } from './layout'
import './ecommerce.css'

type Props = { api: ExcalidrawImperativeAPI | null; scope: string; ready: boolean; canEdit: boolean; isEditable?: () => boolean; documentBackup?: () => string | undefined }
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function EcommerceControls(props: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [size, setSize] = useState({ width: '1024', height: '1024' })
  const [words, setWords] = useState({ title: '', price: '', points: '', brand: '' })
  const dialog = useRef<HTMLDialogElement>(null), mounted = useRef(false), working = useRef(false), epoch = useRef(0), current = useRef(props)
  if (current.current.api !== props.api || current.current.scope !== props.scope) epoch.current++
  current.current = props
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++ } }, [])
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])

  const run = async (mutation: boolean, operation: (api: ExcalidrawImperativeAPI, assertCurrent: () => void) => Promise<string>) => {
    if (working.current) return
    const at = epoch.current, identity = getIdentityEpoch(), api = current.current.api
    const assertCurrent = () => {
      const now = current.current
      if (!mounted.current || epoch.current !== at || getIdentityEpoch() !== identity || now.api !== api || !api || !now.ready || (mutation && (!now.canEdit || now.isEditable?.() === false || api.getAppState().viewModeEnabled))) throw new LayoutError('画布或账号已变化，请重新打开电商版式。')
    }
    working.current = true; setBusy(true); setMessage('')
    try { assertCurrent(); const text = await operation(api!, assertCurrent); assertCurrent(); setMessage(text) }
    catch (error) { if (mounted.current && epoch.current === at) setMessage(error instanceof LayoutError ? error.message : '操作失败，当前画布未替换。请导出画布文档备份后重试。') }
    finally { working.current = false; if (mounted.current && epoch.current === at) setBusy(false) }
  }
  const create = () => void run(true, async (api, assertCurrent) => {
    const width = Number(size.width), height = Number(size.height)
    validateSize(width, height)
    const selected = selectedProduct(api.getSceneElements(), api.getAppState())
    const product = selected ? structuredClone(selected) : undefined
    const productFile = product?.fileId ? api.getFiles()[product.fileId]?.dataURL : undefined
    await readyImages(product ? [product] : [], api.getFiles())
    assertCurrent()
    const existing = api.getSceneElementsIncludingDeleted(), view = api.getAppState()
    if (product && (!existing.some(element => element.id === product.id && !element.isDeleted && element.version === product.version && element.versionNonce === product.versionNonce) || !product.fileId || api.getFiles()[product.fileId]?.dataURL !== productFile)) throw new LayoutError('商品图片已变化，请重新选择后创建。')
    // Place the new frame beside all existing elements, so it never absorbs an original image into its membership.
    const visible = existing.filter(element => !element.isDeleted)
    const right = visible.length ? Math.max(0, getCommonBounds(visible)[2]) : 0
    const result = createLayout({ width, height, ...words }, right + 100, view.height / (2 * view.zoom.value) - view.scrollY - height / 2, product)
    assertCurrent()
    api.updateScene({ elements: [...existing, ...result.elements], appState: { selectedElementIds: { [result.frame.id]: true }, selectedGroupIds: {} }, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    api.scrollToContent(result.frame, { fitToContent: true, animate: false })
    return product ? '已创建可编辑版式。商品图片是原文件的副本；可关闭面板后双击文字修改。' : '已创建空版式，尚未选择商品图片；文字是可编辑占位内容。'
  })
  const exportPNG = () => void run(false, async (api, assertCurrent) => {
    const elements = api.getSceneElements(), state = api.getAppState(), frame = selectedFrame(elements, state)
    const files = Object.fromEntries(Object.entries(api.getFiles()).map(([id, file]) => [id, { ...file }]))
    const blob = await exportFrame(elements, state, files, { ...frame })
    assertCurrent()
    download(blob, `ecommerce-${frame.width}x${frame.height}.png`)
    return `已导出 ${frame.width} × ${frame.height} 像素 PNG。`
  })
  const backup = () => {
    const api = current.current.api
    if (!mounted.current || !api || !current.current.ready) return
    try {
      const raw = current.current.documentBackup ? current.current.documentBackup() : serializeAsJSON(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles(), 'local')
      if (!raw) throw new Error()
      download(new Blob([raw], { type: 'application/json' }), 'ecommerce-backup.excalidraw')
    }
    catch { setMessage('文档备份导出失败，请保留当前画布。') }
  }
  return <>
    <button className="ecommerce-entry" aria-label="电商版式" disabled={!props.ready} onClick={() => { setMessage(''); setOpen(true) }}>电商版式</button>
    {createPortal(<dialog ref={dialog} className="ecommerce-dialog" aria-label="电商版式与导出" onKeyDown={event => event.stopPropagation()} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <div className="ecommerce-heading"><strong>电商版式与导出</strong><button aria-label="关闭电商版式" onClick={() => setOpen(false)}>关闭</button></div>
      <p>选择一张商品图片会复制原图；没有选择图片时创建空版式。所有文字都可在画布上双击编辑。</p>
      <form onSubmit={event => { event.preventDefault(); create() }}>
        <fieldset disabled={busy || !props.canEdit}><legend>新建版式尺寸</legend>
          <div className="ecommerce-presets">{presets.map(preset => <button key={preset.name} type="button" onClick={() => setSize({ width: String(preset.width), height: String(preset.height) })}>{preset.name} {preset.width} × {preset.height}</button>)}</div>
          <div className="ecommerce-size"><label>宽（像素）<input aria-label="版式宽度" type="number" min="100" max="4096" step="1" required value={size.width} onChange={event => setSize({ ...size, width: event.target.value })} /></label><label>高（像素）<input aria-label="版式高度" type="number" min="100" max="4096" step="1" required value={size.height} onChange={event => setSize({ ...size, height: event.target.value })} /></label></div>
          <small>每边 100–4096 整数像素；预设为常用版式，具体尺寸以你的用途为准。</small>
          <label>标题<input aria-label="版式标题" maxLength={80} placeholder="留空使用「商品标题」占位文字" value={words.title} onChange={event => setWords({ ...words, title: event.target.value })} /></label>
          <label>价格<input aria-label="版式价格" maxLength={40} placeholder="留空使用「价格」占位文字" value={words.price} onChange={event => setWords({ ...words, price: event.target.value })} /></label>
          <label>卖点<textarea aria-label="版式卖点" maxLength={180} rows={2} placeholder="可换行；留空使用占位文字" value={words.points} onChange={event => setWords({ ...words, points: event.target.value })} /></label>
          <label>品牌<input aria-label="版式品牌" maxLength={40} placeholder="留空使用「品牌」占位文字" value={words.brand} onChange={event => setWords({ ...words, brand: event.target.value })} /></label>
          <button type="submit">{busy ? '正在处理…' : '创建可编辑版式'}</button>
        </fieldset>
      </form>
      {!props.canEdit && <p role="alert">当前画布保存已暂停或不能编辑。请先保存备份并恢复画布后再创建版式。</p>}
      <div className="ecommerce-exports"><button disabled={busy || !props.ready} onClick={exportPNG}>导出所选画框 PNG</button><button disabled={!props.ready} onClick={backup}>导出画布文档备份</button></div>
      <p>PNG 按所选画框的当前整数尺寸导出，无额外边距。导出失败仍可保存文档备份。</p>
      {message && <output role="status" className="ecommerce-message">{message}</output>}
    </dialog>, document.body)}
  </>
}
