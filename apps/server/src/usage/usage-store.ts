import { randomBytes } from 'node:crypto'
import type { TableClient } from '@azure/data-tables'
import type { UsageEvent } from '../mcp/meta-tools.js'
import { ensureTable, listJsonRows } from '../storage/tables.js'

export interface UsageRecord {
  rid: string
  at: string
  tool: string
  pluginId: string
  principal: string
  ok: boolean
  durationMs: number
  chars: number
  error?: string
}

export function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10).replaceAll('-', '')
}

// one clock read for both `at` and the partition day, buffer and adt row end up with the same rid/at
export function buildUsageRecord(e: UsageEvent): UsageRecord {
  return { rid: randomBytes(4).toString('hex'), at: new Date().toISOString(), ...e, error: e.error?.slice(0, 1024) }
}

export class UsageStore {
  private tableName: string
  private client?: TableClient

  constructor(tableName = 'UsageLogs') {
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async write(rec: UsageRecord): Promise<void> {
    const rowKey = `${String(1e14 - Date.now()).padStart(14, '0')}-${randomBytes(2).toString('hex')}`
    const table = await this.table()
    await table.createEntity({ partitionKey: dayKey(new Date(rec.at)), rowKey, json: JSON.stringify(rec) })
  }

  async record(e: UsageEvent): Promise<UsageRecord> {
    const rec = buildUsageRecord(e)
    await this.write(rec)
    return rec
  }

  // reverse-chron rowkeys make each partition newest-first already, walk today backwards
  async listRecent(limit: number, days = 7): Promise<UsageRecord[]> {
    const table = await this.table()
    const out: UsageRecord[] = []
    for (let i = 0; i < days && out.length < limit; i++) {
      const day = dayKey(new Date(Date.now() - i * 86_400_000))
      for await (const e of table.listEntities<{ json: string }>({
        queryOptions: { filter: `PartitionKey eq '${day}'` },
      })) {
        out.push(JSON.parse(e.json) as UsageRecord)
        if (out.length >= limit) {
          break
        }
      }
    }
    return out
  }

  async listDays(days: string[]): Promise<UsageRecord[]> {
    const table = await this.table()
    const out: UsageRecord[] = []
    for (const day of days) {
      out.push(...(await listJsonRows<UsageRecord>(table, day)))
    }
    return out
  }

  // streams rows per partition, no in-memory accumulation, dashboard aggregation over a large window shouldn't buffer it all
  async forEachInDays(days: string[], fn: (r: UsageRecord) => void): Promise<void> {
    const table = await this.table()
    for (const day of days) {
      for await (const e of table.listEntities<{ json: string }>({
        queryOptions: { filter: `PartitionKey eq '${day}'` },
      })) {
        fn(JSON.parse(e.json) as UsageRecord)
      }
    }
  }
}
