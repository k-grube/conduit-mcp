import { describe, expect, it } from 'vitest'
import { decideSetupGate } from './gate.js'

describe('decideSetupGate', () => {
  it('unconfigured: wizard api + auth-config pass, other api 503', () => {
    expect(decideSetupGate('/api/setup/device-code', false)).toBe('pass')
    expect(decideSetupGate('/api/setup/status', false)).toBe('pass')
    expect(decideSetupGate('/api/admin/auth-config', false)).toBe('pass')
    expect(decideSetupGate('/api/admin/activity', false)).toBe('unavailable')
    expect(decideSetupGate('/api/plugins/foo', false)).toBe('unavailable')
    expect(decideSetupGate('/mcp', false)).toBe('pass')
    expect(decideSetupGate('/', false)).toBe('pass')
  })
  it('configured: wizard mutating api 404, status + rest pass', () => {
    expect(decideSetupGate('/api/setup/provision', true)).toBe('not-found')
    expect(decideSetupGate('/api/setup/poll', true)).toBe('not-found')
    expect(decideSetupGate('/api/setup/status', true)).toBe('pass')
    expect(decideSetupGate('/api/admin/activity', true)).toBe('pass')
    expect(decideSetupGate('/mcp', true)).toBe('pass')
  })
})
