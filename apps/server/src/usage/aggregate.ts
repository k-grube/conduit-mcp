import type { UsageRecord } from './usage-store.js'
import { dayKey } from './usage-store.js'

export interface DashboardMetrics {
  totals: { calls: number; errors: number; avgMs: number }
  tools: { tool: string; pluginId: string; calls: number; errors: number; avgMs: number }[]
  daily: { day: string; calls: number; errors: number }[]
  principals: { principal: string; calls: number }[]
}

export function lastDays(n: number, from = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(from.getTime() - i * 86_400_000)))
  }
  return out
}

export interface DashboardAccumulator {
  add(r: UsageRecord): void
  result(): DashboardMetrics
}

export function createDashboardAccumulator(days: string[]): DashboardAccumulator {
  const tools = new Map<string, { tool: string; pluginId: string; calls: number; errors: number; totalMs: number }>()
  const daily = new Map<string, { day: string; calls: number; errors: number }>()
  const principals = new Map<string, number>()
  for (const day of days) {
    daily.set(day, { day, calls: 0, errors: 0 })
  }
  let calls = 0
  let errors = 0
  let totalMs = 0
  return {
    add(r: UsageRecord) {
      calls++
      totalMs += r.durationMs
      if (!r.ok) {
        errors++
      }
      const t = tools.get(r.tool) ?? { tool: r.tool, pluginId: r.pluginId, calls: 0, errors: 0, totalMs: 0 }
      t.calls++
      t.totalMs += r.durationMs
      if (!r.ok) {
        t.errors++
      }
      tools.set(r.tool, t)
      const day = dayKey(new Date(r.at))
      const d = daily.get(day)
      if (d) {
        d.calls++
        if (!r.ok) {
          d.errors++
        }
      }
      principals.set(r.principal, (principals.get(r.principal) ?? 0) + 1)
    },
    result(): DashboardMetrics {
      return {
        totals: { calls, errors, avgMs: calls ? Math.round(totalMs / calls) : 0 },
        tools: [...tools.values()]
          .map(({ totalMs: tm, ...t }) => ({ ...t, avgMs: t.calls ? Math.round(tm / t.calls) : 0 }))
          .sort((a, b) => b.calls - a.calls),
        daily: [...daily.values()],
        principals: [...principals.entries()]
          .map(([principal, c]) => ({ principal, calls: c }))
          .sort((a, b) => b.calls - a.calls),
      }
    },
  }
}

export function aggregateDashboard(records: UsageRecord[], days: string[]): DashboardMetrics {
  const acc = createDashboardAccumulator(days)
  for (const r of records) {
    acc.add(r)
  }
  return acc.result()
}
