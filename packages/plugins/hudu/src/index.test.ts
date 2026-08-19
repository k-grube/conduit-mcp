import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifest, validateAgainstManifest } from '@conduit-mcp/plugin-sdk'
import plugin from './index.js'

const manifestPath = fileURLToPath(new URL('../conduit.plugin.json', import.meta.url))
const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))

describe('hudu plugin manifest', () => {
  it('parses and validates secret settings against declared secrets', () => {
    expect(manifest.id).toBe('hudu')
    expect(manifest.toolPrefix).toBe('hudu_')
    expect(manifest.secrets).toEqual(['HUDU_API_KEY'])
  })
})

describe('hudu plugin', () => {
  it('every tool name is prefixed with hudu_', () => {
    expect(plugin.tools.length).toBeGreaterThan(0)
    expect(() => validateAgainstManifest(plugin, manifest)).not.toThrow()
    for (const tool of plugin.tools) {
      expect(tool.name.startsWith('hudu_')).toBe(true)
    }
  })

  it('write and archive tools are marked not read-only, everything else is', () => {
    const writeNames = new Set([
      'hudu_create_article',
      'hudu_update_article',
      'hudu_archive_article',
      'hudu_unarchive_article',
    ])
    for (const tool of plugin.tools) {
      expect(tool.readOnly).toBe(!writeNames.has(tool.name))
    }
  })
})
