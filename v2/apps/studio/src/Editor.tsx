import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Textbox } from 'fabric'
import { Button, Notice, Panel } from '@gouo/ui'

export default function Editor() {
  const element = useRef<HTMLCanvasElement>(null)
  const canvas = useRef<Canvas | null>(null)
  const lifecycle = useRef<Promise<unknown>>(Promise.resolve())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('商品卖点')
  useEffect(() => {
    let active = true
    let instance: Canvas | undefined
    setReady(false)
    // StrictMode re-mount must wait for Fabric's asynchronous disposal.
    lifecycle.current = lifecycle.current.then(() => {
      if (!active || !element.current) return
      instance = new Canvas(element.current, { width: 640, height: 640, backgroundColor: '#ffffff', preserveObjectStacking: true })
      canvas.current = instance
      setReady(true)
    }).catch(() => { if (active) setError('编辑器初始化失败') })
    return () => {
      active = false
      if (canvas.current === instance) canvas.current = null
      lifecycle.current = lifecycle.current.then(async () => { if (instance) await instance.dispose() })
    }
  }, [])
  async function addImage(file?: File) {
    const target = canvas.current
    if (!file || !target) return
    setError('')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setError('请选择不超过 15MB 的 PNG、JPEG 或 WebP 图片'); return
    }
    setBusy(true)
    const url = URL.createObjectURL(file)
    try {
      const bitmap = await createImageBitmap(file)
      const tooLarge = bitmap.width * bitmap.height > 24_000_000
      bitmap.close()
      if (tooLarge) throw new Error('图片像素过大，请压缩至 2400 万像素以内')
      const image = await FabricImage.fromURL(url)
      if (canvas.current !== target) return
      image.scale(Math.min(520 / image.width, 520 / image.height, 1))
      target.add(image); target.centerObject(image); target.setActiveObject(image); target.requestRenderAll()
    } catch (e) { setError(e instanceof Error ? e.message : '图片导入失败') }
    finally { URL.revokeObjectURL(url); setBusy(false) }
  }
  function addText() {
    const target = canvas.current
    if (!target || !text.trim()) return
    const item = new Textbox(text.trim(), { left: 60, top: 50, width: 520, fontSize: 36, fill: '#182630', fontFamily: 'sans-serif' })
    target.add(item); target.setActiveObject(item); target.requestRenderAll()
  }
  function removeSelection() {
    const target = canvas.current
    if (!target) return
    target.getActiveObjects().forEach((item) => target.remove(item))
    target.discardActiveObject(); target.requestRenderAll()
  }
  function exportPng() {
    const target = canvas.current
    if (!target) return
    try {
      target.discardActiveObject(); target.requestRenderAll()
      const link = document.createElement('a')
      link.download = 'gouo-design-1280.png'
      link.href = target.toDataURL({ format: 'png', multiplier: 2 })
      link.click()
    } catch { setError('导出失败，请检查图片与浏览器内存') }
  }
  return <Panel title="本地商品图编辑器">
    <Notice>此处只处理本机图片，不上传、不调用 AI、不扣费。离开页面会丢失当前画布，请先导出。</Notice>
    <div className="editor-toolbar">
      <label className="upload">导入商品图片<input aria-label="导入商品图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={!ready || busy} onChange={(e) => { void addImage(e.target.files?.[0]); e.target.value = '' }} /></label>
      <label>文字内容<input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} /></label>
      <Button onClick={addText} disabled={!ready || busy}>添加文字</Button>
      <Button onClick={removeSelection} disabled={!ready || busy}>删除选中</Button>
      <Button onClick={exportPng} disabled={!ready || busy}>导出 PNG</Button>
    </div>
    {error && <Notice error>{error}</Notice>}
    <div className="canvas-scroll"><canvas ref={element} aria-label="商品设计画布" /></div>
    <p className="muted">点击选择对象，拖动位置与控制点；双击文字编辑。支持多选删除。模板、撤销重做和云保存见 E1 任务。</p>
  </Panel>
}
