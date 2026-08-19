import { describe, expect, it } from 'vitest'
import { SetupSessionStore, freshSteps, tokenMatches } from './session.js'

describe('SetupSessionStore', () => {
  it('starts a session with fresh pending steps', () => {
    const store = new SetupSessionStore()
    const s = store.start('dc-1', 5)
    expect(s.deviceCode).toBe('dc-1')
    expect(s.provisioning).toBe(false)
    expect(s.steps.every((st) => st.state === 'pending')).toBe(true)
    expect(store.get()).toBe(s)
  })

  it('a new start replaces the current session', () => {
    const store = new SetupSessionStore()
    store.start('dc-1', 5)
    const s2 = store.start('dc-2', 5)
    expect(store.get()).toBe(s2)
  })

  it('expires after 15 minutes', () => {
    let t = 0
    const store = new SetupSessionStore(() => t)
    store.start('dc-1', 5)
    t = 15 * 60 * 1000 + 1
    expect(store.get()).toBeUndefined()
  })

  it('clear drops the session', () => {
    const store = new SetupSessionStore()
    store.start('dc-1', 5)
    store.clear()
    expect(store.get()).toBeUndefined()
  })

  it('start mints a token; tokenMatches accepts it, rejects wrong/missing', () => {
    const store = new SetupSessionStore()
    const s = store.start('dc-1', 5)
    expect(typeof s.token).toBe('string')
    expect(s.token.length).toBeGreaterThan(0)
    expect(tokenMatches(s.token, s)).toBe(true)
    expect(tokenMatches('wrong', s)).toBe(false)
    expect(tokenMatches(undefined, s)).toBe(false)
  })

  it('a fresh start mints a distinct token', () => {
    const store = new SetupSessionStore()
    const first = store.start('dc-1', 5).token
    const second = store.start('dc-2', 5).token
    expect(second).not.toBe(first)
  })

  it('freshSteps returns all eight step ids in chain order', () => {
    expect(freshSteps().map((s) => s.id)).toEqual([
      'app',
      'manifest',
      'sp',
      'consent',
      'secret',
      'store',
      'admin',
      'config',
    ])
  })
})
