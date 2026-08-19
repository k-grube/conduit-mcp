import fs from 'node:fs'
import path from 'node:path'
import express, { type ErrorRequestHandler, type RequestHandler, type Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import type { ApiKeysStore } from './storage/api-keys-store.js'
import type { ConfigStore } from './storage/config-store.js'
import type { PluginRegistryStore } from './storage/plugin-registry.js'
import type { PluginLoader } from './plugins/loader.js'
import type { PluginRoutesRegistry } from './plugins/routes-registry.js'
import { createAuthMiddleware } from './auth/middleware.js'
import { createPortalAuthMiddleware, PORTAL_ADMIN_ROLE } from './auth/portal.js'
import { EntraValidator, type EntraConfig } from './auth/entra.js'
import { AdtClientsStore, GuardedClientsStore, DEFAULT_REDIRECT_HOSTS } from './auth/dcr-store.js'
import { createOAuthRouter, resourceMetadataUrlFor } from './auth/oauth.js'
import { modeAllows, resolvePermissions, NO_PERMISSIONS } from './auth/permissions.js'
import type { Principal } from './auth/principal.js'
import { createMcpRouter, type McpRouterDeps } from './mcp/router.js'
import { createAdminRouter } from './admin/router.js'
import { GraphClient } from './admin/graph-client.js'
import { createUpdateCache, updateNotice, type UpdateCache } from './admin/system.js'
import { createSetupRouter } from './setup/router.js'
import { createSetupGate } from './setup/gate.js'
import { SetupService } from './setup/service.js'
import { SetupSessionStore } from './setup/session.js'
import { createUsageRecorder } from './usage/recorder.js'
import type { UsageStore } from './usage/usage-store.js'
import type { SecretProvider } from './secrets/provider.js'
import type { Role } from './storage/roles-store.js'
import { invokeCallerContext } from './plugins/context.js'
import { securityHeaders } from './security-headers.js'
import { logEvent } from './logger.js'

export interface AppDeps extends McpRouterDeps {
  apiKeys: ApiKeysStore
  config: ConfigStore
  usage: UsageStore
  secrets: SecretProvider
  registry: PluginRegistryStore
  loader: PluginLoader
  routesRegistry: PluginRoutesRegistry
  createValidator?: (cfg: EntraConfig) => EntraValidator
  webDist?: string
  setup?: { bootstrapAdminOid?: string; bootstrapClientId?: string }
  updates?: UpdateCache
}

type AuthDomain = {
  tenantId?: string
  clientId?: string
  serverUrl?: string
  redirectHosts?: string[]
}

interface AuthState {
  validator?: EntraValidator
  metadataUrl?: string
  graph?: GraphClient
  oauthRouter?: Router
}

export async function createApp(
  deps: AppDeps,
): Promise<{ app: express.Express; close(): Promise<void>; dropAllSessions(): Promise<void> }> {
  const app = express()
  // behind azure app service ingress: trust the first proxy hop so req.ip is the real client,
  // which the rate limiters key on (otherwise every caller shares one bucket)
  app.set('trust proxy', 1)
  app.use(securityHeaders())
  app.use(express.json({ limit: '4mb' }))
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true })
  })

  const authState: AuthState = {}
  let authDomainCache: AuthDomain = {}
  // dcr is open registration, wrap once and read the current allowlist live on every registerClient call
  const dcrClients = new GuardedClientsStore(
    new AdtClientsStore(),
    () => authDomainCache.redirectHosts ?? DEFAULT_REDIRECT_HOSTS,
  )

  async function applyAuthDomain(): Promise<void> {
    const auth = await deps.config.getDomain<AuthDomain>('auth')
    const next: AuthState = {}
    if (auth.tenantId && auth.clientId) {
      const cfg = { tenantId: auth.tenantId, clientId: auth.clientId }
      next.validator = (deps.createValidator ?? ((c) => new EntraValidator(c)))(cfg)
      next.graph = new GraphClient(cfg, deps.secrets)
      if (auth.serverUrl) {
        next.metadataUrl = resourceMetadataUrlFor(auth.serverUrl)
        // can throw on a bad issuer url, build it before committing so a rejected reload
        // never leaves a validator/oauthRouter mismatch
        next.oauthRouter = createOAuthRouter(
          { tenantId: auth.tenantId, clientId: auth.clientId, serverUrl: auth.serverUrl },
          {
            clients: dcrClients,
            validator: next.validator,
            getClientSecret: () => deps.secrets.getSecret('AZURE_CLIENT_SECRET'),
          },
        )
      }
    }
    authDomainCache = auth
    authState.validator = next.validator
    authState.graph = next.graph
    authState.metadataUrl = next.metadataUrl
    authState.oauthRouter = next.oauthRouter
  }

  // config read once at startup then hot-reloaded via config.onChange below
  // serverUrl validated at write time, a throw here is a legacy row or sdk mismatch, crash and restart
  await applyAuthDomain()

  const updates = deps.updates ?? createUpdateCache(process.env)
  // warm the cache so the first mcp session after boot can carry the notice; without a baked
  // image ref this resolves sync as unavailable, no network
  void updates.check().catch(() => {})

  const onUsage = deps.onUsage ?? createUsageRecorder(deps.usage)
  const mcp = createMcpRouter({
    ...deps,
    onUsage,
    getInstructions: deps.getInstructions ?? (() => updateNotice(updates.peek())),
  })

  // in-process listener only, fires for this replica's own updateDomain calls,
  // cross-replica reload still needs a restart
  const offAuthReload = deps.config.onChange((domain) => {
    if (domain !== 'auth') {
      return
    }
    void applyAuthDomain()
      .then(() => mcp.dropAllSessions())
      .then(() => logEvent('config', 'auth_reloaded'))
      .catch((err: Error) => logEvent('config', 'auth_reload_failed', { error: err.message }))
  })

  // setup-mode gate: unconfigured 503s non-setup api and keeps the wizard api open,
  // configured 404s the wizard api (status stays 200 for the completion poll)
  app.use(createSetupGate(() => Boolean(authState.validator)))

  // oauth router is rebuilt on reload, delegate to whatever's current instead of mounting a fixed router
  app.use((req, res, next) => {
    if (authState.oauthRouter) {
      authState.oauthRouter(req, res, next)
      return
    }
    next()
  })

  app.use(
    '/mcp',
    createAuthMiddleware({
      apiKeys: deps.apiKeys,
      getValidator: () => authState.validator,
      resourceMetadataUrl: () => authState.metadataUrl,
    }),
    mcp.router,
  )
  // looser cap covers the wizard's 5s /poll and /status pollers over a setup window; the tight
  // deviceCodeLimiter below fences the session-clobber + login.microsoftonline.com proxy vector,
  // which legit clients only hit a handful of times
  const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  const deviceCodeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
  app.use('/api/setup/device-code', deviceCodeLimiter)
  app.use(
    '/api/setup',
    setupLimiter,
    createSetupRouter(
      new SetupService({
        config: deps.config,
        secrets: deps.secrets,
        roles: deps.roles,
        sessions: new SetupSessionStore(),
        bootstrapAdminOid: deps.setup?.bootstrapAdminOid,
        bootstrapClientId: deps.setup?.bootstrapClientId,
      }),
    ),
  )
  app.use(
    '/api/admin',
    createAdminRouter({
      usage: deps.usage,
      roles: deps.roles,
      config: deps.config,
      apiKeys: deps.apiKeys,
      secrets: deps.secrets,
      registry: deps.registry,
      loader: deps.loader,
      catalog: deps.catalog,
      getValidator: () => authState.validator,
      dropAllSessions: () => mcp.dropAllSessions(),
      getGraph: () => authState.graph,
      updates,
    }),
  )

  const portalMw = createPortalAuthMiddleware({ getValidator: () => authState.validator, roles: deps.roles })
  // oauth callbacks etc, declared in the plugin manifest; GET-only, unauthenticated, exact path match
  const publicRouteMw: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET') {
      next()
      return
    }
    const id = req.params.pluginId as string
    const pluginRouter = deps.routesRegistry.get(id)
    const publicRoutes = deps.catalog.getManifest(id)?.publicRoutes ?? []
    if (!pluginRouter || !publicRoutes.includes(req.path)) {
      next()
      return
    }
    // public routes run unauthenticated, res.locals has no principal/portalRoles; flag it so plugin code can tell
    res.locals.publicRoute = true
    // no principal to authorize against, deny every cross-plugin ctx.invokeTool from this handler
    invokeCallerContext.run({ depth: 0, principalId: undefined, permissions: NO_PERMISSIONS }, () => {
      pluginRouter(req, res, next)
    })
  }
  // portal-admin or a portal-surface integration grant, portal-only roles never widen mcp tool access
  const pluginRouteGate: RequestHandler = (req, res, next) => {
    const roles = res.locals.portalRoles as Role[]
    if (roles.some((r) => r.id === PORTAL_ADMIN_ROLE)) {
      next()
      return
    }
    // portalRoles is rolesForPrincipal(principal, roles, 'portal') computed by the portal middleware
    const p = resolvePermissions(roles)
    const id = req.params.pluginId as string
    const readOnly = req.method === 'GET' || req.method === 'HEAD'
    if (p.wildcard || modeAllows(p.integrations.get(id), readOnly) || modeAllows(p.integrations.get('*'), readOnly)) {
      next()
      return
    }
    res.status(403).json({ error: 'not authorized for plugin' })
  }
  app.use('/api/plugins/:pluginId', publicRouteMw, portalMw, pluginRouteGate, (req, res, next) => {
    const pluginRouter = deps.routesRegistry.get(req.params.pluginId as string)
    if (!pluginRouter) {
      res.status(404).json({ error: 'unknown plugin' })
      return
    }
    // ctx.invokeTool from this handler is scoped to the authenticated portal principal's own
    // portal-surface grants, same resolvePermissions(portalRoles) call pluginRouteGate itself uses
    const principal = res.locals.principal as Principal
    const permissions = resolvePermissions(res.locals.portalRoles as Role[])
    invokeCallerContext.run({ depth: 0, principalId: principal.id, permissions }, () => {
      pluginRouter(req, res, next)
    })
  })

  // admin web build, served after all api/mcp/oauth mounts so those routes never fall through to static
  if (deps.webDist && fs.existsSync(deps.webDist)) {
    app.use(express.static(deps.webDist))
    app.get(/^\/(?!api\/|mcp).*/, (req, res, next) => {
      const notFound = path.join(deps.webDist!, '404.html')
      if (fs.existsSync(notFound)) {
        res.status(404).sendFile(notFound)
        return
      }
      next()
    })
  }

  // final error boundary, catches throws/rejections express 5 forwards from any route above
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    logEvent('server', 'unhandled_error', { error: (err as Error).message })
    if (res.headersSent) {
      return
    }
    // express.json body-parse errors (400/413) carry a real status, pass it through; everything else is 500
    const status = (err as { status?: unknown }).status
    const known = typeof status === 'number' && status >= 400 && status < 600
    res.status(known ? (status as number) : 500).json({ error: known ? (err as Error).message : 'internal error' })
  }
  app.use(onError)

  return {
    app,
    close: async () => {
      offAuthReload()
      await mcp.close()
    },
    dropAllSessions: mcp.dropAllSessions,
  }
}
