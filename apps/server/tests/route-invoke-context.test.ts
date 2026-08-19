import type { Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Router } from 'express'
import { SignJWT, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePlugin, defineTool, parseManifest, z } from '@conduit-mcp/plugin-sdk'
import { EntraValidator } from '../src/auth/entra.js'
import { RolesStore } from '../src/storage/roles-store.js'
import { ApiKeysStore } from '../src/storage/api-keys-store.js'
import { ConfigStore } from '../src/storage/config-store.js'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { ToolSearch } from '../src/catalog/search.js'
import { PluginLoader } from '../src/plugins/loader.js'
import { PluginRoutesRegistry } from '../src/plugins/routes-registry.js'
import { AdtSessionStore } from '../src/mcp/session-store.js'
import { AdtEventStore } from '../src/mcp/event-store.js'
import { UsageStore } from '../src/usage/usage-store.js'
import { EnvSecretProvider } from '../src/secrets/provider.js'
import { createPluginContext } from '../src/plugins/context.js'
import { createApp } from '../src/app.js'
import type { UsageEvent } from '../src/mcp/meta-tools.js'

// N1: plugin route handlers get a ctx.invokeTool that must enforce the calling portal
// principal's own grants (authenticated routes) or deny outright (unauthenticated public
// routes) -- the same defect class as C2/I5, on the plugin-route surface instead of mcp

let server: Server
let base: string
let invokerToken: string
let closeApp: () => Promise<void>
const usage: UsageEvent[] = []

describe('plugin route invoke caller context (N1)', () => {
  beforeAll(async () => {
    const secrets = new EnvSecretProvider()
    const config = new ConfigStore({ tableName: 'RicCfg' })
    await config.updateDomain('auth', { tenantId: 'tid-ric', clientId: 'client-ric' })
    const pair = await generateKeyPair('RS256')
    invokerToken = await new SignJWT({ oid: 'oid-invoker', scp: 'portal.access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/tid-ric/v2.0')
      .setAudience('client-ric')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(pair.privateKey)

    const roles = new RolesStore('RicRoles')
    await roles.seedBuiltins()
    await roles.upsert({
      id: 'route-invoker',
      name: 'Route Invoker',
      // portal-surface grants on both the route's own plugin (route access) and the callee
      // tool's plugin (the nested ctx.invokeTool), mirroring pluginRouteGate's own semantics
      grants: [
        { kind: 'integration', integrationId: 'caller', mode: 'read' },
        { kind: 'integration', integrationId: 'callee', mode: 'read' },
      ],
      surfaces: ['portal'],
      members: { users: ['oid-invoker'], groups: [] },
    })

    const catalog = new ToolCatalog()
    const routesRegistry = new PluginRoutesRegistry()

    const calleeManifest = parseManifest({
      id: 'callee',
      name: 'Callee',
      toolPrefix: 'callee_',
      entry: 'e',
      sdkVersion: '^0.1',
    })
    const callerManifest = parseManifest({
      id: 'caller',
      name: 'Caller',
      toolPrefix: 'caller_',
      entry: 'e',
      sdkVersion: '^0.1',
      publicRoutes: ['/public-invoke'],
    })

    const calleeCtx = createPluginContext(calleeManifest, {
      secrets,
      config,
      storeTableName: 'RicCalleeStore',
      getCatalog: () => catalog,
    })
    catalog.registerPlugin(
      calleeManifest,
      definePlugin({
        tools: [
          defineTool({
            name: 'callee_get',
            description: 'get a thing',
            params: { echo: z.string().optional() },
            readOnly: true,
            handler: async (args) => ({ hello: 'world', echo: args.echo ?? null }),
          }),
        ],
      }),
      calleeCtx,
    )

    const callerCtx = createPluginContext(callerManifest, {
      secrets,
      config,
      storeTableName: 'RicCallerStore',
      getCatalog: () => catalog,
      onUsage: (e) => usage.push(e),
    })
    const callerPlugin = definePlugin({
      tools: [],
      routes: (router, ctx) => {
        const handler = async (_req: unknown, res: { json(body: unknown): void }) => {
          try {
            const result = await ctx.invokeTool('callee_get', {})
            res.json({ ok: true, result })
          } catch (err) {
            res.json({ ok: false, message: err instanceof Error ? err.message : String(err) })
          }
        }
        router.get('/invoke', handler)
        router.get('/public-invoke', handler)
      },
    })
    catalog.registerPlugin(callerManifest, callerPlugin, callerCtx)
    const callerRouter = Router()
    callerPlugin.routes!(callerRouter, callerCtx)
    routesRegistry.set('caller', callerRouter)

    const registry = new PluginRegistryStore('RicReg')
    const loader = new PluginLoader({
      registry,
      catalog,
      pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-ric-')),
      createContext: (m) => createPluginContext(m, { secrets, config, getCatalog: () => catalog }),
      routes: routesRegistry,
    })

    const { app, close } = await createApp({
      catalog,
      search: new ToolSearch(catalog),
      sessions: new AdtSessionStore('RicSess'),
      eventStore: new AdtEventStore('RicEvt'),
      roles,
      apiKeys: new ApiKeysStore('RicKeys'),
      config,
      usage: new UsageStore('RicUsage'),
      secrets,
      registry,
      loader,
      routesRegistry,
      createValidator: (cfg) => new EntraValidator(cfg, async () => pair.publicKey),
    })
    closeApp = close
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterAll(async () => {
    await closeApp()
    await new Promise((resolve) => server.close(resolve))
  })

  it('an authenticated route calling ctx.invokeTool on a granted tool works and records the portal principal', async () => {
    usage.length = 0
    const res = await fetch(`${base}/api/plugins/caller/invoke`, {
      headers: { authorization: `Bearer ${invokerToken}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { hello: 'world', echo: null } })

    const inner = usage.find((u) => u.tool === 'callee_get')
    expect(inner).toMatchObject({ tool: 'callee_get', pluginId: 'callee', principal: 'user:oid-invoker', ok: true })
  })

  it("a public route handler's ctx.invokeTool on any tool is denied, no principal to authorize against", async () => {
    usage.length = 0
    const res = await fetch(`${base}/api/plugins/caller/public-invoke`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; message: string }
    expect(body.ok).toBe(false)
    expect(body.message).toMatch(/not authorized for tool callee_get/)
    expect(usage).toEqual([])
  })
})
