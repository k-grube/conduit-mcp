import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface DashboardMetrics {
  totals: { calls: number; errors: number; avgMs: number }
  tools: { tool: string; pluginId: string; calls: number; errors: number; avgMs: number }[]
  daily: { day: string; calls: number; errors: number }[]
  principals: { principal: string; calls: number }[]
}

export interface ActivityItem {
  rid: string
  at: string
  tool: string
  pluginId: string
  principal: string
  durationMs: number
  ok: boolean
  error?: string
  chars: number
}

export interface CatalogTool {
  name: string
  pluginId: string
  integrationName: string
  description: string
  readOnly: boolean
  jsonSchema: unknown
}

export interface ToolNote {
  text: string
  updatedBy: string
  updatedAt: string
}

export interface ToolNotesSnapshot {
  tools: Record<string, ToolNote>
  integrations: Record<string, ToolNote>
}

export function useDashboard(days: number) {
  return useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => api.get<DashboardMetrics>(`/api/admin/dashboard?days=${days}`).then((r) => r.data),
  })
}

export function useActivity(limit: number) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: () => api.get<{ items: ActivityItem[] }>(`/api/admin/activity?limit=${limit}`).then((r) => r.data),
    refetchInterval: 10_000,
  })
}

export function useTools() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: () => api.get<{ tools: CatalogTool[] }>('/api/admin/tools').then((r) => r.data),
  })
}

export function useToolNotes() {
  return useQuery({
    queryKey: ['tool-notes'],
    queryFn: () => api.get<ToolNotesSnapshot>('/api/admin/tool-notes').then((r) => r.data),
  })
}
