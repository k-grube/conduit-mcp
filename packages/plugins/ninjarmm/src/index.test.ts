import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifest, validateAgainstManifest } from '@conduit-mcp/plugin-sdk'
import plugin from './index.js'

const manifestPath = fileURLToPath(new URL('../conduit.plugin.json', import.meta.url))
const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))

describe('ninjarmm plugin manifest', () => {
  it('parses and declares all four secrets, prefix differs from id', () => {
    expect(manifest.id).toBe('ninjarmm')
    expect(manifest.name).toBe('NinjaRMM')
    expect(manifest.toolPrefix).toBe('ninja_')
    expect(manifest.secrets).toEqual(['NINJA_CLIENT_SECRET'])
  })
})

describe('ninjarmm plugin', () => {
  it('every tool name is prefixed with ninja_ and read-only', () => {
    expect(plugin.tools.length).toBeGreaterThan(0)
    expect(() => validateAgainstManifest(plugin, manifest)).not.toThrow()
    for (const tool of plugin.tools) {
      expect(tool.name.startsWith('ninja_')).toBe(true)
      expect(tool.readOnly).toBe(true)
    }
  })

  it('includes ninja_list_policies and has no duplicate tool names', () => {
    const names = plugin.tools.map((t) => t.name)
    expect(names).toContain('ninja_list_policies')
    expect(new Set(names).size).toBe(names.length)
  })
})
