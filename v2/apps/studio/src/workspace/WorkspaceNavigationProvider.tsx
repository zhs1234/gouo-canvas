import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { useAuth } from '../loomic/lib/auth-context'
import { getIdentityEpoch } from '../api'

type LeaveCheck = () => Promise<boolean> | boolean
const GuardContext = createContext<((check: LeaveCheck) => () => void) | null>(null)

export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const owner = user?.id ?? 'guest'
  const currentOwner = useRef(owner)
  const generation = useRef(0)
  if (currentOwner.current !== owner) { currentOwner.current = owner; generation.current++ }
  const guards = useRef(new Map<symbol, LeaveCheck>())
  const register = useCallback((check: LeaveCheck) => {
    const key = Symbol('workspace leave guard')
    guards.current.set(key, check); generation.current++
    return () => { guards.current.delete(key); generation.current++ }
  }, [])
  const shouldBlock = useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string; search: string; hash: string }; nextLocation: { pathname: string; search: string; hash: string } }) =>
    guards.current.size > 0 && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash), [])
  const blocker = useBlocker(shouldBlock)
  const attempt = useRef<{ location: string; id: symbol } | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++ } }, [])
  useEffect(() => {
    if (blocker.state !== 'blocked') { attempt.current = null; return }
    const location = blocker.location.key
    if (attempt.current?.location === location) return
    const id = Symbol('navigation attempt')
    attempt.current = { location, id }
    const startedGeneration = generation.current
    const startedIdentity = getIdentityEpoch()
    const checks = [...guards.current.values()]
    void (async () => {
      let allowed = true
      try {
        for (const check of checks) {
          if (!await check()) { allowed = false; break }
          if (generation.current !== startedGeneration || getIdentityEpoch() !== startedIdentity) { allowed = false; break }
        }
      } catch { allowed = false }
      if (!alive.current || attempt.current?.id !== id) return
      if (allowed && generation.current === startedGeneration && getIdentityEpoch() === startedIdentity) blocker.proceed()
      else blocker.reset()
    })()
  }, [blocker, owner])
  return <GuardContext.Provider value={register}>{children}</GuardContext.Provider>
}

export function useWorkspaceLeaveGuard(check: LeaveCheck): void {
  const register = useContext(GuardContext)
  if (!register) throw new Error('Workspace leave guard requires WorkspaceNavigationProvider')
  const latest = useRef(check)
  latest.current = check
  const stable = useMemo(() => () => latest.current(), [])
  useLayoutEffect(() => register(stable), [register, stable])
}
