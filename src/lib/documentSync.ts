import type { AgentConversation, CanvasProject } from '../types'
import { useStore } from '../store'
import {
  getAllAgentConversations,
  getAllCanvasProjects,
  getAgentConversation,
  getCanvasProject,
  getCloudSyncMeta,
  putAgentConversation,
  putCanvasProject,
  putCloudSyncMeta,
} from './db'
import { getDocumentImageIds } from './documentAssets'
import { backendRequest, GouoConflictError, GouoRateLimitError, type GouoCloudAsset } from './gouoBackend'
import { uploadImage, downloadAsset } from './cloudSync'
import { isStorageScopeCurrent } from './storageScope'
import { serializeCanvasProject, validateCanvasProject } from './canvas/document'
import { markAgentPersisted, normalizeAgentConversation, useAgentStore } from '../stores/agentStore'
import { markCanvasPersisted, useCanvasStore } from '../stores/canvasStore'

type Document = CanvasProject | AgentConversation
type Kind = 'canvases' | 'conversations'
interface CloudDocument {
  client_id: string
  title: string
  revision: number
  updated_at: number
  hidden_at?: number
  document: unknown
  assets: GouoCloudAsset[]
}
interface SyncMeta {
  revision: number
  fingerprint: string
}
export interface DocumentSyncFailure {
  kind: Kind
  id: string
  title: string
  error: string
}

export function documentFingerprint(doc: Document) {
  const { cloudRevision: _revision, cloudSyncStatus: _status, cloudSyncError: _error, ...content } = 'nodes' in doc ? serializeCanvasProject(doc) : doc
  return JSON.stringify(content)
}

const read = (kind: Kind, id: string) => (kind === 'canvases' ? getCanvasProject(id) : getAgentConversation(id))
// 冲突副本与同步期间的本地编辑需要再次推送，不能标记为同步写回。
async function save(kind: Kind, doc: Document, expectedRevision?: number, fromSync = true) {
  if (kind === 'canvases') {
    await putCanvasProject(serializeCanvasProject(doc as CanvasProject), expectedRevision, fromSync)
    markCanvasPersisted(doc as CanvasProject)
  } else {
    await putAgentConversation(doc as AgentConversation, expectedRevision, fromSync)
    markAgentPersisted(doc as AgentConversation)
  }
}

function assertAccount() {
  if (!isStorageScopeCurrent()) throw new Error('账号已切换，同步已停止')
}

function currentDocument(kind: Kind, id: string, stored?: Document) {
  return (kind === 'canvases' ? useCanvasStore.getState().projects : useAgentStore.getState().conversations).find((item) => item.id === id) ?? stored
}

async function setDocumentSyncState(kind: Kind, doc: Document, status: 'synced' | 'error', error?: string, cloudRevision?: number) {
  assertAccount()
  const stored = await read(kind, doc.id)
  const current = currentDocument(kind, doc.id, stored)
  if (!current || documentFingerprint(current) !== documentFingerprint(doc)) return
  const next = { ...current, cloudSyncStatus: status, cloudSyncError: error, cloudRevision: cloudRevision ?? current.cloudRevision }
  // 同步状态只补到同一份已落库内容，不能借状态写入覆盖其他标签页或未落库编辑。
  if (
    stored &&
    documentFingerprint(stored) === documentFingerprint(next) &&
    (stored.cloudSyncStatus !== next.cloudSyncStatus || stored.cloudSyncError !== next.cloudSyncError || stored.cloudRevision !== next.cloudRevision)
  ) {
    try {
      await save(kind, next, stored.revision)
    } catch (err) {
      assertAccount()
      console.warn('保存文档同步状态失败', err)
    }
  }
  assertAccount()
  // 保存期间到达的内容编辑和运行状态优先，不能用同步提示覆盖它们。
  if (kind === 'canvases')
    useCanvasStore.setState((state) => ({
      projects: state.projects.map((item) => (item.id === doc.id && documentFingerprint(item) === documentFingerprint(doc) ? (next as CanvasProject) : item)),
    }))
  else
    useAgentStore.setState((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === doc.id && documentFingerprint(item) === documentFingerprint(doc) ? (next as AgentConversation) : item,
      ),
    }))
}

