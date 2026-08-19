import { afterEach, describe, expect, it, vi } from 'vitest'
import { JobScheduler } from '../src/jobs/scheduler.js'

let scheduler: JobScheduler

afterEach(() => {
  scheduler?.stop()
})

describe('JobScheduler', () => {
  it('runs a registered job on its interval', async () => {
    scheduler = new JobScheduler()
    const run = vi.fn(async () => {})
    scheduler.register('t1-tick', { intervalMs: 50, run, leaderLock: false })
    scheduler.start()
    await vi.waitFor(() => {
      expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('throws on duplicate name', () => {
    scheduler = new JobScheduler()
    scheduler.register('t2-a', { intervalMs: 1000, run: async () => {} })
    expect(() => scheduler.register('t2-a', { intervalMs: 1000, run: async () => {} })).toThrow(/duplicate/)
  })

  it('unregister by prefix stops jobs', async () => {
    scheduler = new JobScheduler()
    const run = vi.fn(async () => {})
    scheduler.register('plugin:x:tick', { intervalMs: 30, run, leaderLock: false })
    scheduler.start()
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalled()
    })
    scheduler.unregister('plugin:x:')
    const count = run.mock.calls.length
    await new Promise((r) => setTimeout(r, 100))
    expect(run.mock.calls.length).toBe(count)
    expect(scheduler.names()).toEqual([])
  })

  it('job errors are swallowed and the job keeps running', async () => {
    scheduler = new JobScheduler()
    const run = vi.fn(async () => {
      throw new Error('boom')
    })
    scheduler.register('t4-err', { intervalMs: 30, run, leaderLock: false })
    scheduler.start()
    await vi.waitFor(() => {
      expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('leader lock prevents concurrent double-run of the same job', async () => {
    const a = new JobScheduler()
    const b = new JobScheduler()
    let active = 0
    let overlapped = false
    const slow = async () => {
      active++
      if (active > 1) {
        overlapped = true
      }
      await new Promise((r) => setTimeout(r, 80))
      active--
    }
    a.register('t5-leader', { intervalMs: 40, run: slow })
    b.register('t5-leader', { intervalMs: 40, run: slow })
    a.start()
    b.start()
    await new Promise((r) => setTimeout(r, 300))
    a.stop()
    b.stop()
    expect(overlapped).toBe(false)
  })

  it('runs once immediately on start rather than waiting a full interval', async () => {
    scheduler = new JobScheduler()
    const run = vi.fn(async () => {})
    scheduler.register('t8-immediate', { intervalMs: 60_000, run, leaderLock: false })
    scheduler.start()
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1)
    })
  })

  it('registering after start begins ticking', async () => {
    scheduler = new JobScheduler()
    scheduler.start()
    const run = vi.fn(async () => {})
    scheduler.register('t6-late', { intervalMs: 30, run, leaderLock: false })
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalled()
    })
  })

  it('logs job_overlap_skipped when a tick fires while the previous run is still in flight', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    scheduler = new JobScheduler()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const run = vi.fn(async () => {
      await gate
    })
    scheduler.register('t7-overlap', { intervalMs: 20, run, leaderLock: false })
    scheduler.start()
    // two intervals elapse while the first run is still gated, each should log a skip
    await new Promise((r) => setTimeout(r, 70))
    release()
    const lines = spy.mock.calls.map(([line]) => String(line))
    expect(lines.some((l) => l.includes('job_overlap_skipped') && l.includes('t7-overlap'))).toBe(true)
    spy.mockRestore()
  })
})
