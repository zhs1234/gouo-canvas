import { lazy, Suspense } from 'react'
import { Route, Routes, Navigate, useSearchParams } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { AuthProvider, useAuth } from './loomic/lib/auth-context'
import { ToastProvider } from './loomic/components/toast'
import CanvasPage from './loomic/CanvasPage'
import ProjectsPage from './loomic/ProjectsPage'
const ChatLab = lazy(() => import('./chat-lab/ChatLab'))
const CanvasLab = lazy(() => import('./canvas-lab/CanvasLab'))
function CanvasWorkspace() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  // Dispose pending transports as well as the editor when the workspace changes.
  return <CanvasPage key={`${user?.id ?? 'guest'}:${params.get('id') || 'draft'}`} />
}
export default function App() {
  return <ThemeProvider attribute="class" defaultTheme="light" enableSystem><AuthProvider><ToastProvider><Routes>
    <Route path="/" element={<CanvasWorkspace />} />
    <Route path="/chat-lab" element={<Suspense fallback={<p>正在打开聊天对照…</p>}><ChatLab /></Suspense>} />
    <Route path="/canvas-lab" element={<Suspense fallback={<p>正在打开画布对照…</p>}><CanvasLab /></Suspense>} />
    <Route path="/projects" element={<ProjectsPage />} />
    <Route path="/editor" element={<Navigate to="/" replace />} />
    <Route path="/board" element={<Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></ToastProvider></AuthProvider></ThemeProvider>
}
