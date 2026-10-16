import { fileToDataUrl } from './dataUrl'
import { getMaxUploadBytes } from './gouoBackend'

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
  if (!REFERENCE_IMAGE_TYPES.includes(file.type)) return `「${shortName(file.name)}」格式不支持，请上传 PNG、JPEG 或 WebP 图片`
  const max = getReferenceImageMaxBytes()
  if (file.size > max) return `「${shortName(file.name)}」超过 ${Math.floor(max / 1024 / 1024)} MB，请压缩后再上传`
  return ''
}

// 扩展名伪造或内容损坏的文件解码失败，直接拒绝，不写入图库，免得参考图栏留下裂图
export async function readReferenceImageFile(file: File) {
  const issue = getReferenceImageIssue(file)
  if (issue) throw new Error(issue)
  try {
    const bitmap = await createImageBitmap(file)
    bitmap.close()
  } catch {
    throw new Error(`「${shortName(file.name)}」无法识别为图片，请重新上传`)
  }
  return fileToDataUrl(file)
}
