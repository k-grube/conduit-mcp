import type { UsageEvent } from '../mcp/meta-tools.js'
import { logEvent } from '../logger.js'
import { buildUsageRecord, type UsageStore } from './usage-store.js'

export function createUsageRecorder(store: UsageStore): (e: UsageEvent) => void {
  return (e) => {
    void store.write(buildUsageRecord(e)).catch((err: Error) => {
      logEvent('usage', 'record_failed', { error: err.message })
    })
  }
}
