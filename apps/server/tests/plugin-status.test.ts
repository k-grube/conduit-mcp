import { describe, expect, it } from 'vitest'
import { parseManifest } from '@conduit-mcp/plugin-sdk'
import type { PluginRecord } from '../src/storage/plugin-registry.js'
import type { SecretProvider } from '../src/secrets/provider.js'
import { ConfigStore } from '../src/storage/config-store.js'
import { computeConfigured, deriveDisplayStatus } from '../src/plugins/status.js'

function rec(patch: Partial<PluginRecord>): PluginRecord {
  return { id: 'p', source: 'local', localPath: '/x', enabled: true, status: 'active', ...patch }
}

const secretsWith = (names: string[]): SecretProvider => ({
  writable: false,
  getSecret: async (n) => {
    if (!names.includes(n)) {
      throw new Error(`missing ${n}`)
    }
    return 'v'
  },
  setSecret: async () => {},
})

describe('deriveDisplayStatus', () => {
  it('applies precedence disabled > loading > quarantined > needs_setup > error > active', () => {
    expect(deriveDisplayStatus(rec({ enabled: false, status: 'quarantined' }), false)).toBe('disabled')
    expect(deriveDisplayStatus(rec({ status: 'loading' }), false)).toBe('loading')
    expect(deriveDisplayStatus(rec({ status: 'quarantined' }), false)).toBe('quarantined')
    expect(deriveDisplayStatus(rec({}), false)).toBe('needs_setup')
    const failing = { ok: false, detail: 'down', checkedAt: '2026-08-12T00:00:00.000Z' }
    expect(deriveDisplayStatus(rec({ health: failing }), true)).toBe('error')
    expect(deriveDisplayStatus(rec({ health: { ok: true, checkedAt: '2026-08-12T00:00:00.000Z' } }), true)).toBe(
      'active',
    )
    expect(deriveDisplayStatus(rec({}), true)).toBe('active')
  })
})

describe('computeConfigured', () => {
  const manifest = parseManifest({
    id: 'p',
    name: 'P',
    toolPrefix: 'p_',
    entry: 'src/index.ts',
    sdkVersion: '^0.1',
    secrets: ['P_URL', 'P_KEY', 'P_OPT'],
    ui: {
      settings: [
        { key: 'P_URL', label: 'URL', type: 'secret', required: true },
        { key: 'P_KEY', label: 'Key', type: 'secret', required: true },
        { key: 'P_OPT', label: 'Optional', type: 'secret' },
        { key: 'viewId', label: 'View', type: 'text', required: true },
      ],
    },
  })

  it('true when every required field has a value', async () => {
    const config = new ConfigStore({ tableName: 'PStatCfg1' })
    await config.updateDomain('plugin:p', { viewId: '7' })
    expect(await computeConfigured(manifest, { secrets: secretsWith(['P_URL', 'P_KEY']), config })).toBe(true)
  })

  it('false when a required secret is unset', async () => {
    const config = new ConfigStore({ tableName: 'PStatCfg2' })
    await config.updateDomain('plugin:p', { viewId: '7' })
    expect(await computeConfigured(manifest, { secrets: secretsWith(['P_URL']), config })).toBe(false)
  })

  it('false when a required secret resolves to an empty string', async () => {
    const config = new ConfigStore({ tableName: 'PStatCfg2b' })
    await config.updateDomain('plugin:p', { viewId: '7' })
    const emptySecret: SecretProvider = {
      writable: false,
      getSecret: async (n) => (n === 'P_URL' ? '' : 'v'),
      setSecret: async () => {},
    }
    expect(await computeConfigured(manifest, { secrets: emptySecret, config })).toBe(false)
  })

  it('false when a required config value is missing or empty', async () => {
    const config = new ConfigStore({ tableName: 'PStatCfg3' })
    expect(await computeConfigured(manifest, { secrets: secretsWith(['P_URL', 'P_KEY']), config })).toBe(false)
    await config.updateDomain('plugin:p', { viewId: '' })
    expect(await computeConfigured(manifest, { secrets: secretsWith(['P_URL', 'P_KEY']), config })).toBe(false)
  })

  it('true with no manifest or no required fields', async () => {
    const config = new ConfigStore({ tableName: 'PStatCfg4' })
    expect(await computeConfigured(undefined, { secrets: secretsWith([]), config })).toBe(true)
    const bare = parseManifest({ id: 'p', name: 'P', toolPrefix: 'p_', entry: 'src/index.ts', sdkVersion: '^0.1' })
    expect(await computeConfigured(bare, { secrets: secretsWith([]), config })).toBe(true)
  })
})
