import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { useAuth } from '../loomic/lib/auth-context'
import { getIdentityEpoch, assertIdentityEpoch } from '../api'

type LeaveCheck = () => Promise<boolean> | boolean
type NavigationChecks = { register: (check: LeaveCheck) => () => void; check: () => Promise<boolean> }
const GuardContext = createContext<NavigationChecks | null>(null)

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
  const checking = useRef(false)
  const check = useCallback(async () => {
    if (checking.current) return false
    checking.current = true
    const startedGeneration = generation.current
    const startedIdentity = getIdentityEpoch()
    const startedOwner = currentOwner.current
    const checks = [...guards.current.values()]
    try {
      assertIdentityEpoch(startedIdentity)
      for (const guard of checks) {
        if (!await guard()) return false
        assertIdentityEpoch(startedIdentity)
        if (generation.current !== startedGeneration || currentOwner.current !== startedOwner) return false
      }
      return alive.current && generation.current === startedGeneration && currentOwner.current === startedOwner
    } catch { return false } finally { checking.current = false }
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
    const startedGeneration = generation.current
    const startedIdentity = getIdentityEpoch()
    attempt.current = { location, id }
    void check().then(allowed => {
      if (!alive.current || attempt.current?.id !== id) return
      if (allowed && generation.current === startedGeneration && getIdentityEpoch() === startedIdentity) blocker.proceed()
      else blocker.reset()
    })
  }, [blocker, owner, check])
  const context = useMemo(() => ({ register, check }), [register, check])
  return <GuardContext.Provider value={context}>{children}</GuardContext.Provider>
}

export function useWorkspaceLeaveGuard(check: LeaveCheck): void {
  const context = useContext(GuardContext)
  if (!context) throw new Error('Workspace leave guard requires WorkspaceNavigationProvider')
  const latest = useRef(check)
  latest.current = check
  const stable = useMemo(() => () => latest.current(), [])
  useLayoutEffect(() => context.register(stable), [context, stable])
}

export function useWorkspaceLeaveCheck(): () => Promise<boolean> {
  const context = useContext(GuardContext)
  if (!context) throw new Error('Workspace leave check requires WorkspaceNavigationProvider')
  return context.check
}
