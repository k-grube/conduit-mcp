import { TableClient } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackEndpoint(conn: string): boolean {
  const match = /(?:^|;)TableEndpoint=([^;]*)/.exec(conn)
  if (!match) {
    return false
  }
  try {
    const hostname = new URL(match[1]).hostname.replace(/^\[|\]$/g, '')
    return LOOPBACK_HOSTS.has(hostname)
  } catch {
    return false
  }
}

export function getTableClient(tableName: string): TableClient {
  const conn = process.env.AZURE_TABLES_CONNECTION_STRING
  if (conn) {
    const opts = isLoopbackEndpoint(conn) ? { allowInsecureConnection: true } : {}
    return TableClient.fromConnectionString(conn, tableName, opts)
  }
  const url = process.env.AZURE_STORAGE_TABLES_URL
  if (!url) {
    throw new Error('AZURE_TABLES_CONNECTION_STRING or AZURE_STORAGE_TABLES_URL required')
  }
  return new TableClient(url, tableName, new DefaultAzureCredential())
}

export async function ensureTable(tableName: string): Promise<TableClient> {
  const client = getTableClient(tableName)
  await client.createTable().catch((e: { statusCode?: number }) => {
    // 409 = exists
    if (e.statusCode !== 409) {
      throw e
    }
  })
  return client
}

export async function getJsonRow<T>(
  client: TableClient,
  partition: string,
  rowKey: string,
): Promise<{ value: T; etag?: string } | undefined> {
  try {
    const e = await client.getEntity<{ json: string }>(partition, rowKey)
    return { value: JSON.parse(e.json) as T, etag: e.etag }
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) {
      return undefined
    }
    throw err
  }
}

export async function listJsonRows<T>(client: TableClient, partition: string): Promise<T[]> {
  const out: T[] = []
  for await (const e of client.listEntities<{ json: string }>({
    queryOptions: { filter: `PartitionKey eq '${partition}'` },
  })) {
    out.push(JSON.parse(e.json) as T)
  }
  return out
}

export async function deleteRow(client: TableClient, partition: string, rowKey: string, etag?: string): Promise<void> {
  try {
    await client.deleteEntity(partition, rowKey, etag ? { etag } : undefined)
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    // 404 = already gone, 412 = someone else won the conditional delete race, both are a no-op for us
    if (status !== 404 && status !== 412) {
      throw err
    }
  }
}
