import { describe, expect, it } from 'vitest'
import type { UsageRecord } from './usage-store.js'
import { aggregateDashboard, lastDays } from './aggregate.js'

function rec(over: Partial<UsageRecord>): UsageRecord {
  return {
    rid: 'r',
    at: '2026-07-31T10:00:00.000Z',
    tool: 'demo_echo',
    pluginId: 'demo',
    principal: 'apikey:k1',
    ok: true,
    durationMs: 10,
    chars: 5,
    ...over,
  }
}

describe('lastDays', () => {
  it('returns n utc day keys ending at from, oldest first', () => {
    expect(lastDays(3, new Date('2026-07-31T12:00:00Z'))).toEqual(['20260729', '20260730', '20260731'])
  })
})

describe('aggregateDashboard', () => {
  it('computes totals and per-tool stats', () => {
    const m = aggregateDashboard(
      [
        rec({ durationMs: 10 }),
        rec({ durationMs: 30 }),
        rec({ tool: 'demo_fail', ok: false, error: 'boom', durationMs: 5 }),
      ],
      ['20260731'],
    )
    expect(m.totals).toEqual({ calls: 3, errors: 1, avgMs: 15 })
    expect(m.tools[0]).toEqual({ tool: 'demo_echo', pluginId: 'demo', calls: 2, errors: 0, avgMs: 20 })
    expect(m.tools[1]).toEqual({ tool: 'demo_fail', pluginId: 'demo', calls: 1, errors: 1, avgMs: 5 })
  })

  it('fills zero days and buckets by at-date', () => {
    const m = aggregateDashboard(
      [rec({ at: '2026-07-30T01:00:00.000Z' }), rec({ at: '2026-07-31T01:00:00.000Z' })],
      ['20260729', '20260730', '20260731'],
    )
    expect(m.daily).toEqual([
      { day: '20260729', calls: 0, errors: 0 },
      { day: '20260730', calls: 1, errors: 0 },
      { day: '20260731', calls: 1, errors: 0 },
    ])
  })

  it('counts principals by calls desc', () => {
    const m = aggregateDashboard([rec({}), rec({}), rec({ principal: 'user:oid-1' })], ['20260731'])
    expect(m.principals).toEqual([
      { principal: 'apikey:k1', calls: 2 },
      { principal: 'user:oid-1', calls: 1 },
    ])
  })

  it('empty input yields zeroed metrics', () => {
    const m = aggregateDashboard([], ['20260731'])
    expect(m.totals).toEqual({ calls: 0, errors: 0, avgMs: 0 })
    expect(m.tools).toEqual([])
  })
})
