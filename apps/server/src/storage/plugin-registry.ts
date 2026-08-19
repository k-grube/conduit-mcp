import type { TableClient } from '@azure/data-tables'
import { deleteRow, ensureTable, getJsonRow, listJsonRows } from './tables.js'

export type PluginStatus = 'active' | 'quarantined' | 'loading'

export interface PluginHealth {
  ok: boolean
  detail?: string
  checkedAt: string
}

export interface PluginRecord {
  id: string
  source: 'git' | 'local'
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

const PARTITION = 'plugins'

export class PluginRegistryStore {
  private tableName: string
  private client?: TableClient

  constructor(tableName = 'Plugins') {
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async list(): Promise<PluginRecord[]> {
    const table = await this.table()
    return listJsonRows<PluginRecord>(table, PARTITION)
  }

  async get(id: string): Promise<PluginRecord | undefined> {
    const table = await this.table()
    const row = await getJsonRow<PluginRecord>(table, PARTITION, id)
    return row?.value
  }

  async upsert(rec: PluginRecord): Promise<void> {
    const table = await this.table()
    await table.upsertEntity({ partitionKey: PARTITION, rowKey: rec.id, json: JSON.stringify(rec) })
  }

  // setStatus('active') intentionally clears lastError and re-stamps loadedAt
  async setStatus(id: string, status: PluginStatus, lastError?: string): Promise<void> {
    const rec = await this.get(id)
    if (!rec) {
      throw new Error(`unknown plugin: ${id}`)
    }
    await this.upsert({
      ...rec,
      status,
      lastError,
      loadedAt: status === 'active' ? new Date().toISOString() : rec.loadedAt,
    })
  }

  // etag-conditional so a concurrent lifecycle write (disable, quarantine, commit pin) never gets clobbered
  async setHealth(id: string, health: PluginHealth): Promise<void> {
    const table = await this.table()
    const row = await getJsonRow<PluginRecord>(table, PARTITION, id)
    if (!row || !row.etag) {
      return
    }
    const entity = { partitionKey: PARTITION, rowKey: id, json: JSON.stringify({ ...row.value, health }) }
    try {
      await table.updateEntity(entity, 'Replace', { etag: row.etag })
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // 412 lost the race to a concurrent lifecycle write, 404 row deleted mid-flight, both no-ops: health is best-effort
      if (status !== 412 && status !== 404) {
        throw err
      }
    }
  }

  async remove(id: string): Promise<void> {
    const table = await this.table()
    await deleteRow(table, PARTITION, id)
  }
}
