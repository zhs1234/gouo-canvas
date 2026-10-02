import { useQuery } from '@tanstack/react-query'
import { request } from './api'

export type TrialStatus = {
  state: 'disabled' | 'ineligible' | 'eligible' | 'active' | 'exhausted' | 'pending' | 'unavailable' | 'expired'
  message: string
  chat: { limit: 4; remaining: number; used: number; held: number; preservedRemaining?: number }
  image: { limit: 1; remaining: number; used: number; held: number; preservedRemaining?: number }
  pendingReconciliation: boolean
}

export function useTrial(userId?: number) {
  return useQuery({ queryKey: ['trial', userId], queryFn: ({ signal }) => request<TrialStatus>('/api/studio/trial', { signal }), enabled: Boolean(userId), retry: false, refetchOnWindowFocus: false })
}
