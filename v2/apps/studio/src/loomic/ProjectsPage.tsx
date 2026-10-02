import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Dialog } from '@base-ui/react/dialog'
import { FileImage, Pencil, Plus, X } from 'lucide-react'
import { useAuth } from './lib/auth-context'
import { listDrafts, type LocalProjectSummary } from './lib/local-drafts'
import { ProjectList } from './components/project-list'
import { createProject, listProjects, saveProject, type StudioProjectSummary } from '../canvas-lab/projects-api'
import { useCreateProject } from './hooks/use-create-project'
import { formatDate } from './lib/utils'
import './projects-page.css'
export default function ProjectsPage() {
  const { user, loading } = useAuth()
  return <ProjectsContent key={`${loading}:${user?.id ?? 'guest'}`} />
}
function ProjectsContent() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [projects, setProjects] = useState<LocalProjectSummary[]>([])
  const [error, setError] = useState('')
  const [projectsLoading, setProjectsLoading] = useState(true)
  const { create, creating } = useCreateProject()
  const [studioProjects, setStudioProjects] = useState<StudioProjectSummary[]>([])
  const [studioError, setStudioError] = useState('')
  const [studioLoadError, setStudioLoadError] = useState('')
  const [studioLoading, setStudioLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [renaming, setRenaming] = useState<StudioProjectSummary | null>(null)
  const [title, setTitle] = useState('')
  const renameInput = useRef<HTMLInputElement>(null)
  const actions = useRef(new AbortController())
  useEffect(() => { const controller = new AbortController(); actions.current = controller; return () => controller.abort() }, [])
  useEffect(() => {
    setStudioProjects([]); setStudioError(''); setStudioLoadError(''); setMore(false); setBusy(false); setStudioLoading(true)
    if (loading || !user) { setStudioLoading(loading); return }
    const controller = new AbortController()
    listProjects(0, controller.signal).then(result => { if (!controller.signal.aborted) { setStudioProjects(result.projects); setMore(result.nextOffset !== null) } }).catch(error => { if (!controller.signal.aborted) setStudioLoadError(error.message) }).finally(() => { if (!controller.signal.aborted) setStudioLoading(false) })
    return () => controller.abort()
  }, [loading, user?.id])
  useEffect(() => {
    if (loading) return
    setProjectsLoading(true); setError('')
    let disposed = false
    let urls: string[] = []
    listDrafts(`local:${user?.id ?? 'guest'}`).then(list => {
      urls = list.flatMap(p => p.thumbnailUrl ? [p.thumbnailUrl] : [])
      if (!disposed) setProjects(list)
      else urls.forEach(URL.revokeObjectURL)
    }).catch(e => { if (!disposed) setError(e.message) }).finally(() => { if (!disposed) setProjectsLoading(false) })
    return () => { disposed = true; urls.forEach(URL.revokeObjectURL) }
  }, [loading, user?.id])
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = title.trim()
    if (!renaming || !name || busy) return
    if (name === renaming.title) { setRenaming(null); return }
    setBusy(true); setStudioError('')
    try {
      const updated = await saveProject(renaming.id, renaming.revision, { title: name }, actions.current.signal)
      if (actions.current.signal.aborted) return
      setStudioProjects(rows => rows.map(row => row.id === updated.id ? updated : row))
      setRenaming(null)
    } catch (error) { if (!actions.current.signal.aborted) setStudioError(`${(error as Error).message}；请刷新项目库后核对`) }
    finally { if (!actions.current.signal.aborted) setBusy(false) }
  }
  return <main className="projects-library"><div className="projects-page">
    <header className="projects-page-header"><h1>项目库</h1><p>打开项目继续创作，或新建画布开始设计。</p></header>
    {user && <section aria-label="Studio 项目" className="projects-section" aria-busy={studioLoading}>
      <div className="projects-section-header"><div><h2>账号项目 <span className="projects-scope">仅本人</span></h2><p>项目跟随当前账号保存。</p></div>
        <button type="button" className="projects-button" disabled={busy} onClick={() => { setBusy(true); setStudioError(''); void createProject(undefined, actions.current.signal).then(project => { if (actions.current.signal.aborted) return; navigate(`/canvas-lab?project=${encodeURIComponent(project.id)}`) }).catch(error => { if (!actions.current.signal.aborted) setStudioError(error.message) }).finally(() => { if (!actions.current.signal.aborted) setBusy(false) }) }}><Plus size={16} aria-hidden="true" />新建 Studio 项目</button>
      </div>
      {studioLoadError && <p role="alert" className="projects-error">账号项目读取失败：{studioLoadError}。请刷新页面重试。</p>}
      {studioError && !renaming && <p role="alert" className="projects-error">项目操作未完成：{studioError}</p>}
      {studioLoading ? <p role="status" className="projects-state">正在读取账号项目…</p> : studioProjects.length > 0 ? <ul className="projects-list">{studioProjects.map(project => <li key={project.id} className="projects-row">
        <Link aria-label={project.title} to={`/canvas-lab?project=${encodeURIComponent(project.id)}`} className="projects-row-link"><span className="projects-preview"><FileImage size={24} aria-hidden="true" /></span><span className="projects-row-content"><strong title={project.title}>{project.title}</strong><span>更新于 <time dateTime={project.updatedAt}>{formatDate(project.updatedAt)}</time></span></span></Link>
        <button type="button" className="projects-icon-button" aria-label={`重命名 ${project.title}`} title="重命名" disabled={busy} onClick={() => { setStudioError(''); setTitle(project.title); setRenaming(project) }}><Pencil size={16} aria-hidden="true" /></button>
      </li>)}</ul> : !studioLoadError && !studioError && <div className="projects-state"><FileImage size={28} aria-hidden="true" /><p>还没有账号项目</p><span>新建项目后，可以在画布中设计并保存。</span></div>}
      {more && <button type="button" className="projects-button projects-more" disabled={busy} onClick={() => { setBusy(true); void listProjects(studioProjects.length, actions.current.signal).then(result => { if (actions.current.signal.aborted) return; setStudioProjects(rows => [...rows, ...result.projects]); setMore(result.nextOffset !== null) }).catch(error => { if (!actions.current.signal.aborted) setStudioError(error.message) }).finally(() => { if (!actions.current.signal.aborted) setBusy(false) }) }}>更多 Studio 项目</button>}
    </section>}
    <ProjectList projects={projects} loading={projectsLoading} error={error} creating={creating} onCreateClick={() => void create()} onDeleted={id => setProjects(list => list.filter(p => p.id !== id))} />
  </div>
    <Dialog.Root open={Boolean(renaming)} onOpenChange={open => { if (!open && !busy) setRenaming(null) }}>
      <Dialog.Portal><Dialog.Backdrop className="projects-rename-backdrop" /><Dialog.Popup className="chat-starter projects-rename-dialog" initialFocus={renameInput}>
        <header><Dialog.Title>重命名项目</Dialog.Title><Dialog.Close aria-label="关闭重命名窗口" className="projects-icon-button" disabled={busy}><X size={18} /></Dialog.Close></header>
        <Dialog.Description>修改项目名称，画布内容会保留。</Dialog.Description>
        <form onSubmit={event => void rename(event)}><label htmlFor="project-rename-title">项目名称</label><input ref={renameInput} id="project-rename-title" value={title} maxLength={100} required disabled={busy} onChange={event => setTitle(event.target.value)} />
          {studioError && <p role="alert" className="projects-error">{studioError}</p>}
          <div className="projects-dialog-actions"><Dialog.Close className="projects-button" disabled={busy}>取消</Dialog.Close><button type="submit" className="projects-button projects-button-primary" disabled={busy || !title.trim()}>{busy ? '正在保存…' : '保存名称'}</button></div>
        </form>
      </Dialog.Popup></Dialog.Portal>
    </Dialog.Root>
  </main>
}
