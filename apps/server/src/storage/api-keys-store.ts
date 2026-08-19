import { createHash, randomBytes } from 'node:crypto'
import type { TableClient } from '@azure/data-tables'
import { deleteRow, ensureTable, getJsonRow, listJsonRows } from './tables.js'

export interface ApiKeyInfo {
  id: string
  name: string
  roleIds: string[]
  createdAt: string
}

const PARTITION = 'apikeys'

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

export class ApiKeysStore {
  private tableName: string
  private client?: TableClient

  constructor(tableName = 'ApiKeys') {
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async create(name: string, roleIds: string[]): Promise<{ id: string; rawKey: string }> {
    const rawKey = `cmk_${randomBytes(16).toString('hex')}`
    const id = randomBytes(8).toString('hex')
    const table = await this.table()
    await table.createEntity({
      partitionKey: PARTITION,
      rowKey: hashKey(rawKey),
      json: JSON.stringify({ id, name, roleIds, createdAt: new Date().toISOString() } satisfies ApiKeyInfo),
    })
    return { id, rawKey }
  }

  async verify(rawKey: string): Promise<ApiKeyInfo | undefined> {
    const table = await this.table()
    const row = await getJsonRow<ApiKeyInfo>(table, PARTITION, hashKey(rawKey))
    return row?.value
  }

  async list(): Promise<ApiKeyInfo[]> {
    const table = await this.table()
    return listJsonRows<ApiKeyInfo>(table, PARTITION)
  }

  async remove(id: string): Promise<void> {
    const table = await this.table()
    for await (const e of table.listEntities<{ json: string }>({
      queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
    })) {
      const info = JSON.parse(e.json) as ApiKeyInfo
      if (info.id === id) {
        await deleteRow(table, PARTITION, e.rowKey as string)
        return
      }
    }
  }
}
