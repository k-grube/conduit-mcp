import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginRegistryStore } from '../storage/plugin-registry.js'
import { logEvent } from '../logger.js'
import { readManifest } from './importer.js'

// seeds a disabled 'loading' local record for every dir under `dir` with a conduit.plugin.json,
// skipping ids the registry already knows about -- an existing record wins
export async function seedLocalPlugins(registry: PluginRegistryStore, dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err: Error) => {
    logEvent('plugins', 'seed_dir_unreadable', { dir, error: err.message })
    return []
  })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const pluginDir = join(dir, entry.name)
    const manifest = await readManifest(pluginDir).catch((err: Error) => {
      logEvent('plugins', 'seed_manifest_invalid', { dir: pluginDir, error: err.message })
      return undefined
    })
    if (!manifest) {
      continue
    }
    if (await registry.get(manifest.id)) {
      continue
    }
    await registry.upsert({
      id: manifest.id,
      source: 'local',
      localPath: pluginDir,
      enabled: false,
      status: 'loading',
    })
  }
}
