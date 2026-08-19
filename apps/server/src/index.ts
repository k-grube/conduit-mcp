import { fileURLToPath } from 'node:url'
import { ConfigStore } from './storage/config-store.js'
import { PluginRegistryStore } from './storage/plugin-registry.js'
import { RolesStore } from './storage/roles-store.js'
import { ApiKeysStore } from './storage/api-keys-store.js'
import { createSecretProvider } from './secrets/provider.js'
import { ToolCatalog } from './catalog/catalog.js'
import { ToolSearch } from './catalog/search.js'
import { NotesService } from './catalog/notes.js'
import { createPluginContext } from './plugins/context.js'
import { PluginLoader } from './plugins/loader.js'
import { seedLocalPlugins } from './plugins/seed.js'
import { PluginRoutesRegistry } from './plugins/routes-registry.js'
import { AdtEventStore } from './mcp/event-store.js'
import { AdtSessionStore } from './mcp/session-store.js'
import { ensureBootstrapAdmin, seedAuthFromEnv } from './auth/bootstrap.js'
import { createApp } from './app.js'
import { logEvent } from './logger.js'
import { UsageStore } from './usage/usage-store.js'
import { createUsageRecorder } from './usage/recorder.js'
import { JobScheduler } from './jobs/scheduler.js'
import { registerRetentionJob } from './jobs/retention.js'

const port = Number(process.env.PORT ?? 4000)
const pluginsRoot = process.env.PLUGINS_ROOT ?? '/home/conduit/plugins'
const inRepoPluginsDir =
  process.env.IN_REPO_PLUGINS_DIR ?? fileURLToPath(new URL('../../../packages/plugins', import.meta.url))

const config = new ConfigStore()
const secrets = createSecretProvider()
const registry = new PluginRegistryStore()
const catalog = new ToolCatalog()
const roles = new RolesStore()
const usage = new UsageStore()
// shared with createApp below so plugin-to-plugin invokes and mcp invokes land in the same recorder
const onUsage = createUsageRecorder(usage)
const scheduler = new JobScheduler()
const routesRegistry = new PluginRoutesRegistry()
const loader = new PluginLoader({
  registry,
  catalog,
  pluginsRoot,
  createContext: (manifest) => createPluginContext(manifest, { secrets, config, getCatalog: () => catalog, onUsage }),
  scheduler,
  routes: routesRegistry,
})

await seedLocalPlugins(registry, inRepoPluginsDir)
await loader.loadAll()
const notes = new NotesService({ config, catalog })
await notes.start()
registerRetentionJob(scheduler, config)
scheduler.start()
await roles.seedBuiltins()
await ensureBootstrapAdmin(roles, process.env.BOOTSTRAP_ADMIN_OID)
await seedAuthFromEnv(config, process.env)
const { app } = await createApp({
  catalog,
  search: new ToolSearch(catalog),
  sessions: new AdtSessionStore(),
  eventStore: new AdtEventStore(),
  roles,
  apiKeys: new ApiKeysStore(),
  config,
  usage,
  onUsage,
  secrets,
  registry,
  loader,
  routesRegistry,
  notes,
  webDist: process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/out', import.meta.url)),
  setup: {
    bootstrapAdminOid: process.env.BOOTSTRAP_ADMIN_OID,
    bootstrapClientId: process.env.CONDUIT_BOOTSTRAP_CLIENT_ID,
  },
})
app.listen(port, () => {
  logEvent('server', 'listening', { port, plugins: catalog.integrations().length })
})
