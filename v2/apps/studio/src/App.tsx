import { lazy, Suspense } from 'react'
import { Route, Routes, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { AuthProvider, useAuth } from './loomic/lib/auth-context'
import { ToastProvider } from './loomic/components/toast'
import CanvasPage from './loomic/CanvasPage'
import ProjectsPage from './loomic/ProjectsPage'
import { WorkspaceShell } from './workspace/WorkspaceShell'
import { WorkspaceNavigationProvider } from './workspace/WorkspaceNavigationProvider'
const ChatLab = lazy(() => import('./chat-lab/ChatLab'))
const CanvasLab = lazy(() => import('./canvas-lab/CanvasLab'))
function CanvasWorkspace() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  // Dispose pending transports as well as the editor when the workspace changes.
  return <CanvasPage key={`${user?.id ?? 'guest'}:${params.get('id') || 'draft'}`} />
}
function LegacyRedirect({ path }: { path: string }) {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: path, search, hash }} replace />
}
function DefaultWorkspace() {
  const [params] = useSearchParams()
  return params.has('id') || params.has('session') ? <LegacyRedirect path="/canvas" /> : <Suspense fallback={<p>正在打开聊天…</p>}><ChatLab /></Suspense>
}
export default function App() {
  return <ThemeProvider attribute="class" defaultTheme="light" enableSystem><AuthProvider><ToastProvider><WorkspaceNavigationProvider><Routes>
    <Route path="/" element={<DefaultWorkspace />} />
    <Route path="/chat" element={<Suspense fallback={<p>正在打开聊天…</p>}><ChatLab /></Suspense>} />
    <Route path="/chat-lab" element={<LegacyRedirect path="/chat" />} />
    <Route path="/canvas" element={<WorkspaceShell title="Loomic 工作台"><CanvasWorkspace /></WorkspaceShell>} />
    <Route path="/canvas-lab" element={<WorkspaceShell title="画布"><Suspense fallback={<p>正在打开画布…</p>}><CanvasLab /></Suspense></WorkspaceShell>} />
    <Route path="/projects" element={<WorkspaceShell title="项目库"><ProjectsPage /></WorkspaceShell>} />
    <Route path="/editor" element={<LegacyRedirect path="/canvas" />} />
    <Route path="/board" element={<LegacyRedirect path="/canvas" />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></WorkspaceNavigationProvider></ToastProvider></AuthProvider></ThemeProvider>
}
