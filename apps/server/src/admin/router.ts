import { Router, type Request, type Response } from 'express'
import type { EntraValidator } from '../auth/entra.js'
import { createPortalAuthMiddleware, requirePortalAdmin, PORTAL_SCOPE } from '../auth/portal.js'
import type { ApiKeysStore } from '../storage/api-keys-store.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { RolesStore } from '../storage/roles-store.js'
import type { PluginRegistryStore } from '../storage/plugin-registry.js'
import type { PluginLoader } from '../plugins/loader.js'
import type { ToolCatalog } from '../catalog/catalog.js'
import type { SecretProvider } from '../secrets/provider.js'
import { createDashboardAccumulator, lastDays } from '../usage/aggregate.js'
import type { UsageStore } from '../usage/usage-store.js'
import { loadNotesSnapshot } from '../catalog/notes.js'
import { withLock } from '../storage/lock.js'
import { createRolesRouter } from './roles-router.js'
import { createKeysRouter } from './keys-router.js'
import type { GraphClient } from './graph-client.js'
import { createGraphRouter } from './graph-router.js'
import { createConfigRouter } from './config-router.js'
import { createPluginsRouter } from './plugins-router.js'
import { createPluginConfigRouter } from './plugin-config-router.js'
import { createSystemRouter } from './system-router.js'
import type { UpdateCache } from './system.js'

export interface AdminDeps {
  usage: UsageStore
  roles: RolesStore
  config: ConfigStore
  apiKeys: ApiKeysStore
  secrets: SecretProvider
  registry: PluginRegistryStore
  loader: PluginLoader
  catalog: ToolCatalog
  getValidator(): EntraValidator | undefined
  dropAllSessions: () => Promise<void>
  getGraph: () => GraphClient | undefined
  updates?: UpdateCache
}

function intParam(raw: unknown, fallback: number, min: number, max: number): number | undefined {
  if (raw === undefined) {
    return fallback
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    return undefined
  }
  return n
}

// same ttl as the lifecycle lock in plugins-router, no heartbeat renewal so it must exceed worst-case load
const LIFECYCLE_LOCK_TTL_MS = 600_000

export function createAdminRouter(deps: AdminDeps): Router {
  const router = Router()

  // plugin clients cache module-scope state, so reload (not just a health check) is what makes rotated credentials take effect
  async function refreshPlugin(id: string): Promise<void> {
    await withLock(`plugin-lifecycle:${id}`, LIFECYCLE_LOCK_TTL_MS, async () => {
      const record = await deps.registry.get(id)
      if (!record || !record.enabled) {
        return
      }
      // same pinned code, load() re-imports the module fresh and re-runs health internally
      await deps.loader.load(record)
    })
    // withLock returns undefined on contention, skip silently: the save already succeeded
  }

  router.get('/auth-config', async (_req: Request, res: Response) => {
    const auth = await deps.config.getDomain<{ tenantId?: string; clientId?: string }>('auth')
    const configured = Boolean(auth.tenantId && auth.clientId)
    res.json({
      configured,
      ...(configured
        ? {
            tenantId: auth.tenantId,
            clientId: auth.clientId,
            portalScope: `api://${auth.clientId}/${PORTAL_SCOPE}`,
          }
        : {}),
    })
  })

  router.use(createPortalAuthMiddleware({ getValidator: deps.getValidator, roles: deps.roles }))
  router.use(requirePortalAdmin)

  router.use('/roles', createRolesRouter({ roles: deps.roles, onChanged: deps.dropAllSessions }))

  router.use('/keys', createKeysRouter({ apiKeys: deps.apiKeys, roles: deps.roles }))

  router.use('/graph', createGraphRouter({ getGraph: deps.getGraph }))

  router.use('/config', createConfigRouter({ config: deps.config }))

  router.use('/system', createSystemRouter({ updates: deps.updates }))

  router.use(
    '/plugins',
    createPluginConfigRouter({
      config: deps.config,
      secrets: deps.secrets,
      catalog: deps.catalog,
      registry: deps.registry,
      refresh: refreshPlugin,
    }),
  )

  router.use(
    '/plugins',
    createPluginsRouter({
      registry: deps.registry,
      loader: deps.loader,
      catalog: deps.catalog,
      config: deps.config,
      secrets: deps.secrets,
    }),
  )

  router.get('/tools', (_req: Request, res: Response) => {
    res.json({
      tools: deps.catalog.list().map((e) => ({
        name: e.name,
        pluginId: e.pluginId,
        integrationName: e.integrationName,
        description: e.description,
        readOnly: e.readOnly,
        jsonSchema: e.jsonSchema,
      })),
    })
  })

  router.get('/tool-notes', async (_req: Request, res: Response) => {
    res.json(await loadNotesSnapshot(deps.config))
  })

  router.get('/dashboard', async (req: Request, res: Response) => {
    const days = intParam(req.query.days, 7, 1, 90)
    if (days === undefined) {
      res.status(400).json({ error: 'invalid days' })
      return
    }
    const keys = lastDays(days)
    const acc = createDashboardAccumulator(keys)
    await deps.usage.forEachInDays(keys, (r) => acc.add(r))
    res.json(acc.result())
  })

  router.get('/activity', async (req: Request, res: Response) => {
    const limit = intParam(req.query.limit, 50, 1, 200)
    if (limit === undefined) {
      res.status(400).json({ error: 'invalid limit' })
      return
    }
    res.json({ items: await deps.usage.listRecent(limit) })
  })

  return router
}
