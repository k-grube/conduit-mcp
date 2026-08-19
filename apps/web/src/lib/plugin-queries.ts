import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type PluginSource = 'git' | 'local'
export type PluginStatus = 'active' | 'quarantined' | 'loading'
export type PluginDisplayStatus = 'disabled' | 'loading' | 'quarantined' | 'needs_setup' | 'error' | 'active'

export interface PluginHealth {
  ok: boolean
  detail?: string
  checkedAt: string
}

export interface PluginRecord {
  id: string
  source: PluginSource
  repoUrl?: string
  ref?: string
  commit?: string
  localPath?: string
  enabled: boolean
  status: PluginStatus
  lastError?: string
  loadedAt?: string
  health?: PluginHealth
}

export interface PluginListItem extends PluginRecord {
  toolCount: number
  configured: boolean
  displayStatus: PluginDisplayStatus
}

export interface SettingsFieldOption {
  value: string
  label: string
}

export interface SettingsField {
  key: string
  label: string
  type: 'text' | 'secret' | 'toggle' | 'select' | 'tags'
  required?: boolean
  help?: string
  options?: SettingsFieldOption[]
}

export interface UiAction {
  id: string
  label: string
  // relative to /api/plugins/:id
  route: string
  method: 'GET' | 'POST'
}

export interface SecretStatus {
  name: string
  set: boolean
}

export interface PluginManifest {
  id: string
  name: string
  toolPrefix: string
  entry: string
  sdkVersion: string
  secrets: string[]
  ui: {
    settings: SettingsField[]
    actions: UiAction[]
    statusCheck: boolean
    customBundle?: string
    // markdown, rendered above the settings form as a setup guide
    setupHelp?: string
  }
}

export interface PluginDetail {
  record: PluginRecord
  manifest?: PluginManifest
  configured: boolean
  displayStatus: PluginDisplayStatus
}

export interface RegisterPluginInput {
  id: string
  source: PluginSource
  repoUrl?: string
  ref?: string
  localPath?: string
}

// server error bodies are `{ error: string }` (zod message, 'plugin exists', lifecycle conflicts, ...)
export function pluginErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null) {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data
    if (data?.error) {
      return data.error
    }
  }
  return fallback
}

export function usePlugins() {
  return useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.get<PluginListItem[]>('/api/admin/plugins').then((r) => r.data),
  })
}

export function usePlugin(id: string) {
  return useQuery({
    queryKey: ['plugins', id],
    queryFn: () => api.get<PluginDetail>(`/api/admin/plugins/${id}`).then((r) => r.data),
    enabled: id.length > 0,
  })
}

export function useRegisterPlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterPluginInput) =>
      api.post<PluginListItem>('/api/admin/plugins', input).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

function useLifecycleMutation(action: 'reload' | 'enable' | 'disable') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<PluginListItem>(`/api/admin/plugins/${id}/${action}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function useReloadPlugin() {
  return useLifecycleMutation('reload')
}

export function useEnablePlugin() {
  return useLifecycleMutation('enable')
}

export function useDisablePlugin() {
  return useLifecycleMutation('disable')
}

export function useDeletePlugin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/plugins/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function usePluginHealth(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.get<Record<string, unknown>>(`/api/admin/plugins/${id}/health`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function usePluginConfig(id: string) {
  return useQuery({
    queryKey: ['plugins', id, 'config'],
    queryFn: () => api.get<Record<string, unknown>>(`/api/admin/plugins/${id}/config`).then((r) => r.data),
    enabled: id.length > 0,
  })
}

export function useUpdatePluginConfig(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      api.put<Record<string, unknown>>(`/api/admin/plugins/${id}/config`, config).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(['plugins', id, 'config'], data)
      qc.invalidateQueries({ queryKey: ['plugins'] })
    },
  })
}

// server responds { items: [{ name, set }] }, not { secrets: [...] }
export function usePluginSecrets(id: string) {
  return useQuery({
    queryKey: ['plugins', id, 'secrets'],
    queryFn: () => api.get<{ items: SecretStatus[] }>(`/api/admin/plugins/${id}/secrets`).then((r) => r.data.items),
    enabled: id.length > 0,
  })
}

// server expects the flat { NAME: value } map directly, not { values: {...} }
export function useUpdatePluginSecrets(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (values: Record<string, string>) => api.put(`/api/admin/plugins/${id}/secrets`, values),
    // prefix match covers ['plugins', id, 'secrets'] too
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}
