import type { AgentConversation, CanvasProject } from '../types'
import { useStore } from '../store'
import { getAllAgentConversations, getAllCanvasProjects, getAgentConversation, getCanvasProject, getCloudMeta, putAgentConversation, putCanvasProject, putCloudMeta } from './db'
import { getDocumentImageIds } from './documentAssets'
import { backendRequest, GouoConflictError, type GouoCloudAsset } from './gouoBackend'
import { downloadAsset, uploadImage } from './serverLibrary'
import { isStorageScopeCurrent } from './storageScope'
import { serializeCanvasProject, validateCanvasProject } from './canvas/document'
import { markAgentPersisted, normalizeAgentConversation, useAgentStore } from '../stores/agentStore'
import { markCanvasPersisted, useCanvasStore } from '../stores/canvasStore'

// 画布与会话以服务端为准：本地保存后直接写到服务端，打开时读取服务端的新版本。
type Document = CanvasProject | AgentConversation
type Kind = 'canvases' | 'conversations'
interface CloudDocument {
  client_id: string
  title: string
  revision: number
  hidden_at?: number
  document: unknown
  assets: GouoCloudAsset[]
}
// 最近一次与服务端一致时的服务端版本号和本地内容指纹。
interface SavedState {
  revision: number
  fingerprint: string
}

const KINDS = ['canvases', 'conversations'] as const
let pushing: Promise<void> | null = null
let pushAgain = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
const reportedErrors = new Set<string>()

export function documentFingerprint(doc: Document) {
  const { cloudRevision: _revision, cloudSyncStatus: _status, cloudSyncError: _error, ...content } = ('nodes' in doc ? serializeCanvasProject(doc) : doc) as Document & Record<string, unknown>
  return JSON.stringify(content)
}

const metaKey = (kind: Kind, id: string) => `document:${kind}:${id}`
const readLocal = (kind: Kind, id: string): Promise<Document | undefined> => (kind === 'canvases' ? getCanvasProject(id) : getAgentConversation(id))
const inMemory = (kind: Kind, id: string): Document | undefined => (kind === 'canvases' ? useCanvasStore.getState().projects : useAgentStore.getState().conversations).find((item) => item.id === id)

async function writeLocal(kind: Kind, doc: Document, expectedRevision: number, fromServer: boolean) {
  if (kind === 'canvases') {
    await putCanvasProject(serializeCanvasProject(doc as CanvasProject), expectedRevision, fromServer)
    markCanvasPersisted(doc as CanvasProject)
    useCanvasStore.setState((state) => ({ projects: [...state.projects.filter((item) => item.id !== doc.id), doc as CanvasProject] }))
    return
  }
  await putAgentConversation(doc as AgentConversation, expectedRevision, fromServer)
  markAgentPersisted(doc as AgentConversation)
  useAgentStore.setState((state) => ({ conversations: [...state.conversations.filter((item) => item.id !== doc.id), doc as AgentConversation] }))
}

function reportOnce(key: string, message: string) {
  if (reportedErrors.has(key)) return
  reportedErrors.add(key)
  useStore.getState().showToast(message, 'error')
}

// 采用服务端版本；本地有未保存到服务端的改动时，先另存为副本，避免覆盖。
async function acceptRemote(kind: Kind, remote: CloudDocument) {
  const raw = remote.document
  if (kind === 'canvases') validateCanvasProject(raw)
  const normalized = kind === 'canvases' ? (raw as CanvasProject) : normalizeAgentConversation(raw)
  if (!normalized || normalized.id !== remote.client_id) throw new Error('云端文档格式无效')
  const local = await readLocal(kind, remote.client_id)
  const memory = inMemory(kind, remote.client_id)
  // 内存中还有未落库的编辑，或会话正在运行：本次跳过，下次再读取。
  if (memory && local && memory.revision !== local.revision) return false
  if (memory && 'status' in memory && memory.status === 'running') return false
  const saved = await getCloudMeta<SavedState>(metaKey(kind, remote.client_id))
  if (local && saved?.fingerprint !== documentFingerprint(local)) {
    const copy = { ...local, id: crypto.randomUUID(), title: [...local.title].length <= 192 ? `${local.title}（本地冲突副本）` : local.title, revision: 1, createdAt: Date.now(), updatedAt: Date.now() }
    await writeLocal(kind, copy, 0, false)
    useStore.getState().showToast('其他设备修改了同一份内容，本地版本已另存为副本', 'info')
  }
  for (const asset of remote.assets) {
    if (!asset.client_image_id) throw new Error('云端素材映射缺失')
    await downloadAsset(asset, asset.client_image_id)
  }
  if (!isStorageScopeCurrent()) throw new Error('账号已切换')
  const doc = { ...normalized, revision: Math.max(normalized.revision, (local?.revision ?? 0) + 1), hiddenAt: remote.hidden_at || undefined } as Document
  await writeLocal(kind, doc, local?.revision ?? 0, true)
  await putCloudMeta(metaKey(kind, doc.id), { revision: remote.revision, fingerprint: documentFingerprint(doc) })
  return true
}

