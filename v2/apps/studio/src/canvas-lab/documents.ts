import { loadFromBlob } from '@excalidraw/excalidraw'

export type LegacyDraft = {
  canvas: { id: string; name: string; content: { elements: Record<string, unknown>[]; appState: Record<string, unknown>; files: Record<string, Record<string, unknown>> } }
  sessions: unknown[]
  messages: Record<string, unknown>
  thumbnail?: Blob
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function isLegacyDraft(value: unknown): value is LegacyDraft {
  if (!object(value) || !object(value.canvas) || !object(value.canvas.content)) return false
  const { canvas } = value
  const content = canvas.content as Record<string, unknown>
  return typeof canvas.id === 'string' && typeof canvas.name === 'string' && Array.isArray(content.elements)
    && object(content.appState) && object(content.files) && Array.isArray(value.sessions) && object(value.messages)
}
export async function decodeDocument(raw: string) {
  const original: unknown = JSON.parse(raw)
  const legacy = isLegacyDraft(original)
  const data = legacy ? { type: 'excalidraw', version: 2, ...original.canvas.content } : original
  if (!object(data) || data.type !== 'excalidraw' || !Array.isArray(data.elements) || typeof data.version !== 'number') {
    throw new Error('请选择 Excalidraw 或 Loomic 草稿副本；不支持直接导入 Fabric 或其他画布格式')
  }
  const elements = data.elements
  const files = object(data.files) ? data.files : {}
  for (const element of elements) {
    if (!object(element)) throw new Error('文档包含无效元素，原草稿未替换')
    if (element.type === 'image' && !element.isDeleted) {
      const file = typeof element.fileId === 'string' ? files[element.fileId] : undefined
      if (!object(file) || typeof file.dataURL !== 'string' || !file.dataURL.startsWith('data:image/')) {
        throw new Error('文档缺少内嵌图片文件，停止导入以免丢失素材')
      }
    }
  }
  const scene = await loadFromBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), null, null)
  const restored = new Map(scene.elements.map(element => [element.id, element]))
  if (elements.some(element => !element.isDeleted && (typeof element.id !== 'string' || restored.get(element.id)?.type !== element.type))) {
    throw new Error('文档含无法无损恢复的元素，保留原件并使用原编辑器打开')
  }
  return { scene, legacy }
}

// 只读取当前 scope 的旧默认数据库；不存在时不创建，所有查询使用 readonly 事务。
export async function readLegacyDrafts(owner: string): Promise<Array<{ key: string; draft: LegacyDraft }>> {
  if (!/^local:(guest|[1-9]\d*)$/.test(owner)) throw new Error('本地账号范围无效')
  if (!indexedDB.databases) throw new Error('当前浏览器不支持安全检查旧数据库，请从原画布导出文件再导入')
  if (!(await indexedDB.databases()).some(database => database.name === 'keyval-store')) return []
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('keyval-store')
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => reject(new Error('旧草稿只读打开失败，未修改数据'))
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('keyval')) { db.close(); resolve([]); return }
      const tx = db.transaction('keyval', 'readonly')
      const rows: Array<{ key: string; draft: LegacyDraft }> = []
      const cursor = tx.objectStore('keyval').openCursor()
      const prefix = `gouo:loomic:v1:${owner}:`
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (!entry) return
        if (typeof entry.key === 'string' && entry.key.startsWith(prefix) && isLegacyDraft(entry.value)) rows.push({ key: entry.key, draft: entry.value })
        entry.continue()
      }
      tx.oncomplete = () => { db.close(); resolve(rows) }
      tx.onabort = tx.onerror = () => { db.close(); reject(new Error('旧草稿读取失败，未修改数据')) }
    }
  })
}