async function acceptRemote(kind: Kind, remote: CloudDocument, local?: Document) {
  if (!isStorageScopeCurrent()) throw new Error('账号已切换，同步已停止')
  if (!remote || typeof remote.client_id !== 'string' || !Number.isSafeInteger(remote.revision) || remote.revision < 1 || !Array.isArray(remote.assets))
    throw new Error('云端文档格式无效')
  const raw = remote.document
  if (kind === 'canvases') validateCanvasProject(raw)
  const normalized = kind === 'canvases' ? (raw as CanvasProject) : normalizeAgentConversation(raw)
  if (!normalized || normalized.id !== remote.client_id) throw new Error('云端文档格式无效')
  const mappedIds = new Set(remote.assets.map((asset) => asset.client_image_id))
  if (getDocumentImageIds(normalized).some((id) => !mappedIds.has(id))) throw new Error('云端文档素材映射不完整')
  for (const asset of remote.assets) {
    if (!asset.client_image_id) throw new Error('云端素材映射缺失')
    await downloadAsset(asset, asset.client_image_id)
  }
  const latest = currentDocument(kind, remote.client_id, await read(kind, remote.client_id))
  if (latest && (!local || latest.revision !== local.revision)) return false
  const doc: Document = {
    ...normalized,
    revision: Math.max(normalized.revision, (local?.revision ?? 0) + 1),
    hiddenAt: remote.hidden_at || undefined,
    cloudRevision: remote.revision,
    cloudSyncStatus: 'synced',
    cloudSyncError: undefined,
  }
  assertAccount()
  try {
    await save(kind, doc, local?.revision ?? 0)
  } catch (err) {
    assertAccount()
    const changed = await read(kind, doc.id)
    if (changed && changed.revision !== local?.revision) return false
    throw err
  }
  assertAccount()
  const afterSave = currentDocument(kind, doc.id)
  if (afterSave && (!local || afterSave.revision !== local.revision || ('status' in afterSave && afterSave.status === 'running'))) {
    const preserved = { ...afterSave, revision: Math.max(afterSave.revision, doc.revision) + 1 }
    await save(kind, preserved, undefined, false)
    if (kind === 'canvases')
      useCanvasStore.setState((state) => ({
        projects: state.projects.map((item) => (item.id === doc.id && item.revision === afterSave.revision ? (preserved as CanvasProject) : item)),
      }))
    else
      useAgentStore.setState((state) => ({
        conversations: state.conversations.map((item) =>
          item.id === doc.id && item.revision === afterSave.revision ? (preserved as AgentConversation) : item,
        ),
      }))
    return false
  }
  if (kind === 'canvases') useCanvasStore.setState((state) => ({ projects: [...state.projects.filter((item) => item.id !== doc.id), doc as CanvasProject] }))
  else useAgentStore.setState((state) => ({ conversations: [...state.conversations.filter((item) => item.id !== doc.id), doc as AgentConversation] }))
  await putCloudSyncMeta(`document:${kind}:${doc.id}`, { revision: remote.revision, fingerprint: documentFingerprint(doc) })
  return true
}

async function preserveConflict(kind: Kind, remote: CloudDocument, local: Document) {
  const latest = currentDocument(kind, local.id, await read(kind, local.id))
  if (!latest || latest.revision !== local.revision || ('status' in latest && latest.status === 'running')) throw new Error('文档正在编辑，请稍后同步')
  const copy = {
    ...local,
    id: crypto.randomUUID(),
    title: [...local.title].length <= 192 ? `${local.title}（本地冲突副本）` : local.title,
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cloudRevision: undefined,
    cloudSyncStatus: 'pending' as const,
    cloudSyncError: undefined,
  }
  assertAccount()
  await save(kind, copy, undefined, false)
  assertAccount()
  if (kind === 'canvases') useCanvasStore.setState((state) => ({ projects: [...state.projects, copy as CanvasProject] }))
  else useAgentStore.setState((state) => ({ conversations: [...state.conversations, copy as AgentConversation] }))
  await acceptRemote(kind, remote, local)
  useStore.getState().showToast('发现云端版本冲突，本地内容已保留为副本', 'info')
}

