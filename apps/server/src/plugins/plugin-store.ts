import type { TableClient } from '@azure/data-tables'
import type { PluginStore } from '@conduit-mcp/plugin-sdk'
import { deleteRow, ensureTable, getJsonRow } from '../storage/tables.js'

export class AdtPluginStore implements PluginStore {
  private partition: string
  private tableName: string
  private client?: TableClient

  constructor(pluginId: string, tableName = 'PluginStore') {
    this.partition = `plugin:${pluginId}`
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await getJsonRow<T>(await this.table(), this.partition, key)
    return row?.value
  }

  async set(key: string, value: unknown): Promise<void> {
    const table = await this.table()
    await table.upsertEntity({ partitionKey: this.partition, rowKey: key, json: JSON.stringify(value) })
  }

  async delete(key: string): Promise<void> {
    await deleteRow(await this.table(), this.partition, key)
  }
}
