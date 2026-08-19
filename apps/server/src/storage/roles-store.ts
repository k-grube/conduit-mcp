import type { TableClient } from '@azure/data-tables'
import { deleteRow, ensureTable, getJsonRow, listJsonRows } from './tables.js'

export type Grant =
  | { kind: 'wildcard_all' }
  | { kind: 'integration'; integrationId: string; mode: 'read' | 'write' | 'all' }
  | { kind: 'tool'; toolName: string }
  | { kind: 'notes_write' }

export interface Role {
  id: string
  name: string
  grants: Grant[]
  surfaces: ('portal' | 'mcp')[]
  members: { users: string[]; groups: string[] }
  builtin?: boolean
}

const PARTITION = 'roles'

const BUILTINS: Role[] = [
  {
    id: 'portal-admin',
    name: 'Portal Admin',
    grants: [],
    surfaces: ['portal'],
    members: { users: [], groups: [] },
    builtin: true,
  },
  {
    id: 'admin',
    name: 'Admin',
    grants: [{ kind: 'wildcard_all' }],
    surfaces: ['mcp'],
    members: { users: [], groups: [] },
    builtin: true,
  },
  {
    id: 'editor',
    name: 'Editor',
    grants: [{ kind: 'integration', integrationId: '*', mode: 'all' }, { kind: 'notes_write' }],
    surfaces: ['mcp'],
    members: { users: [], groups: [] },
    builtin: true,
  },
  {
    id: 'read-only',
    name: 'Read Only',
    grants: [{ kind: 'integration', integrationId: '*', mode: 'read' }],
    surfaces: ['mcp'],
    members: { users: [], groups: [] },
    builtin: true,
  },
]

export class RolesStore {
  private tableName: string
  private client?: TableClient

  constructor(tableName = 'Roles') {
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async list(): Promise<Role[]> {
    const table = await this.table()
    return listJsonRows<Role>(table, PARTITION)
  }

  async get(id: string): Promise<Role | undefined> {
    const table = await this.table()
    const row = await getJsonRow<Role>(table, PARTITION, id)
    return row?.value
  }

  async upsert(role: Role): Promise<void> {
    const table = await this.table()
    await table.upsertEntity({ partitionKey: PARTITION, rowKey: role.id, json: JSON.stringify(role) })
  }

  async remove(id: string): Promise<void> {
    const existing = await this.get(id)
    if (existing?.builtin) {
      throw new Error(`cannot remove builtin role: ${id}`)
    }
    const table = await this.table()
    await deleteRow(table, PARTITION, id)
  }

  async seedBuiltins(): Promise<void> {
    for (const role of BUILTINS) {
      const existing = await this.get(role.id)
      if (!existing) {
        await this.upsert(role)
      } else if (existing.builtin) {
        // reconcile definition fields, members are deployment-owned
        await this.upsert({ ...role, members: existing.members })
      }
    }
  }
}
