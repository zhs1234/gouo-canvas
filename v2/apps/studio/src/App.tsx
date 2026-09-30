import { Route, Routes, Navigate, useSearchParams } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'
import { AuthProvider, useAuth } from './loomic/lib/auth-context'
import { ToastProvider } from './loomic/components/toast'
import CanvasPage from './loomic/CanvasPage'
import ProjectsPage from './loomic/ProjectsPage'
function CanvasWorkspace() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  // Dispose pending transports as well as the editor when the workspace changes.
  return <CanvasPage key={`${user?.id ?? 'guest'}:${params.get('id') || 'draft'}`} />
}
export default function App() {
  return <ThemeProvider attribute="class" defaultTheme="light" enableSystem><AuthProvider><ToastProvider><Routes>
    <Route path="/" element={<CanvasWorkspace />} />
    <Route path="/projects" element={<ProjectsPage />} />
    <Route path="/editor" element={<Navigate to="/" replace />} />
    <Route path="/board" element={<Navigate to="/" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></ToastProvider></AuthProvider></ThemeProvider>
}
