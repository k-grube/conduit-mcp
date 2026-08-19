import type { PluginDisplayStatus, PluginRecord } from './plugin-queries'

export const STATUS_COLOR: Record<PluginDisplayStatus, 'success' | 'warning' | 'error' | 'default'> = {
  disabled: 'default',
  loading: 'warning',
  quarantined: 'error',
  needs_setup: 'warning',
  error: 'error',
  active: 'success',
}

export const STATUS_LABEL: Record<PluginDisplayStatus, string> = {
  disabled: 'Disabled',
  loading: 'Loading',
  quarantined: 'Quarantined',
  needs_setup: 'Needs setup',
  error: 'Error',
  active: 'Active',
}

export function statusTooltip(displayStatus: PluginDisplayStatus, rec: PluginRecord): string {
  if (displayStatus === 'quarantined') {
    return rec.lastError ?? ''
  }
  if (displayStatus === 'error') {
    return rec.health?.detail ?? ''
  }
  return ''
}
