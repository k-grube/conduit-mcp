import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { seedLocalPlugins } from '../src/plugins/seed.js'

async function writeFixtureManifest(dir: string, id: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'conduit.plugin.json'),
    JSON.stringify({ id, name: id, toolPrefix: `${id}_`, entry: 'src/index.ts', sdkVersion: '^0.1' }),
  )
}

describe('seedLocalPlugins', () => {
  it('seeds new local records and leaves existing records untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-seed-'))
    await writeFixtureManifest(join(dir, 'alpha'), 'alpha')
    await writeFixtureManifest(join(dir, 'beta'), 'beta')

    const registry = new PluginRegistryStore('SeedT1')
    // beta is already registered and disabled -- seeding must not re-enable it
    await registry.upsert({
      id: 'beta',
      source: 'local',
      localPath: join(dir, 'beta'),
      enabled: false,
      status: 'quarantined',
      lastError: 'pre-existing',
    })

    await seedLocalPlugins(registry, dir)

    const alpha = await registry.get('alpha')
    expect(alpha).toEqual({
      id: 'alpha',
      source: 'local',
      localPath: join(dir, 'alpha'),
      enabled: false,
      status: 'loading',
    })

    const beta = await registry.get('beta')
    expect(beta).toEqual({
      id: 'beta',
      source: 'local',
      localPath: join(dir, 'beta'),
      enabled: false,
      status: 'quarantined',
      lastError: 'pre-existing',
    })
  })

  it('skips dirs without a conduit.plugin.json and a missing root dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conduit-seed-'))
    await mkdir(join(dir, 'not-a-plugin'), { recursive: true })
    await writeFile(join(dir, 'stray-file.txt'), 'x')

    const registry = new PluginRegistryStore('SeedT2')
    await seedLocalPlugins(registry, dir)
    expect(await registry.list()).toEqual([])

    await expect(seedLocalPlugins(registry, join(dir, 'nope'))).resolves.toBeUndefined()
    expect(await registry.list()).toEqual([])
  })
})
