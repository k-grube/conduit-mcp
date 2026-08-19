import type { Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'demo-plugin')

let server: Server
let base: string
let adminToken: string
let closeApp: () => Promise<void>

describe('public plugin routes', () => {
  beforeAll(async () => {
    const roles = new RolesStore('PubRtRoles')
    await roles.seedBuiltins()
    const portalAdmin = (await roles.get('portal-admin'))!
    await roles.upsert({ ...portalAdmin, members: { users: ['oid-admin'], groups: [] } })

    const config = new ConfigStore({ tableName: 'PubRtCfg' })
    await config.updateDomain('auth', { tenantId: 'tid-1', clientId: 'client-1' })
    const pair = await generateKeyPair('RS256')
    adminToken = await new SignJWT({ oid: 'oid-admin', scp: 'portal.access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
      .setAudience('client-1')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(pair.privateKey)

    const registry = new PluginRegistryStore('PubRtReg')
    const catalog = new ToolCatalog()
    const routesRegistry = new PluginRoutesRegistry()
    const loader = new PluginLoader({
      registry,
      catalog,
      pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-pubrt-')),
      createContext: (m) =>
        createPluginContext(m, { secrets: new EnvSecretProvider(), config, storeTableName: 'PubRtPStore' }),
      routes: routesRegistry,
    })
    const rec = {
      id: 'demo',
      source: 'local' as const,
      localPath: fixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)

    const { app, close } = await createApp({
      catalog,
      search: new ToolSearch(catalog),
      sessions: new AdtSessionStore('PubRtSess'),
      eventStore: new AdtEventStore('PubRtEvt'),
      roles,
      apiKeys: new ApiKeysStore('PubRtKeys'),
      config,
      usage: new UsageStore('PubRtUsage'),
      secrets: new EnvSecretProvider(),
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

  it('unauthenticated GET on a declared public route succeeds and flags res.locals.publicRoute', async () => {
    const res = await fetch(`${base}/api/plugins/demo/callback`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, publicRoute: true })
  })

  it('unauthenticated GET on a non-public route is rejected', async () => {
    const res = await fetch(`${base}/api/plugins/demo/private`)
    expect(res.status).toBe(401)
  })

  it('unauthenticated POST on a public route path is rejected, public routes are GET-only', async () => {
    const res = await fetch(`${base}/api/plugins/demo/callback`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('authenticated access to a non-public route still works and does not flag publicRoute', async () => {
    const res = await fetch(`${base}/api/plugins/demo/private`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ private: true, publicRoute: false })
  })

  it('unauthenticated GET for an unknown plugin does not bypass auth', async () => {
    const res = await fetch(`${base}/api/plugins/nope/callback`)
    expect(res.status).toBe(401)
  })
})