export async function syncDocuments() {
  assertAccount()
  const failures: DocumentSyncFailure[] = []
  const failed = async (kind: Kind, id: string, title: string, err: unknown, doc?: Document) => {
    assertAccount()
    if (err instanceof GouoRateLimitError) throw err
    const error = err instanceof Error ? err.message : String(err)
    failures.push({ kind, id, title, error })
    if (doc) {
      try {
        await setDocumentSyncState(kind, doc, 'error', error)
      } catch (stateError) {
        assertAccount()
        console.warn('保存文档同步错误失败', stateError)
      }
    }
  }
  for (const kind of ['canvases', 'conversations'] as const) {
    const records = kind === 'canvases' ? await getAllCanvasProjects() : await getAllAgentConversations()
    for (const stored of records) {
      if (!isStorageScopeCurrent()) throw new Error('账号已切换，同步已停止')
      const doc = currentDocument(kind, stored.id, stored)!
      if ('status' in doc && doc.status === 'running') continue
      try {
        if ([...doc.title].length > 200) throw new Error('标题超过 200 个字符，请重命名后重新同步；原内容已保留')
        const key = `document:${kind}:${doc.id}`
        const meta = await getCloudSyncMeta<SyncMeta>(key)
        const fingerprint = documentFingerprint(doc)
        // 共享同步版本可能已被其他标签页推进，上传内容必须仍与落库版本一致。
        const latest = await read(kind, doc.id)
        assertAccount()
        if (!latest || documentFingerprint(latest) !== fingerprint)
          throw new Error('文档尚未保存或已在其他标签页更新；草稿仍保留在当前页面，请先保存或导出后重新打开')
        if (meta?.fingerprint === fingerprint) continue
        const assets = []
        for (const id of getDocumentImageIds(doc)) {
          assertAccount()
          assets.push({ asset: await uploadImage(id), imageId: id })
          assertAccount()
        }
        assertAccount()
        let remote = await backendRequest<CloudDocument>(`/api/gouo/${kind}/${encodeURIComponent(doc.id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            client_id: doc.id,
            title: doc.title,
            document: JSON.parse(fingerprint),
            asset_ids: [...new Set(assets.map((item) => item.asset.id))],
            assets: assets.map((item) => ({ asset_id: item.asset.id, client_image_id: item.imageId })),
            expected_revision: meta?.revision ?? 0,
          }),
        })
        assertAccount()
        if (Boolean(doc.hiddenAt) !== Boolean(remote.hidden_at))
          remote = await backendRequest<CloudDocument>(`/api/gouo/${kind}/${encodeURIComponent(doc.id)}/${doc.hiddenAt ? 'hide' : 'restore'}`, {
            method: 'POST',
            body: JSON.stringify({ expected_revision: remote.revision }),
          })
        assertAccount()
        await putCloudSyncMeta(key, { revision: remote.revision, fingerprint })
        await setDocumentSyncState(kind, doc, 'synced', undefined, remote.revision)
      } catch (err) {
        if (err instanceof GouoConflictError && err.current) {
          try {
            await preserveConflict(kind, err.current as CloudDocument, doc)
          } catch (conflictError) {
            await failed(kind, doc.id, doc.title, conflictError, doc)
          }
        } else await failed(kind, doc.id, doc.title, err, doc)
      }
    }
    let cursor = (await getCloudSyncMeta<string>(`documents-cursor:${kind}`)) || ''
    let more = true
    let canAdvanceCursor = true
    while (more) {
      assertAccount()
      let result: { items: CloudDocument[]; next_cursor: string; has_more: boolean }
      try {
        result = await backendRequest(`/api/gouo/${kind}?cursor=${encodeURIComponent(cursor)}`)
        assertAccount()
        if (!Array.isArray(result.items) || typeof result.next_cursor !== 'string' || (result.has_more && result.next_cursor === cursor))
          throw new Error('云端文档列表无效')
      } catch (err) {
        await failed(kind, '', kind === 'canvases' ? '云端画布列表' : '云端会话列表', err)
        break
      }
      let deferred = false
      for (const remote of result.items) {
        let local: Document | undefined
        try {
          local = currentDocument(kind, remote.client_id, await read(kind, remote.client_id))
          const meta = await getCloudSyncMeta<SyncMeta>(`document:${kind}:${remote.client_id}`)
          if (meta && meta.revision >= remote.revision) continue
          if (local && (!meta || meta.fingerprint !== documentFingerprint(local))) {
            deferred = true
            continue
          }
          if (!(await acceptRemote(kind, remote, local))) deferred = true
        } catch (err) {
          deferred = true
          await failed(kind, remote.client_id, remote.title, err, local)
        }
      }
      if (deferred) canAdvanceCursor = false
      cursor = result.next_cursor
      assertAccount()
      if (canAdvanceCursor) await putCloudSyncMeta(`documents-cursor:${kind}`, cursor)
      more = result.has_more
    }
  }
  return { failures }
}
