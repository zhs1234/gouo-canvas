import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './lib/auth-context'
import { listDrafts, type LocalProjectSummary } from './lib/local-drafts'
import { ProjectList } from './components/project-list'
import { LoomicLogo } from './components/icons/loomic-logo'
import { createProject, listProjects, saveProject, type StudioProjectSummary } from '../canvas-lab/projects-api'
import { useCreateProject } from './hooks/use-create-project'
export default function ProjectsPage() {
  const { user, loading } = useAuth()
  return <ProjectsContent key={`${loading}:${user?.id ?? 'guest'}`} />
}
function ProjectsContent() {
  const { user, loading } = useAuth()
  const [projects, setProjects] = useState<LocalProjectSummary[]>([])
  const [error, setError] = useState('')
  const { create } = useCreateProject()
  const [studioProjects, setStudioProjects] = useState<StudioProjectSummary[]>([])
  const [studioError, setStudioError] = useState('')
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const actions = useRef(new AbortController())
  useEffect(() => { const controller = new AbortController(); actions.current = controller; return () => controller.abort() }, [])
  useEffect(() => {
    setStudioProjects([]); setStudioError(''); setMore(false); setBusy(false)
    if (loading || !user) return
    const controller = new AbortController()
    listProjects(0, controller.signal).then(result => { if (!controller.signal.aborted) { setStudioProjects(result.projects); setMore(result.nextOffset !== null) } }).catch(error => { if (!controller.signal.aborted) setStudioError(error.message) })
    return () => controller.abort()
  }, [loading, user?.id])
  useEffect(() => {
    if (loading) return
    let disposed = false
    let urls: string[] = []
    listDrafts(`local:${user?.id ?? 'guest'}`).then(list => {
      urls = list.flatMap(p => p.thumbnailUrl ? [p.thumbnailUrl] : [])
      if (!disposed) setProjects(list)
      else urls.forEach(URL.revokeObjectURL)
    }).catch(e => setError(e.message))
    return () => { disposed = true; urls.forEach(URL.revokeObjectURL) }
  }, [loading, user?.id])
  return <div className="h-dvh overflow-y-auto bg-background"><div className="mx-auto max-w-7xl px-6 py-6 sm:px-10">
    <div className="mb-12 flex items-center justify-between"><Link to="/" aria-label="返回画布" className="flex items-center gap-2 text-sm font-semibold"><LoomicLogo className="h-6 w-6" />GOUO Studio</Link><p className="text-xs text-muted-foreground">当前浏览器 · {user?.display_name || user?.username || '访客'}</p></div>
    <p className="mb-6 text-sm text-muted-foreground">整理你的创意与素材。画布保存在当前浏览器，导出后可以备份。</p>
    {user && <section aria-label="Studio 项目" className="mb-10 rounded-xl border p-5">
      <h2 className="mb-3 font-semibold">Studio 项目 · 账号私有</h2>
      <p className="mb-3 text-sm text-muted-foreground">官方 Excalidraw 编辑器；本机 Loomic 草稿仍保留在下方。</p>
      <button disabled={busy} onClick={() => { setBusy(true); setStudioError(''); void createProject(undefined, actions.current.signal).then(project => { if (actions.current.signal.aborted) return; window.location.assign(`/studio/canvas-lab?project=${encodeURIComponent(project.id)}`) }).catch(error => setStudioError(error.message)).finally(() => setBusy(false)) }}>新建 Studio 项目</button>
      {studioError && <p role="alert">{studioError}</p>}
      <ul>{studioProjects.map(project => <li key={project.id} className="my-3 flex gap-4"><Link to={`/canvas-lab?project=${encodeURIComponent(project.id)}`}>{project.title}</Link><button disabled={busy} onClick={() => {
        const title = window.prompt('项目名称', project.title)?.trim()
        if (!title || title === project.title) return
        setBusy(true); setStudioError('')
        void saveProject(project.id, project.revision, { title }, actions.current.signal).then(updated => setStudioProjects(rows => rows.map(row => row.id === updated.id ? updated : row))).catch(error => setStudioError(`${error.message}；请刷新项目库后重试`)).finally(() => setBusy(false))
      }}>重命名 {project.title}</button></li>)}</ul>
      {more && <button disabled={busy} onClick={() => { setBusy(true); void listProjects(studioProjects.length, actions.current.signal).then(result => { setStudioProjects(rows => [...rows, ...result.projects]); setMore(result.nextOffset !== null) }).catch(error => setStudioError(error.message)).finally(() => setBusy(false)) }}>更多 Studio 项目</button>}
    </section>}
    {error ? <p role="alert">{error}</p> : <ProjectList projects={projects} onCreateClick={() => void create()} onDeleted={id => setProjects(list => list.filter(p => p.id !== id))} />}
  </div></div>
}
