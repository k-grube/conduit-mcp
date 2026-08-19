import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifest, validateAgainstManifest } from '@conduit-mcp/plugin-sdk'
import plugin from './index.js'

const manifestPath = fileURLToPath(new URL('../conduit.plugin.json', import.meta.url))
const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))

describe('halopsa plugin manifest', () => {
  it('parses and declares only the client secret as a secret', () => {
    expect(manifest.id).toBe('halopsa')
    expect(manifest.name).toBe('HaloPSA')
    expect(manifest.toolPrefix).toBe('halopsa_')
    expect(manifest.secrets).toEqual(['HALOPSA_CLIENT_SECRET'])
  })
})

describe('halopsa plugin', () => {
  it('every tool name is prefixed with halopsa_, write tools marked not read-only', () => {
    expect(plugin.tools.length).toBeGreaterThan(0)
    expect(() => validateAgainstManifest(plugin, manifest)).not.toThrow()
    const writeNames = new Set([
      'halopsa_add_action',
      'halopsa_create_report',
      'halopsa_update_report',
      'halopsa_create_dashboard',
      'halopsa_update_dashboard',
      'halopsa_add_dashboard_widget',
      'halopsa_update_dashboard_widget',
      'halopsa_remove_dashboard_widget',
      'halopsa_create_ticket',
      'halopsa_add_crm_note',
    ])
    for (const tool of plugin.tools) {
      expect(tool.name.startsWith('halopsa_')).toBe(true)
      expect(tool.readOnly).toBe(!writeNames.has(tool.name))
    }
  })

  it('has no duplicate tool names', () => {
    const names = plugin.tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
