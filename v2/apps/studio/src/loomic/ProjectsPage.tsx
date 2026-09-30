import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './lib/auth-context'
import { listDrafts, type LocalProjectSummary } from './lib/local-drafts'
import { ProjectList } from './components/project-list'
import { LoomicLogo } from './components/icons/loomic-logo'
import { useCreateProject } from './hooks/use-create-project'
export default function ProjectsPage() {
  const { user, loading } = useAuth()
  const [projects, setProjects] = useState<LocalProjectSummary[]>([])
  const [error, setError] = useState('')
  const { create } = useCreateProject()
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
    {error ? <p role="alert">{error}</p> : <ProjectList projects={projects} onCreateClick={() => void create()} onDeleted={id => setProjects(list => list.filter(p => p.id !== id))} />}
  </div></div>
}
