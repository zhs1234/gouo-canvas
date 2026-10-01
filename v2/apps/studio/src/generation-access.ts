import { useQuery } from '@tanstack/react-query'
import { request } from './api'

export type GenerationAccess = { state: 'ready' | 'missing' | 'expired' | 'exhausted' | 'disabled' | 'incompatible' | 'unknown' | 'unavailable'; message: string; canRenew: boolean; version?: string; approvedLifetimeSeconds?: number; expiresAt?: number }
export function useGenerationAccess(userId: number) {
  return useQuery({ queryKey: ['generation-access', userId], queryFn: ({ signal }) => request<GenerationAccess>('/api/studio/access', { signal }), retry: false, refetchOnWindowFocus: false })
}
export function renewGenerationAccess(version: string) {
  return request<{ state: 'ready'; message: string }>('/api/studio/access/renew', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ version, confirm: true }) })
}
