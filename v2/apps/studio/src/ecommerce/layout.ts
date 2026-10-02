import { convertToExcalidrawElements, FONT_FAMILY, getCommonBounds, exportToBlob, newElementWith, getNonDeletedElements, elementsOverlappingBBox } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, ExcalidrawImageElement, ExcalidrawFrameElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

export const presets = [{ name: '方形', width: 1024, height: 1024 }, { name: '竖版', width: 1200, height: 1600 }, { name: '横版', width: 1600, height: 900 }] as const
export type LayoutInput = { width: number; height: number; title: string; price: string; points: string; brand: string }
export class LayoutError extends Error {}

export function validateSize(width: number, height: number) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 100 && value <= 4096)) throw new LayoutError('宽和高必须是 100–4096 的整数像素。')
}

export async function readyImages(elements: readonly ExcalidrawElement[], files: BinaryFiles) {
  if (elements.some(element => element.type === 'image' && !element.fileId)) throw new LayoutError('图片缺少本地原文件，当前文档未更改。')
  for (const fileId of new Set(elements.flatMap(element => element.type === 'image' && element.fileId ? [element.fileId] : []))) {
    const file = files[fileId]
    if (!file || !/^data:image\/(?:png|jpeg|webp);base64,/.test(file.dataURL)) throw new LayoutError('请使用内嵌的 PNG、JPEG 或 WebP 商品图片；当前文档未更改。')
    if (file.dataURL.slice(file.dataURL.indexOf(',') + 1).length > 40 * 1024 * 1024) throw new LayoutError('商品原文件超过 40 MiB 编码大小，请先缩小图片。')
    const image = new Image()
    image.src = file.dataURL
    try {
      await image.decode()
      if (!image.naturalWidth || !image.naturalHeight) throw new Error()
      if (image.naturalWidth * image.naturalHeight > 24_000_000) throw new LayoutError('商品图片超过 2400 万像素，请先缩小图片。')
    }
    catch (error) { throw error instanceof LayoutError ? error : new LayoutError('图片尚未就绪或不能解码，当前文档未更改。') }
    finally { image.src = '' }
  }
  await document.fonts.ready
}

export function selectedProduct(elements: readonly ExcalidrawElement[], state: AppState) {
  const selected = elements.filter(element => !element.isDeleted && state.selectedElementIds[element.id] && element.type === 'image') as ExcalidrawImageElement[]
  if (selected.length > 1) throw new LayoutError('请只选择一张商品图片；取消图片选择可创建空版式。')
  return selected[0]
}

