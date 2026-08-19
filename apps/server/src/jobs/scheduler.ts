import { logEvent } from '../logger.js'
import { withLock } from '../storage/lock.js'

export interface JobSpec {
  intervalMs: number
  run(): Promise<void>
  leaderLock?: boolean
}

interface Job {
  spec: JobSpec
  timer?: NodeJS.Timeout
  running?: boolean
}

// withLock has no renewal, ttl must exceed worst-case run duration, not tick cadence
// matches the 600_000ms convention in plugins/loader.ts for the same no-heartbeat tradeoff
const LOCK_TTL_MS = 600_000

export class JobScheduler {
  private jobs = new Map<string, Job>()
  private running = false

  register(name: string, spec: JobSpec): void {
    if (this.jobs.has(name)) {
      throw new Error(`duplicate job name: ${name}`)
    }
    const job: Job = { spec }
    this.jobs.set(name, job)
    if (this.running) {
      this.startJob(name, job)
    }
  }

  unregister(prefix: string): void {
    // in-flight runs are not cancelled, loader jobs rely on the leader lock for overlap safety
    for (const [name, job] of this.jobs) {
      if (name.startsWith(prefix)) {
        clearInterval(job.timer)
        this.jobs.delete(name)
      }
    }
  }

  private startJob(name: string, job: Job): void {
    const tick = async () => {
      // skip if the previous tick for this job is still in flight, run can outlast intervalMs
      if (job.running) {
        logEvent('jobs', 'job_overlap_skipped', { name })
        return
      }
      job.running = true
      try {
        if (job.spec.leaderLock === false) {
          await job.spec.run()
        } else {
          await withLock(`job:${name}`, LOCK_TTL_MS, () => job.spec.run())
        }
      } catch (err) {
        logEvent('jobs', 'job_failed', { name, error: (err as Error).message })
      } finally {
        job.running = false
      }
    }
    job.timer = setInterval(() => {
      void tick()
    }, job.spec.intervalMs)
    job.timer.unref()
    // run promptly at boot too, not just after the first full interval
    void tick()
  }

  start(): void {
    if (this.running) {
      return
    }
    this.running = true
    for (const [name, job] of this.jobs) {
      this.startJob(name, job)
    }
  }

  stop(): void {
    this.running = false
    for (const job of this.jobs.values()) {
      clearInterval(job.timer)
      job.timer = undefined
    }
  }

  names(): string[] {
    return [...this.jobs.keys()]
  }
}
