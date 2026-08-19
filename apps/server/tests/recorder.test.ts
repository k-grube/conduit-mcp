import { describe, expect, it, vi } from 'vitest'
import { UsageStore, dayKey } from '../src/usage/usage-store.js'
import { createUsageRecorder } from '../src/usage/recorder.js'

const event = { tool: 'demo_echo', pluginId: 'demo', principal: 'p', ok: true, durationMs: 1, chars: 1 }

describe('createUsageRecorder', () => {
  it('persists asynchronously without blocking the caller', async () => {
    const store = new UsageStore('RecT1')
    const recorder = createUsageRecorder(store)
    recorder(event)
    await vi.waitFor(async () => {
      expect(await store.listDays([dayKey()])).toHaveLength(1)
    })
  })

  it('store failure never throws', () => {
    const store = new UsageStore('RecT2')
    vi.spyOn(store, 'write').mockRejectedValue(new Error('table down'))
    const recorder = createUsageRecorder(store)
    expect(() => recorder(event)).not.toThrow()
  })
})