export function createLayout(input: LayoutInput, x: number, y: number, product?: ExcalidrawImageElement) {
  validateSize(input.width, input.height)
  if (input.title.length > 80 || input.price.length > 40 || input.points.length > 180 || input.brand.length > 40) throw new LayoutError('文字过长，请缩短内容后创建版式。')
  const { width, height } = input
  const frameId = crypto.randomUUID(), padding = Math.min(width, height) * .06
  const role = (value: string) => ({ ecommerceRole: value })
  type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number]
  const children: Skeleton[] = [{ type: 'rectangle', id: crypto.randomUUID(), x, y, width, height, backgroundColor: '#ffffff', fillStyle: 'solid', strokeColor: 'transparent', strokeWidth: 1, roughness: 0, locked: true, customData: role('background') }]
  const productBox = { x: x + padding, y: y + height * .16, width: width - 2 * padding, height: height * .49 }
  if (product) {
    if (!product.fileId) throw new LayoutError('商品图片缺少本地原文件，当前图片未更改。')
    const [x1, y1, x2, y2] = getCommonBounds([product])
    if (![product.width, product.height, x2 - x1, y2 - y1].every(value => Number.isFinite(value) && value > 0)) throw new LayoutError('商品图片尺寸无效，当前图片未更改。')
    const scale = Math.min(productBox.width / (x2 - x1), productBox.height / (y2 - y1))
    const imageWidth = product.width * scale, imageHeight = product.height * scale
    children.push({ type: 'image', id: crypto.randomUUID(), x: productBox.x + (productBox.width - imageWidth) / 2, y: productBox.y + (productBox.height - imageHeight) / 2, width: imageWidth, height: imageHeight, fileId: product.fileId, angle: product.angle, crop: product.crop ? { ...product.crop } : null, scale: [...product.scale], opacity: product.opacity, status: product.status, customData: { ...role('product'), sourceElementId: product.id } })
  } else {
    children.push({ type: 'rectangle', id: crypto.randomUUID(), ...productBox, strokeColor: '#d1d5db', strokeStyle: 'dashed', strokeWidth: 1, roughness: 0, customData: role('empty-product') })
  }
  const font = Math.max(12, Math.min(64, Math.min(width, height) * .045))
  const text = (textRole: string, value: string, top: number, fontSize: number, color = '#111827') => children.push({ type: 'rectangle', id: crypto.randomUUID(), x: x + padding, y: y + height * top, width: width - 2 * padding, height: fontSize * 1.4, strokeColor: 'transparent', strokeWidth: 1, roughness: 0, customData: role(`${textRole}-container`), label: { text: value, fontFamily: FONT_FAMILY.Helvetica, fontSize, strokeColor: color, textAlign: 'left', verticalAlign: 'top', customData: role(textRole) } })
  text('brand', input.brand || '品牌', .04, font * .55, '#6b7280')
  text('title', input.title || '商品标题', .69, font)
  text('price', input.price || '价格', .79, font * .9, '#b91c1c')
  text('points', input.points || '卖点一 · 卖点二', .89, font * .5, '#4b5563')
  if (!product) text('empty-notice', '商品图片区域（尚未选择图片）', .38, font * .4, '#9ca3af')
  const frame: Skeleton = { type: 'frame', id: frameId, x, y, width, height, name: `电商${product ? '版式' : '空版式'} ${width} × ${height}`, children: children.map(element => element.id!), customData: role('layout') }
  // The native converter assigns frameId and text metrics; all source elements/files stay untouched.
  // The converter infers a zero x/y from children; restore explicit frame bounds through the native helper.
  const elements = convertToExcalidrawElements([...children, frame], { regenerateIds: false }).map(element => element.id === frameId ? newElementWith(element, { x, y, width, height }) : element)
  return { elements, frame: elements.find(element => element.id === frameId) as ExcalidrawFrameElement }
}

export function selectedFrame(elements: readonly ExcalidrawElement[], state: AppState) {
  const frames = elements.filter(element => !element.isDeleted && element.type === 'frame' && state.selectedElementIds[element.id]) as ExcalidrawFrameElement[]
  if (frames.length !== 1) throw new LayoutError('请先在画布上选择一个画框，再导出 PNG。')
  const frame = frames[0]
  validateSize(frame.width, frame.height)
  if (frame.angle !== 0) throw new LayoutError('请使用未旋转的画框导出精确尺寸 PNG。')
  return frame
}

export async function exportFrame(elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles, frame: ExcalidrawFrameElement) {
  validateSize(frame.width, frame.height)
  const snapshot = structuredClone(getNonDeletedElements(elements))
  // Match the SDK's frame overlap rule for image readiness; let native export perform the clipping.
  const overlaps: readonly ExcalidrawElement[] = elementsOverlappingBBox({ elements: snapshot, bounds: frame, type: 'overlap' })
  await readyImages(overlaps.filter(element => !element.frameId || element.frameId === frame.id), files)
  // SDK export waits for scene fonts and image rendering. Scale 1 keeps the native frame's pixel dimensions.
  return exportToBlob({ elements: snapshot, files, appState: { ...state, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false, viewBackgroundColor: '#ffffff', exportScale: 1 }, exportingFrame: frame, exportPadding: 0, getDimensions: () => ({ width: frame.width, height: frame.height, scale: 1 }), mimeType: 'image/png' })
}
