import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundlePlugin } from '../src/plugins/bundler.js'
import { importPluginBundle, readManifest } from '../src/plugins/importer.js'

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'demo-plugin')

describe('bundle + import pipeline', () => {
  it('bundles the fixture and imports a compiled plugin', async () => {
    const out = join(await mkdtemp(join(tmpdir(), 'conduit-b1-')), 'bundle.mjs')
    await bundlePlugin({ srcDir: fixtureDir, entry: 'src/index.ts', outFile: out })
    const plugin = await importPluginBundle(out)
    expect(plugin.tools.map((t) => t.name)).toEqual(['demo_echo', 'demo_add', 'demo_fail'])
    expect(plugin.tools[0].jsonSchema).toMatchObject({ type: 'object' })
    expect(plugin.tools[0].validate({ text: 'x' })).toEqual({ ok: true, data: { text: 'x' } })
  })

  it('readManifest parses the fixture manifest', async () => {
    const m = await readManifest(fixtureDir)
    expect(m.id).toBe('demo')
    expect(m.toolPrefix).toBe('demo_')
  })

  it('bundle failure rejects with the esbuild error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-b2-'))
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'index.ts'), 'export default {{{')
    const out = join(dir, 'bundle.mjs')
    await expect(bundlePlugin({ srcDir: dir, entry: 'src/index.ts', outFile: out })).rejects.toThrow()
  })

  it('import rejects a module without a plugin default export', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-b3-'))
    const out = join(dir, 'bundle.mjs')
    await writeFile(out, 'export default 42')
    await expect(importPluginBundle(out)).rejects.toThrow(/default export/)
  })

  it('import rejects a compiled tool missing jsonSchema/validate/handler', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-b4-'))
    const out = join(dir, 'bundle.mjs')
    await writeFile(out, 'export default { tools: [{ name: "x" }] }')
    await expect(importPluginBundle(out)).rejects.toThrow(/compiled tool/)
  })
})
