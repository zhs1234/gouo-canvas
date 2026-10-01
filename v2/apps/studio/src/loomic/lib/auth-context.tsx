import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { assertIdentityEpoch, currentUser, getIdentityEpoch, logout, subscribeAuthRecovery, type User } from '../../api'
import AuthRecovery from '../../AuthRecovery'
type Auth = { user: User | null; loading: boolean; blocked: boolean; authenticated: boolean; error: Error | null; retryIdentity: () => Promise<void>; signOut: () => Promise<void> }
const Context = createContext<Auth | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const explicitRecovery = useRef(false)
  const owner = useRef<number | null | undefined>(undefined)
  const [recoveryIssue, setRecoveryIssue] = useState<Error | null>(null)
  useEffect(() => subscribeAuthRecovery(setRecoveryIssue), [])
  async function signOut() {
    const completedEpoch = await logout()
    await client.cancelQueries()
    assertIdentityEpoch(completedEpoch)
    client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })
    client.setQueryData(['session'], null)
  }
  const session = useQuery({ queryKey: ['session'], retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false,
    queryFn: async ({ signal }) => {
      const epoch = getIdentityEpoch()
      const retryRecovery = explicitRecovery.current; explicitRecovery.current = false
      const user = await currentUser(signal, { retryRecovery })
      assertIdentityEpoch(epoch)
      const nextOwner = user?.id ?? null
      if (owner.current !== undefined && owner.current !== nextOwner) {
        await client.cancelQueries({ predicate: query => query.queryKey[0] !== 'session' })
        assertIdentityEpoch(epoch)
        client.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })
      }
      owner.current = nextOwner
      return user
    } })
  async function retryIdentity() { const epoch = getIdentityEpoch(); explicitRecovery.current = true; const result = await session.refetch(); if (!result.error && epoch === getIdentityEpoch()) setRecoveryIssue(null) }
  const error = recoveryIssue ?? (session.error instanceof Error ? session.error : null)
  const blocked = session.isPending || Boolean(error) || session.isFetching
  // Keep the last owner's namespace and child loading flag stable while the
  // inert recovery gate is visible; toggling it would recreate canvas editors.
  return <Context.Provider value={{ user: session.data ?? null, loading: session.isPending, blocked, authenticated: !blocked && Boolean(session.data), error, retryIdentity, signOut }}>
    <div hidden={blocked} inert={blocked ? true : undefined} data-auth-workspace="true">{children}</div>
    {blocked && <AuthRecovery error={error} loading={session.isFetching} retry={retryIdentity} />}
  </Context.Provider>
}
export function useAuth() { const value = useContext(Context); if (!value) throw new Error('AuthProvider missing'); return value }
