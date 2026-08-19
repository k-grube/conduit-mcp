import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export interface ApiKey {
  id: string
  name: string
  roleIds: string[]
  createdAt: string
}

export interface CreateKeyInput {
  name: string
  roleIds: string[]
}

// POST response shape: { id, name, roleIds, rawKey }, no createdAt
export interface CreateKeyResult {
  id: string
  name: string
  roleIds: string[]
  rawKey: string
}

// server error bodies are `{ error: string }` (zod message, 'unknown role', 'unknown key', ...)
export function keyErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null) {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data
    if (data?.error) {
      return data.error
    }
  }
  return fallback
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['keys'],
    queryFn: () => api.get<ApiKey[]>('/api/admin/keys').then((r) => r.data),
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateKeyInput) => api.post<CreateKeyResult>('/api/admin/keys', input).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }),
    // response carries the plaintext rawKey, don't let it sit in the mutation cache after settling
    gcTime: 0,
  })
}

export function useDeleteApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }),
  })
}
