import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type ConfigDomain = 'server' | 'auth' | 'retention'

// server error bodies are `{ error: string }` (single zod issue message, no field path)
export function configErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null) {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data
    if (data?.error) {
      return data.error
    }
  }
  return fallback
}

export function isConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false
  }
  return (err as { response?: { status?: number } }).response?.status === 409
}

export function useConfigDomain<T extends object>(domain: ConfigDomain) {
  return useQuery({
    queryKey: ['config', domain],
    queryFn: () => api.get<T>(`/api/admin/config/${domain}`).then((r) => r.data),
  })
}

// PUT deep-merges server-side and echoes the full merged domain back
export function useUpdateConfigDomain<T extends object>(domain: ConfigDomain) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.put<T>(`/api/admin/config/${domain}`, patch).then((r) => r.data),
    onSuccess: (data) => qc.setQueryData(['config', domain], data),
  })
}
