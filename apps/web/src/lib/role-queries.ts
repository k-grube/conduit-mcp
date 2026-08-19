import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type GrantMode = 'read' | 'write' | 'all'

export type Grant =
  | { kind: 'wildcard_all' }
  | { kind: 'integration'; integrationId: string; mode: GrantMode }
  | { kind: 'tool'; toolName: string }
  | { kind: 'notes_write' }

export type Surface = 'portal' | 'mcp'

export interface RoleMembers {
  users: string[]
  groups: string[]
}

export interface Role {
  id: string
  name: string
  grants: Grant[]
  surfaces: Surface[]
  members: RoleMembers
  builtin?: boolean
}

export type RoleInput = Omit<Role, 'builtin'>

// server error bodies are `{ error: string }` (zod message, 'role exists', builtin restrictions, ...)
export function roleErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null) {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data
    if (data?.error) {
      return data.error
    }
  }
  return fallback
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/api/admin/roles').then((r) => r.data),
  })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RoleInput) => api.post<Role>('/api/admin/roles', input).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RoleInput) => api.put<Role>(`/api/admin/roles/${input.id}`, input).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useUpdateRoleMembers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, members }: { id: string; members: RoleMembers }) =>
      api.put<Role>(`/api/admin/roles/${id}/members`, members).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })
}
