import { describe, expect, it } from 'vitest'
import { withLock } from '../src/storage/lock.js'

describe('withLock', () => {
  it('runs the fn and returns its result', async () => {
    expect(await withLock('LockT1-a', 60_000, async () => 42)).toBe(42)
  })

  it('second concurrent holder is skipped', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const first = withLock('LockT1-b', 60_000, async () => {
      await gate
      return 'first'
    })
    // while first holds the lock, second must skip
    await new Promise((r) => setTimeout(r, 100))
    expect(await withLock('LockT1-b', 60_000, async () => 'second')).toBeUndefined()
    release()
    expect(await first).toBe('first')
  })

  it('expired lock is stolen', async () => {
    // seed a stale lock row directly (withLock always releases, so it cannot leave one)
    const { ensureTable } = await import('../src/storage/tables.js')
    const table = await ensureTable('Locks')
    await table.upsertEntity({
      partitionKey: 'locks',
      rowKey: 'LockT1-c',
      json: JSON.stringify({ expires: Date.now() - 60_000, holder: 'other' }),
    })
    expect(await withLock('LockT1-c', 60_000, async () => 'stolen')).toBe('stolen')
  })

  it('held lock is not stolen', async () => {
    const { ensureTable } = await import('../src/storage/tables.js')
    const table = await ensureTable('Locks')
    await table.upsertEntity({
      partitionKey: 'locks',
      rowKey: 'LockT1-e',
      json: JSON.stringify({ expires: Date.now() + 60_000, holder: 'other' }),
    })
    expect(await withLock('LockT1-e', 60_000, async () => 'nope')).toBeUndefined()
  })

  it('releases on fn throw', async () => {
    await expect(withLock('LockT1-d', 60_000, async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await withLock('LockT1-d', 60_000, async () => 'again')).toBe('again')
  })

  it('lock row is gone after a successful run', async () => {
    const { ensureTable, getJsonRow } = await import('../src/storage/tables.js')
    await withLock('LockT1-f', 60_000, async () => 'done')
    const table = await ensureTable('Locks')
    expect(await getJsonRow(table, 'locks', 'LockT1-f')).toBeUndefined()
  })

  it('stale row held by another owner is stolen', async () => {
    const { ensureTable } = await import('../src/storage/tables.js')
    const table = await ensureTable('Locks')
    await table.upsertEntity({
      partitionKey: 'locks',
      rowKey: 'LockT1-g',
      json: JSON.stringify({ expires: Date.now() - 60_000, holder: 'other' }),
    })
    expect(await withLock('LockT1-g', 60_000, async () => 'stolen')).toBe('stolen')
  })

  it('release is skipped when another holder overwrote the row mid-run', async () => {
    const { ensureTable, getJsonRow } = await import('../src/storage/tables.js')
    const table = await ensureTable('Locks')
    await withLock('LockT1-h', 60_000, async () => {
      // simulate ttl expiry + steal by another process while fn is still running
      await table.upsertEntity({
        partitionKey: 'locks',
        rowKey: 'LockT1-h',
        json: JSON.stringify({ expires: Date.now() + 60_000, holder: 'thief' }),
      })
      return 'ours'
    })
    const row = await getJsonRow<{ holder: string }>(table, 'locks', 'LockT1-h')
    expect(row?.value.holder).toBe('thief')
  })
})
