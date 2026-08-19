import { describe, expect, it } from 'vitest'
import { UsageStore, dayKey } from '../src/usage/usage-store.js'

const event = {
  tool: 'demo_echo',
  pluginId: 'demo',
  principal: 'apikey:k1',
  ok: true,
  durationMs: 12,
  chars: 5,
}

describe('dayKey', () => {
  it('formats utc yyyymmdd', () => {
    expect(dayKey(new Date('2026-07-31T23:59:59Z'))).toBe('20260731')
    expect(dayKey(new Date('2026-01-02T00:00:00Z'))).toBe('20260102')
  })
})

describe('UsageStore', () => {
  it('records an event with rid and timestamp', async () => {
    const store = new UsageStore('UsageT1')
    const rec = await store.record(event)
    expect(rec.rid).toMatch(/^[0-9a-f]{8}$/)
    expect(rec.tool).toBe('demo_echo')
    const listed = await store.listDays([dayKey()])
    expect(listed.map((r) => r.rid)).toContain(rec.rid)
  })

  it('records errors with the error field', async () => {
    const store = new UsageStore('UsageT2')
    await store.record({ ...event, ok: false, error: 'boom' })
    const [rec] = await store.listDays([dayKey()])
    expect(rec.ok).toBe(false)
    expect(rec.error).toBe('boom')
  })

  it('newer records list first within a day', async () => {
    const store = new UsageStore('UsageT3')
    const a = await store.record({ ...event, tool: 'demo_a' })
    await new Promise((r) => setTimeout(r, 5))
    const b = await store.record({ ...event, tool: 'demo_b' })
    const listed = await store.listDays([dayKey()])
    expect(listed.findIndex((r) => r.rid === b.rid)).toBeLessThan(listed.findIndex((r) => r.rid === a.rid))
  })

  it('listDays of an absent day returns empty', async () => {
    const store = new UsageStore('UsageT4')
    expect(await store.listDays(['19990101'])).toEqual([])
  })

  it('truncates a huge error to 1024 chars before persisting', async () => {
    const store = new UsageStore('UsageT5')
    await store.record({ ...event, ok: false, error: 'x'.repeat(100_000) })
    const [rec] = await store.listDays([dayKey()])
    expect(rec.error).toHaveLength(1024)
  })

  it('listRecent walks day partitions newest first up to limit', async () => {
    const store = new UsageStore('UsageT7')
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()
    await store.write({ ...event, rid: 'old1', at: yesterday })
    const a = await store.record({ ...event, tool: 'demo_a' })
    await new Promise((r) => setTimeout(r, 5))
    const b = await store.record({ ...event, tool: 'demo_b' })
    expect((await store.listRecent(10)).map((r) => r.rid)).toEqual([b.rid, a.rid, 'old1'])
    expect((await store.listRecent(2)).map((r) => r.rid)).toEqual([b.rid, a.rid])
  })

  it('listRecent with no rows returns empty', async () => {
    const store = new UsageStore('UsageT8')
    expect(await store.listRecent(10)).toEqual([])
  })

  it('forEachInDays visits the same rows listDays would return', async () => {
    const store = new UsageStore('UsageT6')
    await store.record({ ...event, tool: 'demo_a' })
    await store.record({ ...event, tool: 'demo_b' })
    await store.record({ ...event, tool: 'demo_c' })
    const seen: string[] = []
    await store.forEachInDays([dayKey()], (r) => {
      seen.push(r.rid)
    })
    const listed = await store.listDays([dayKey()])
    expect(seen.length).toBe(listed.length)
    expect(seen.sort()).toEqual(listed.map((r) => r.rid).sort())
  })
})