async function pushDocument(kind: Kind, doc: Document) {
  const saved = await getCloudMeta<SavedState>(metaKey(kind, doc.id))
  const fingerprint = documentFingerprint(doc)
  if (saved?.fingerprint === fingerprint) return
  if ([...doc.title].length > 200) throw new Error('标题超过 200 个字符，请重命名后再保存到服务器')
  const assets = []
  for (const id of getDocumentImageIds(doc)) assets.push({ asset: await uploadImage(id), imageId: id })
  let remote: CloudDocument
  try {
    remote = await backendRequest<CloudDocument>(`/api/gouo/${kind}/${encodeURIComponent(doc.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        client_id: doc.id,
        title: doc.title,
        document: JSON.parse(fingerprint),
        asset_ids: [...new Set(assets.map((item) => item.asset.id))],
        assets: assets.map((item) => ({ asset_id: item.asset.id, client_image_id: item.imageId })),
        expected_revision: saved?.revision ?? 0,
      }),
    })
  } catch (err) {
    if (err instanceof GouoConflictError && err.current) {
      await acceptRemote(kind, err.current as CloudDocument)
      return
    }
    throw err
  }
  if (Boolean(doc.hiddenAt) !== Boolean(remote.hidden_at)) {
    remote = await backendRequest<CloudDocument>(`/api/gouo/${kind}/${encodeURIComponent(doc.id)}/${doc.hiddenAt ? 'hide' : 'restore'}`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: remote.revision }),
    })
  }
  await putCloudMeta(metaKey(kind, doc.id), { revision: remote.revision, fingerprint })
  reportedErrors.delete(`${kind}:${doc.id}`)
}

// 把与服务端不一致的本地文档写上去；失败的文档稍后自动重试。
export function pushDocuments(): Promise<void> {
  if (pushing) {
    pushAgain = true
    return pushing
  }
  pushing = (async () => {
    let failed = false
    do {
      pushAgain = false
      for (const kind of KINDS) {
        const records = kind === 'canvases' ? await getAllCanvasProjects() : await getAllAgentConversations()
        for (const doc of records) {
          if (!isStorageScopeCurrent()) return
          if ('status' in doc && doc.status === 'running') continue
          try {
            await pushDocument(kind, doc)
          } catch (err) {
            failed = true
            console.warn('文档保存到服务器失败', doc.id, err)
            reportOnce(`${kind}:${doc.id}`, `「${doc.title}」未能保存到服务器，已保留在本地，稍后自动重试：${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }
    } while (pushAgain)
    if (failed) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => void pushDocuments(), 60_000)
    }
  })().finally(() => {
    pushing = null
  })
  return pushing
}

async function pullDocuments(kind: Kind) {
  const cursorKey = `documents-cursor:${kind}`
  let cursor = await getCloudMeta<string>(cursorKey) || ''
  let deferred = false
  for (;;) {
    const page = await backendRequest<{ items: CloudDocument[]; next_cursor: string; has_more: boolean }>(`/api/gouo/${kind}?cursor=${encodeURIComponent(cursor)}`)
    for (const remote of page.items) {
      const saved = await getCloudMeta<SavedState>(metaKey(kind, remote.client_id))
      if (saved && saved.revision >= remote.revision) continue
      try {
        if (!(await acceptRemote(kind, remote))) deferred = true
      } catch (err) {
        deferred = true
        console.warn('读取云端文档失败', remote.client_id, err)
      }
    }
    cursor = page.next_cursor
    // 有暂缓的文档时不推进游标，下次打开会重新读取。
    if (!deferred) await putCloudMeta(cursorKey, cursor)
    if (!page.has_more) return
  }
}

export async function startServerDocuments() {
  try {
    await Promise.all([useCanvasStore.getState().hydrate(), useAgentStore.getState().hydrate()])
    for (const kind of KINDS) await pullDocuments(kind)
  } catch (err) {
    console.warn('读取云端画布和会话失败', err)
    useStore.getState().showToast(`读取云端画布和会话失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('gouo:documents-changed', (event) => {
    if ((event as CustomEvent<{ fromSync?: boolean }>).detail?.fromSync) return
    clearTimeout(timer)
    timer = setTimeout(() => void pushDocuments(), 1500)
  })
  window.addEventListener('online', () => void pushDocuments())
  await pushDocuments()
}
