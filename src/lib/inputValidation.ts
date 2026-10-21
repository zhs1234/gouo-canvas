import { fileToDataUrl } from './dataUrl'
import { getMaxUploadBytes } from './gouoBackend'

// 与服务端图片接口的提示词上限一致（gpt-image 系列上游同为 32000 字符）
export const MAX_PROMPT_LENGTH = 32000

// 服务端用 utf8.RuneCountInString 按 Unicode 码点计数。JS 的 String.length 按 UTF-16 码元计数，表情等非 BMP 字符会算成 2，合法提示词会被提前拒绝。
export function promptCodePointLength(text: string) {
  return [...text].length
}

// 参考图会原样转发给上游编辑接口，只收上游普遍支持的格式；服务端按文件内容同样校验
export const REFERENCE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

// 单张参考图上限；后台设置的上传上限更小时以后台为准
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

export function getReferenceImageMaxBytes() {
  return Math.min(MAX_REFERENCE_IMAGE_BYTES, getMaxUploadBytes())
}

// 错误提示只显示一行，过长的文件名截断，避免整条提示被折叠成"操作失败"
function shortName(name: string) {
  return name.length > 24 ? `${name.slice(0, 12)}…${name.slice(-8)}` : name
}

export function getReferenceImageIssue(file: Pick<File, 'name' | 'type' | 'size'>) {
  // 部分安卓选择器和拖拽来源不带类型，留给读取时按文件头判断
  if (file.type && !REFERENCE_IMAGE_TYPES.includes(file.type)) return `「${shortName(file.name)}」格式不支持，请上传 PNG、JPEG 或 WebP 图片`
  const max = getReferenceImageMaxBytes()
  if (file.size > max) return `「${shortName(file.name)}」超过 ${Math.floor(max / 1024 / 1024)} MB，请压缩后再上传`
  return ''
}

// 按文件头判断实际格式。createImageBitmap 只证明能解码，改了扩展名的 GIF 也会通过，但服务端会拒绝。
export function sniffReferenceImageType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return ''
}

// 扩展名伪造或内容损坏的文件直接拒绝，不写入图库，免得参考图栏留下裂图
export async function readReferenceImageFile(file: File) {
  const issue = getReferenceImageIssue(file)
  if (issue) throw new Error(issue)
  const type = sniffReferenceImageType(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  if (!type) throw new Error(`「${shortName(file.name)}」格式不支持，请上传 PNG、JPEG 或 WebP 图片`)
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
  } catch {
    throw new Error(`「${shortName(file.name)}」无法识别为图片，请重新上传`)
  }
  return fileToDataUrl(new File([file], file.name, { type }))
}

// 数量输入框的草稿只在是 1 到上限的整数时才写入参数
export function parseImageCount(value: string, max: number) {
  if (!value.trim()) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null
}

export function appendPrompt(current: string, text: string) {
  return current.trim() ? `${current.trimEnd()}\n\n${text}` : text
}
