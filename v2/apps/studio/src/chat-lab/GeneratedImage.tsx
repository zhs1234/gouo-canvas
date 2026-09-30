import { useEffect, useRef, useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { useNavigate } from 'react-router-dom'
import { listProjects, materializeAsset, openProjectFromAsset, type StudioProjectSummary } from '../canvas-lab/projects-api'
import type { GeneratedImageReference } from './adapter'

// The server resolves the saved tool output under the authenticated owner;
// image bytes from this component are never accepted as an asset ownership claim.
export function GeneratedImage({ image }: { image: string }) {
  const metadata = useAuiState(state => state.message.metadata.custom.generatedImages)
  const reference = Array.isArray(metadata) ? (metadata as GeneratedImageReference[]).find(value => value.url === image) : undefined
  const navigate = useNavigate()
  const lifetime = useRef(new AbortController())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [projects, setProjects] = useState<StudioProjectSummary[] | null>(null)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  useEffect(() => {
    lifetime.current = new AbortController()
    return () => lifetime.current.abort()
  }, [])

  async function open(projectId?: string) {
    if (!reference || busy) return
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const asset = await materializeAsset({ runId: reference.runId, toolCallId: reference.toolCallId, artifactIndex: reference.artifactIndex }, signal)
      const project = projectId ? { id: projectId } : await openProjectFromAsset(asset.id, signal)
      if (!signal.aborted) navigate(`/canvas-lab?project=${encodeURIComponent(project.id)}&asset=${encodeURIComponent(asset.id)}`)
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : '图片未能打开画布，原图与会话记录仍保留')
    } finally { if (!signal.aborted) setBusy(false) }
  }
  async function choose(offset = 0) {
    if (busy) return
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const page = await listProjects(offset, signal)
      if (!signal.aborted) {
        setProjects(previous => offset ? [...(previous || []), ...page.items.filter(item => !previous?.some(existing => existing.id === item.id))] : page.items)
        setNextOffset(page.nextOffset)
      }
    } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : '项目列表读取失败') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const extension = image.startsWith('data:image/jpeg;') ? 'jpeg' : image.startsWith('data:image/webp;') ? 'webp' : 'png'
  return <figure className="lab-generated-image">
    <img src={image} alt="生成图片" />
    <figcaption>
      <a href={image} download={`gouo-original.${extension}`}>下载原图</a>
      {reference && <>
        <button type="button" disabled={busy} onClick={() => void open()}>打开画布</button>
        <button type="button" disabled={busy} onClick={() => void choose()}>插入已有画布</button>
      </>}
      {projects && <div aria-label="选择服务器项目">
        {projects.length ? projects.map(project => <button type="button" key={project.id} disabled={busy} onClick={() => void open(project.id)}>{project.title}</button>) : <p>还没有服务器项目，可用“打开画布”创建。</p>}
        {nextOffset !== null && <button type="button" disabled={busy} onClick={() => void choose(nextOffset)}>更多项目</button>}
        <button type="button" onClick={() => setProjects(null)}>关闭项目选择</button>
      </div>}
      {busy && <p role="status">正在读取并保存原图，不会重新生成…</p>}
      {error && <p role="alert">{error}；原图与会话记录仍保留，不会自动重试。</p>}
    </figcaption>
  </figure>
}
