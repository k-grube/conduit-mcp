import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginRegistryStore } from '../../src/storage/plugin-registry.js'
import { ToolCatalog } from '../../src/catalog/catalog.js'
import { ToolSearch } from '../../src/catalog/search.js'
import { PluginLoader } from '../../src/plugins/loader.js'
import { seedLocalPlugins } from '../../src/plugins/seed.js'
import { createPluginContext } from '../../src/plugins/context.js'
import { ConfigStore } from '../../src/storage/config-store.js'
import type { SecretProvider } from '../../src/secrets/provider.js'

export const REAL_PLUGINS_DIR = fileURLToPath(new URL('../../../../packages/plugins', import.meta.url))

// no secrets configured anywhere -- every ctx.getSecret rejects, so a plugin's client
// fails before it ever reaches a real fetch call
export const noSecrets: SecretProvider = {
  writable: false,
  getSecret: async (name) => {
    throw new Error(`no secret configured in test: ${name}`)
  },
  setSecret: async () => {},
}

export interface RealPluginCatalog {
  registry: PluginRegistryStore
  catalog: ToolCatalog
  search: ToolSearch
}

// loads all five real in-repo plugin packages (real esbuild bundle, local source) into a
// fresh catalog. tableSuffix keeps azurite table names unique per calling test suite.
export async function loadRealPluginCatalog(tableSuffix: string): Promise<RealPluginCatalog> {
  const registry = new PluginRegistryStore(`Rip${tableSuffix}Plug`)
  const catalog = new ToolCatalog()
  const config = new ConfigStore({ tableName: `Rip${tableSuffix}Cfg` })
  const loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-rip-')),
    createContext: (manifest) =>
      createPluginContext(manifest, {
        secrets: noSecrets,
        config,
        getCatalog: () => catalog,
        storeTableName: `Rip${tableSuffix}Store`,
      }),
  })
  await seedLocalPlugins(registry, REAL_PLUGINS_DIR)
  // seed leaves plugins disabled, these suites want everything loaded
  for (const rec of await registry.list()) {
    await registry.upsert({ ...rec, enabled: true })
  }
  await loader.loadAll()
  return { registry, catalog, search: new ToolSearch(catalog) }
}
