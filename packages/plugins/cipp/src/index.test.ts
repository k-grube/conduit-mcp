import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseManifest, validateAgainstManifest } from '@conduit-mcp/plugin-sdk'
import plugin from './index.js'

const manifestPath = fileURLToPath(new URL('../conduit.plugin.json', import.meta.url))
const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))

describe('cipp plugin manifest', () => {
  it('parses and declares only the client secret as a secret', () => {
    expect(manifest.id).toBe('cipp')
    expect(manifest.toolPrefix).toBe('cipp_')
    expect(manifest.secrets).toEqual(['CIPP_CLIENT_SECRET'])
  })
})

describe('cipp plugin', () => {
  it('every tool is prefixed with cipp_ and read-only', () => {
    expect(plugin.tools.length).toBeGreaterThan(0)
    expect(() => validateAgainstManifest(plugin, manifest)).not.toThrow()
    for (const tool of plugin.tools) {
      expect(tool.name.startsWith('cipp_')).toBe(true)
      expect(tool.readOnly).toBe(true)
    }
  })
})
