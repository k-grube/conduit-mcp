import { describe, expect, it } from 'vitest'
import { ensureTable, isLoopbackEndpoint } from '../src/storage/tables.js'

describe('tables', () => {
  it('creates a table and round-trips an entity', async () => {
    const client = await ensureTable('TestTable')
    await client.upsertEntity({ partitionKey: 'p', rowKey: 'r', value: 'hello' })
    const got = await client.getEntity<{ value: string }>('p', 'r')
    expect(got.value).toBe('hello')
  })

  it('ensureTable is idempotent', async () => {
    await ensureTable('TestTable')
    await expect(ensureTable('TestTable')).resolves.toBeDefined()
  })
})

describe('isLoopbackEndpoint', () => {
  it('is true for 127.0.0.1', () => {
    expect(isLoopbackEndpoint('TableEndpoint=http://127.0.0.1:10102/devstoreaccount1;')).toBe(true)
  })

  it('is true for localhost', () => {
    expect(isLoopbackEndpoint('TableEndpoint=http://localhost:10102/devstoreaccount1;')).toBe(true)
  })

  it('is true for ::1', () => {
    expect(isLoopbackEndpoint('TableEndpoint=http://[::1]:10102/devstoreaccount1;')).toBe(true)
  })

  it('is false for a remote http endpoint', () => {
    expect(isLoopbackEndpoint('TableEndpoint=http://storageacct.table.core.windows.net/;')).toBe(false)
  })

  it('is false when TableEndpoint is missing', () => {
    expect(isLoopbackEndpoint('AccountName=devstoreaccount1;AccountKey=abc;')).toBe(false)
  })
})
