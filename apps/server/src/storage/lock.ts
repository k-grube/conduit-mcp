import { randomUUID } from 'node:crypto'
import { deleteRow, ensureTable, getJsonRow } from './tables.js'

const TABLE = 'Locks'
const PARTITION = 'locks'

interface LockRow {
  expires: number
  holder: string
}

export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  const table = await ensureTable(TABLE)
  const holder = randomUUID()
  const expires = Date.now() + ttlMs
  const entity = { partitionKey: PARTITION, rowKey: name, json: JSON.stringify({ expires, holder }) }
  try {
    await table.createEntity(entity)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode !== 409) {
      throw err
    }
    const row = await getJsonRow<LockRow>(table, PARTITION, name)
    if (row && row.value.expires > Date.now()) {
      return undefined
    }
    if (row) {
      // stale: conditional delete on the etag we read, 412 means someone else won the steal race
      await deleteRow(table, PARTITION, name, row.etag)
    }
    try {
      await table.createEntity(entity)
    } catch (retryErr) {
      if ((retryErr as { statusCode?: number }).statusCode === 409) {
        return undefined
      }
      throw retryErr
    }
  }
  try {
    return await fn()
  } finally {
    // only release if we still own the row, someone else may have stolen it after ttl expiry mid-run
    const row = await getJsonRow<LockRow>(table, PARTITION, name)
    if (row && row.value.holder === holder) {
      await deleteRow(table, PARTITION, name, row.etag)
    }
  }
}
