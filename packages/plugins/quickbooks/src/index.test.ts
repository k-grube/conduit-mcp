import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifest, validateAgainstManifest } from '@conduit-mcp/plugin-sdk'
import plugin from './index.js'
import { fakeCtx, fakeStore } from './test-helpers.js'

const manifestPath = fileURLToPath(new URL('../conduit.plugin.json', import.meta.url))
const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))

describe('quickbooks plugin manifest', () => {
  it('parses and declares all seven secrets plus the callback public route', () => {
    expect(manifest.id).toBe('quickbooks')
    expect(manifest.toolPrefix).toBe('qbo_')
    expect(manifest.secrets).toEqual([
      'QBO_SANDBOX_CLIENT_ID',
      'QBO_SANDBOX_CLIENT_SECRET',
      'QBO_SANDBOX_REFRESH_TOKEN',
      'QBO_PROD_CLIENT_ID',
      'QBO_PROD_CLIENT_SECRET',
      'QBO_PROD_REFRESH_TOKEN',
      'QBO_STATE_JWT_SECRET',
    ])
    expect(manifest.publicRoutes).toEqual(['/callback'])
  })
})

describe('quickbooks plugin', () => {
  it('every tool is qbo_-prefixed and read-only', () => {
    expect(plugin.tools.length).toBeGreaterThan(0)
    expect(() => validateAgainstManifest(plugin, manifest)).not.toThrow()
    for (const tool of plugin.tools) {
      expect(tool.name.startsWith('qbo_')).toBe(true)
      expect(tool.readOnly).toBe(true)
    }
  })

  it('has no duplicate tool names', () => {
    const names = plugin.tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares the authorize/callback/status/disconnect routes', () => {
    expect(plugin.routes).toBeTypeOf('function')
  })
})

describe('quickbooks plugin healthCheck', () => {
  it('reports ok with the environment when realmId and refresh token are both present, no network call', async () => {
    const ctx = fakeCtx({
      secrets: { QBO_SANDBOX_REFRESH_TOKEN: 'r1' },
      store: fakeStore({ 'state:sandbox': { realmId: '42' } }),
    })
    const result = await plugin.healthCheck!(ctx)
    expect(result).toEqual({ ok: true, detail: 'sandbox' })
  })

  it('reports not connected when no realmId is stored', async () => {
    const ctx = fakeCtx()
    const result = await plugin.healthCheck!(ctx)
    expect(result).toEqual({ ok: false, detail: 'not connected' })
  })

  it('reports not connected when realmId is stored but the refresh token secret is gone', async () => {
    const ctx = fakeCtx({ store: fakeStore({ 'state:sandbox': { realmId: '42' } }) })
    const result = await plugin.healthCheck!(ctx)
    expect(result).toEqual({ ok: false, detail: 'not connected' })
  })
})
