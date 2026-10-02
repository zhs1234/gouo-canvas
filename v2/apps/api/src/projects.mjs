import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { StudioError } from './images-error.mjs'

const emptyDocument = () => ({ elements: [], appState: {}, files: {} })
export const documentSchema = z.object({ elements: z.array(z.record(z.unknown())).max(5000), appState: z.record(z.unknown()), files: z.record(z.record(z.unknown())), processedSourceIds: z.array(z.string().max(100)).max(1000).optional() }).strict()
const maxDocumentBytes = 40 * 1024 * 1024
export class Projects {
  constructor(db, history) {
    this.db = db
    this.history = history
    db.exec(`CREATE TABLE IF NOT EXISTS studio_projects (
      id TEXT PRIMARY KEY, owner INTEGER NOT NULL, title TEXT NOT NULL, revision INTEGER NOT NULL,
      document TEXT NOT NULL, source_asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(owner,source_asset_id));
      CREATE INDEX IF NOT EXISTS studio_projects_owner ON studio_projects(owner,updated_at,id);
      CREATE TABLE IF NOT EXISTS studio_assets (
      id TEXT PRIMARY KEY, owner INTEGER NOT NULL, run_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, artifact_index INTEGER NOT NULL,
      mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL,
      sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner,run_id,tool_call_id,artifact_index));`)
  }
  project(row, detail = true) {
    return { id: row.id, title: row.title, revision: row.revision, ...(detail ? { document: JSON.parse(row.document) } : {}), ...(row.source_asset_id ? { sourceAssetId: row.source_asset_id } : {}), createdAt: row.created_at, updatedAt: row.updated_at }
  }
  list(owner, offset) {
    const rows = this.db.prepare('SELECT id,title,revision,source_asset_id,created_at,updated_at FROM studio_projects WHERE owner=? ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?').all(owner, offset)
    return { items: rows.slice(0, 50).map(row => this.project(row, false)), nextOffset: rows.length > 50 ? offset + 50 : null }
  }
  get(owner, id) {
    const row = this.db.prepare('SELECT * FROM studio_projects WHERE owner=? AND id=?').get(owner, id)
    if (!row) throw new StudioError('项目不存在或无权访问', 404)
    return this.project(row)
  }
  create(owner, title = '新项目', sourceAssetId = null) {
    if (sourceAssetId) {
      this.asset(owner, sourceAssetId)
      const previous = this.db.prepare('SELECT * FROM studio_projects WHERE owner=? AND source_asset_id=?').get(owner, sourceAssetId)
      if (previous) return this.project(previous)
    }
    const id = randomUUID(), now = new Date().toISOString()
    this.db.prepare('INSERT INTO studio_projects VALUES(?,?,?,?,?,?,?,?)').run(id, owner, title, 1, JSON.stringify(emptyDocument()), sourceAssetId, now, now)
    return this.get(owner, id)
  }
  async validateDocument(owner, document) {
    if (Buffer.byteLength(JSON.stringify(document)) > maxDocumentBytes || Object.keys(document.files).length > 100) throw new StudioError('项目文档或图片数量超出限制', 413)
    for (const file of Object.values(document.files)) {
      if (file.assetId !== undefined) {
        if (typeof file.assetId !== 'string') throw new StudioError('素材引用无效', 400)
        this.asset(owner, file.assetId)
      }
      // Only embedded raster files are accepted; a project is never a URL fetch proxy.
      if (file.dataURL !== undefined) await validateImage(file.dataURL)
      else if (!file.assetId) throw new StudioError('项目图片必须包含内嵌图片或已保存素材', 400)
    }
    for (const element of document.elements) {
      if (element.assetId !== undefined) this.asset(owner, element.assetId)
      if (element.customData?.assetId !== undefined) this.asset(owner, element.customData.assetId)
      if (element.type === 'image' && element.fileId && !document.files[element.fileId]) throw new StudioError('项目图片文件缺失', 400)
    }
  }
  async patch(owner, id, body) {
    const previous = this.get(owner, id)
    if (previous.revision !== body.expectedRevision) throw new StudioError('项目已在其他窗口更新，请重新加载', 409)
    if (body.document) await this.validateDocument(owner, body.document)
    const changed = this.db.prepare('UPDATE studio_projects SET title=?,document=?,revision=revision+1,updated_at=? WHERE owner=? AND id=? AND revision=?').run(body.title ?? previous.title, JSON.stringify(body.document ?? previous.document), new Date().toISOString(), owner, id, body.expectedRevision)
    if (!changed.changes) throw new StudioError('项目已在其他窗口更新，请重新加载', 409)
    return this.get(owner, id)
  }
  asset(owner, id, content = false) {
    if (!z.string().uuid().safeParse(id).success) throw new StudioError('素材不存在或无权访问', 404)
    const row = this.db.prepare('SELECT * FROM studio_assets WHERE owner=? AND id=?').get(owner, id)
    if (!row) throw new StudioError('素材不存在或无权访问', 404)
    return { id: row.id, mimeType: row.mime_type, width: row.width, height: row.height, bytes: row.bytes.length, sha256: row.sha256, createdAt: row.created_at, ...(content ? { dataURL: `data:${row.mime_type};base64,${Buffer.from(row.bytes).toString('base64')}` } : {}) }
  }
  async fromRun(owner, { runId, toolCallId, artifactIndex }) {
    const run = this.history.getRun(owner, runId)
    const old = this.db.prepare('SELECT id FROM studio_assets WHERE owner=? AND run_id=? AND tool_call_id=? AND artifact_index=?').get(owner, runId, toolCallId, artifactIndex)
    if (old) return this.asset(owner, old.id)
    const artifact = run.events.find(event => event.type === 'tool.completed' && event.toolCallId === toolCallId)?.artifacts?.[artifactIndex]
    if (artifact?.type !== 'image') throw new StudioError('任务中没有该图片结果', 404)
    const { bytes, metadata } = await validateImage(artifact.url)
    const id = randomUUID(), now = new Date().toISOString()
    // INSERT OR IGNORE also protects simultaneous materializations across awaited decoding.
    this.db.prepare('INSERT OR IGNORE INTO studio_assets VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, runId, toolCallId, artifactIndex, `image/${metadata.format}`, metadata.width, metadata.height, bytes, createHash('sha256').update(bytes).digest('hex'), now)
    const saved = this.db.prepare('SELECT id FROM studio_assets WHERE owner=? AND run_id=? AND tool_call_id=? AND artifact_index=?').get(owner, runId, toolCallId, artifactIndex)
    return this.asset(owner, saved.id)
  }
  saveImage(owner, runId, prepared) {
    const { bytes, metadata } = prepared, id = randomUUID(), now = new Date().toISOString()
    this.db.prepare('INSERT OR IGNORE INTO studio_assets VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, runId, 'image-job', 0,
      `image/${metadata.format}`, metadata.width, metadata.height, bytes, createHash('sha256').update(bytes).digest('hex'), now)
    const saved = this.db.prepare("SELECT id FROM studio_assets WHERE owner=? AND run_id=? AND tool_call_id='image-job' AND artifact_index=0").get(owner, runId)
    return this.asset(owner, saved.id)
  }
  verifySavedImage(owner, id) {
    const asset = this.asset(owner, id, true)
    const bytes = Buffer.from(asset.dataURL.slice(asset.dataURL.indexOf(',') + 1), 'base64')
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new StudioError('已保存原图完整性校验失败，未重新生成', 502)
    return asset
  }
}
export async function validateImage(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > 40 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) throw new StudioError('仅支持有效的内嵌 PNG、JPEG、WebP 图片', 400)
  const encoded = dataURL.slice(dataURL.indexOf(',') + 1), bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.length > 30 * 1024 * 1024 || bytes.toString('base64') !== encoded) throw new StudioError('图片编码或大小无效', 400)
  const { metadata } = await validateImageBytes(bytes)
  if (!dataURL.startsWith(`data:image/${metadata.format};base64,`)) throw new StudioError('图片 MIME 与内容不一致', 400)
  return { bytes, metadata }
}
export async function validateImageBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 30 * 1024 * 1024) throw new StudioError('图片编码或大小无效', 400)
  let metadata
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000 })
    metadata = await image.metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error('unsupported')
    await image.stats() // Decode all image bytes, not merely a plausible header.
  } catch { throw new StudioError('图片内容无效或超过 2400 万像素', 400) }
  return { bytes, metadata }
}
