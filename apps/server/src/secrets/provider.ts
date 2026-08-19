import type { TableClient } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'
import { SecretClient } from '@azure/keyvault-secrets'
import { ensureTable, getJsonRow, isLoopbackEndpoint } from '../storage/tables.js'

export class SecretNotFoundError extends Error {
  constructor(name: string) {
    super(`secret not found: ${name}`)
    this.name = 'SecretNotFoundError'
  }
}

export interface SecretProvider {
  readonly writable: boolean
  getSecret(name: string): Promise<string>
  setSecret(name: string, value: string): Promise<void>
}

export class EnvSecretProvider implements SecretProvider {
  readonly writable = false

  async getSecret(name: string): Promise<string> {
    const value = process.env[name]
    if (value === undefined) {
      throw new SecretNotFoundError(name)
    }
    return value
  }

  async setSecret(_name: string, _value: string): Promise<void> {
    throw new Error('EnvSecretProvider is read-only')
  }
}

// FOO_BAR -> foo-bar (kv names disallow underscores)
function kvName(name: string): string {
  return name.toLowerCase().replaceAll('_', '-')
}

interface KvClientLike {
  getSecret(name: string): Promise<{ value?: string }>
  setSecret(name: string, value: string): Promise<unknown>
}

export class KeyVaultSecretProvider implements SecretProvider {
  readonly writable = true
  private client: KvClientLike
  private cache = new Map<string, string>()

  constructor(client: KvClientLike) {
    this.client = client
  }

  async getSecret(name: string): Promise<string> {
    const hit = this.cache.get(name)
    if (hit !== undefined) {
      return hit
    }
    let value: string | undefined
    try {
      value = (await this.client.getSecret(kvName(name))).value
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) {
        throw new SecretNotFoundError(name)
      }
      throw err
    }
    if (value === undefined) {
      throw new SecretNotFoundError(name)
    }
    this.cache.set(name, value)
    return value
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.client.setSecret(kvName(name), value)
    this.cache.set(name, value)
  }
}

// dev store: secrets in the local azurite table, env vars as read fallback
// no read cache on purpose, loopback reads are cheap and stale creds break the save->health flow
export class TableSecretProvider implements SecretProvider {
  readonly writable = true
  private tableName: string
  private client?: TableClient

  constructor(tableName = 'Secrets') {
    this.tableName = tableName
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  async getSecret(name: string): Promise<string> {
    const row = await getJsonRow<string>(await this.table(), 'secrets', name)
    if (row) {
      return row.value
    }
    const env = process.env[name]
    if (env === undefined) {
      throw new SecretNotFoundError(name)
    }
    return env
  }

  async setSecret(name: string, value: string): Promise<void> {
    const table = await this.table()
    await table.upsertEntity({ partitionKey: 'secrets', rowKey: name, json: JSON.stringify(value) })
  }
}

export function createSecretProvider(): SecretProvider {
  const url = process.env.AZURE_KEYVAULT_URL
  if (url) {
    return new KeyVaultSecretProvider(new SecretClient(url, new DefaultAzureCredential()))
  }
  const conn = process.env.AZURE_TABLES_CONNECTION_STRING
  // loopback azurite only: a real table deployment without keyvault stays env-only,
  // plaintext secrets never land in shared storage
  if (conn && isLoopbackEndpoint(conn)) {
    return new TableSecretProvider()
  }
  return new EnvSecretProvider()
}
