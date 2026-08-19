import { logEvent } from '../logger.js'
import type { ConfigStore } from '../storage/config-store.js'
import { deleteRow, ensureTable } from '../storage/tables.js'
import type { JobScheduler } from './scheduler.js'

export interface RetentionWindows {
  usageDays: number
  sessionDays: number
  eventDays: number
  dcrDays: number
}

const DEFAULTS: RetentionWindows = { usageDays: 90, sessionDays: 2, eventDays: 2, dcrDays: 90 }

export interface SweepResult {
  deleted: number
  done: boolean
}

export async function sweepTable(
  tableName: string,
  cutoff: Date,
  opts?: { maxDeletes?: number; deadlineMs?: number },
): Promise<SweepResult> {
  const maxDeletes = opts?.maxDeletes ?? 5_000
  const deadline = Date.now() + (opts?.deadlineMs ?? 300_000)
  const table = await ensureTable(tableName)
  let deleted = 0
  for await (const e of table.listEntities<{ partitionKey: string; rowKey: string }>({
    queryOptions: { filter: `Timestamp lt datetime'${cutoff.toISOString()}'` },
  })) {
    // budget hit, leave the rest for the next sweep rather than blow the lock ttl
    if (deleted >= maxDeletes || Date.now() >= deadline) {
      return { deleted, done: false }
    }
    await deleteRow(table, e.partitionKey as string, e.rowKey as string)
    deleted++
  }
  return { deleted, done: true }
}

const TABLES = ['UsageLogs', 'Sessions', 'SessionEvents', 'DcrClients'] as const

export function sweepOrder(runIndex: number): string[] {
  const shift = runIndex % TABLES.length
  return [...TABLES.slice(shift), ...TABLES.slice(0, shift)]
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 86_400_000)
}

function windowDays(raw: unknown, fallback: number, key: string): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : NaN
  if (!Number.isFinite(n)) {
    logEvent('jobs', 'retention_bad_window', { key })
    return fallback
  }
  const clamped = Math.max(1, Math.min(n, 3650))
  if (clamped !== n) {
    logEvent('jobs', 'retention_bad_window', { key, raw: n, clamped })
  }
  return clamped
}

let runCounter = 0

export async function runRetention(config: ConfigStore): Promise<Record<string, SweepResult>> {
  const rawConfig = await config.getDomain<Partial<RetentionWindows>>('retention')
  const windows: RetentionWindows = {
    usageDays: windowDays(rawConfig?.usageDays, DEFAULTS.usageDays, 'usageDays'),
    sessionDays: windowDays(rawConfig?.sessionDays, DEFAULTS.sessionDays, 'sessionDays'),
    eventDays: windowDays(rawConfig?.eventDays, DEFAULTS.eventDays, 'eventDays'),
    dcrDays: windowDays(rawConfig?.dcrDays, DEFAULTS.dcrDays, 'dcrDays'),
  }
  // name -> cutoff date mapping for window lookup
  const windowMap: Record<string, Date> = {
    UsageLogs: cutoff(windows.usageDays),
    Sessions: cutoff(windows.sessionDays),
    SessionEvents: cutoff(windows.eventDays),
    DcrClients: cutoff(windows.dcrDays),
  }
  // one shared deadline across all four tables so every one gets serviced within the lock ttl
  const deadline = Date.now() + 300_000
  const results: Record<string, SweepResult> = {}
  const order = sweepOrder(runCounter++)
  for (const name of order) {
    const cut = windowMap[name]
    results[name] = await sweepTable(name, cut, { deadlineMs: Math.max(0, deadline - Date.now()) })
  }
  logEvent('jobs', 'retention', results)
  return results
}

export function registerRetentionJob(scheduler: JobScheduler, config: ConfigStore, intervalMs = 6 * 3_600_000): void {
  scheduler.register('retention', { intervalMs, run: () => runRetention(config).then(() => {}) })
}
