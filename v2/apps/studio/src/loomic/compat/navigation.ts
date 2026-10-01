import { useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams as useRouterSearchParams } from 'react-router-dom'
function pathForStudio(path: string) {
  if (/^\/canvas(?=[?#]|$)/.test(path)) return path.replace('/canvas', '/')
  if (path === '/home' || path === '/projects') return '/projects'
  return path
}
export function useRouter() {
  const navigate = useNavigate()
  const push = useCallback((path: string) => navigate(pathForStudio(path)), [navigate])
  const replace = useCallback((path: string) => navigate(pathForStudio(path), { replace: true }), [navigate])
  return useMemo(() => ({ push, replace, back: () => navigate(-1) }), [push, replace, navigate])
}
export function useSearchParams() { return useRouterSearchParams()[0] }
