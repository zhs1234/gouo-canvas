import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { currentUser, logout, type User } from '../../api'
type Auth = { user: User | null; loading: boolean; signOut: () => Promise<void> }
const Context = createContext<Auth | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useQuery({ queryKey: ['session'], queryFn: ({ signal }) => currentUser(signal) })
  return <Context.Provider value={{ user: session.data ?? null, loading: session.isPending, signOut: logout }}>{children}</Context.Provider>
}
export function useAuth() { const value = useContext(Context); if (!value) throw new Error('AuthProvider missing'); return value }
