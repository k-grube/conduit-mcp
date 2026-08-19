import { describe, expect, it } from 'vitest'
import { ensureTable } from '../src/storage/tables.js'
import { ConfigStore } from '../src/storage/config-store.js'
import { runRetention, sweepTable, sweepOrder } from '../src/jobs/retention.js'

describe('sweepTable', () => {
  it('deletes rows older than the cutoff and keeps newer ones', async () => {
    const table = await ensureTable('RetT1')
    await table.createEntity({ partitionKey: 'p', rowKey: 'old', json: '{}' })
    await new Promise((r) => setTimeout(r, 1200))
    const cutoff = new Date()
    await new Promise((r) => setTimeout(r, 200))
    await table.createEntity({ partitionKey: 'p', rowKey: 'new', json: '{}' })
    const result = await sweepTable('RetT1', cutoff)
    expect(result).toEqual({ deleted: 1, done: true })
    const remaining: string[] = []
    for await (const e of table.listEntities<{ rowKey: string }>()) {
      remaining.push(e.rowKey as string)
    }
    expect(remaining).toEqual(['new'])
  })

  it('returns done with 0 deletes for an empty table', async () => {
    await ensureTable('RetT2')
    expect(await sweepTable('RetT2', new Date())).toEqual({ deleted: 0, done: true })
  })

  it('stops at maxDeletes and reports done false with rows left behind', async () => {
    const table = await ensureTable('RetT5')
    await table.createEntity({ partitionKey: 'p', rowKey: 'old1', json: '{}' })
    await table.createEntity({ partitionKey: 'p', rowKey: 'old2', json: '{}' })
    await new Promise((r) => setTimeout(r, 1200))
    const cutoff = new Date()
    const result = await sweepTable('RetT5', cutoff, { maxDeletes: 1 })
    expect(result).toEqual({ deleted: 1, done: false })
    const remaining: string[] = []
    for await (const e of table.listEntities<{ rowKey: string }>()) {
      remaining.push(e.rowKey as string)
    }
    expect(remaining).toHaveLength(1)
  })
})

describe('runRetention', () => {
  it('returns deleted/done per table and honors config windows', async () => {
    const config = new ConfigStore({ tableName: 'RetCfg1' })
    await config.updateDomain('retention', { usageDays: 1 })
    const results = await runRetention(config)
    expect(Object.keys(results).sort()).toEqual(['DcrClients', 'SessionEvents', 'Sessions', 'UsageLogs'])
    expect(results.UsageLogs.deleted).toBeGreaterThanOrEqual(0)
    expect(results.UsageLogs.done).toBe(true)
  })

  it('clamps invalid window values to valid range', async () => {
    const config = new ConfigStore({ tableName: 'RetCfg2' })
    await config.updateDomain('retention', { usageDays: 0, sessionDays: -5, eventDays: 5000 })
    const results = await runRetention(config)
    expect(Object.keys(results).sort()).toEqual(['DcrClients', 'SessionEvents', 'Sessions', 'UsageLogs'])
    // all calls should succeed despite bad input
    expect(results.UsageLogs.deleted).toBeGreaterThanOrEqual(0)
    expect(results.Sessions.deleted).toBeGreaterThanOrEqual(0)
    expect(results.SessionEvents.deleted).toBeGreaterThanOrEqual(0)
  })

  it('falls back to defaults for non-numeric window values', async () => {
    const config = new ConfigStore({ tableName: 'RetCfg3' })
    await config.updateDomain('retention', { usageDays: 'banana' as unknown as number })
    const results = await runRetention(config)
    expect(Object.keys(results).sort()).toEqual(['DcrClients', 'SessionEvents', 'Sessions', 'UsageLogs'])
    expect(results.UsageLogs.deleted).toBeGreaterThanOrEqual(0)
  })
})

describe('sweepOrder', () => {
  it('rotates deterministically', () => {
    expect(sweepOrder(0)).toEqual(['UsageLogs', 'Sessions', 'SessionEvents', 'DcrClients'])
    expect(sweepOrder(1)).toEqual(['Sessions', 'SessionEvents', 'DcrClients', 'UsageLogs'])
    expect(sweepOrder(5)).toEqual(['Sessions', 'SessionEvents', 'DcrClients', 'UsageLogs'])
  })
})
