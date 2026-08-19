import type { TableClient } from '@azure/data-tables'
import { deleteRow, ensureTable, getJsonRow, listJsonRows } from '../storage/tables.js'

export interface SessionRecord {
  sessionId: string
  principal: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}

const PARTITION = 'sessions'
const DEFAULT_TTL_MS = 86_400_000 // 24h

export class AdtSessionStore {
  private tableName: string
  private client?: TableClient
  private ttlMs: number

  constructor(tableName = 'Sessions', ttlMs = DEFAULT_TTL_MS) {
    this.tableName = tableName
    this.ttlMs = ttlMs
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async create(sessionId: string, principal: string): Promise<void> {
    const now = Date.now()
    const rec: SessionRecord = {
      sessionId,
      principal,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
    }
    const table = await this.table()
    await table.upsertEntity({ partitionKey: PARTITION, rowKey: sessionId, json: JSON.stringify(rec) })
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const row = await getJsonRow<SessionRecord>(await this.table(), PARTITION, sessionId)
    return row?.value
  }

  async touch(sessionId: string): Promise<void> {
    try {
      const rec = await this.get(sessionId)
      if (!rec) {
        return
      }
      const now = Date.now()
      rec.lastSeenAt = new Date(now).toISOString()
      rec.expiresAt = new Date(now + this.ttlMs).toISOString()
      const table = await this.table()
      await table.upsertEntity({ partitionKey: PARTITION, rowKey: sessionId, json: JSON.stringify(rec) })
    } catch {
      // best-effort
    }
  }

  async remove(sessionId: string): Promise<void> {
    await deleteRow(await this.table(), PARTITION, sessionId)
  }

  async list(): Promise<SessionRecord[]> {
    return listJsonRows<SessionRecord>(await this.table(), PARTITION)
  }
}
