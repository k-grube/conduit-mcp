import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SignJWT, generateKeyPair } from 'jose'
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { ToolSearch } from '../src/catalog/search.js'
import { PluginLoader } from '../src/plugins/loader.js'
import { PluginRoutesRegistry } from '../src/plugins/routes-registry.js'
import { AdtSessionStore } from '../src/mcp/session-store.js'
import { AdtEventStore } from '../src/mcp/event-store.js'
import { RolesStore } from '../src/storage/roles-store.js'
import { ApiKeysStore } from '../src/storage/api-keys-store.js'
import { ConfigStore } from '../src/storage/config-store.js'
import { EnvSecretProvider } from '../src/secrets/provider.js'
import { EntraValidator } from '../src/auth/entra.js'
import { createApp, type AppDeps } from '../src/app.js'
import { ensureTable } from '../src/storage/tables.js'
import { UsageStore, dayKey } from '../src/usage/usage-store.js'

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'demo-plugin')

const stubCtx = {
  getSecret: async () => '',
  setSecret: async () => {},
  getConfig: async () => ({}),
  invokeTool: async () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
} as PluginContext

let server: Server
let server2: Server
let baseUrl: string
let baseUrl2: string
let appBaseUrl: string
let closeApp: () => Promise<void>
let closeApp2: () => Promise<void>
const sessions = new AdtSessionStore('E2eSess')
let adminKey: string
let roKey: string
let deps: AppDeps
let usage: UsageStore

beforeAll(async () => {
  const registry = new PluginRegistryStore('E2ePlug')
  const catalog = new ToolCatalog()
  const routesRegistry = new PluginRoutesRegistry()
  const loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-e2e-')),
    createContext: () => stubCtx,
    routes: routesRegistry,
  })
  const rec = { id: 'demo', source: 'local' as const, localPath: fixtureDir, enabled: true, status: 'loading' as const }
  await registry.upsert(rec)
  await loader.load(rec)
  const search = new ToolSearch(catalog)
  const eventStore = new AdtEventStore('E2eEvt')
  const roles = new RolesStore('E2eRoles')
  await roles.seedBuiltins()
  const apiKeys = new ApiKeysStore('E2eKeys')
  adminKey = (await apiKeys.create('admin key', ['admin'])).rawKey
  roKey = (await apiKeys.create('ro key', ['read-only'])).rawKey
  const config = new ConfigStore({ tableName: 'E2eCfg' })
  usage = new UsageStore('E2eUsage')
  const updateStatus = { runningSha: 'aaa111222', remoteSha: 'bbb222333', tag: 'latest', updateAvailable: true }
  deps = {
    catalog,
    search,
    sessions,
    eventStore,
    roles,
    apiKeys,
    config,
    usage,
    secrets: new EnvSecretProvider(),
    registry,
    loader,
    routesRegistry,
    updates: { check: async () => updateStatus, get: async () => updateStatus, peek: () => updateStatus },
  }
  const { app, close } = await createApp(deps)
  closeApp = close
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as { port: number }
  appBaseUrl = `http://127.0.0.1:${address.port}`
  baseUrl = `${appBaseUrl}/mcp`

  // second app instance sharing the same session/event stores and catalog, simulating a second replica
  const { app: app2, close: close2 } = await createApp(deps)
  closeApp2 = close2
  await new Promise<void>((resolve) => {
    server2 = app2.listen(0, '127.0.0.1', () => resolve())
  })
  const address2 = server2.address() as { port: number }
  baseUrl2 = `http://127.0.0.1:${address2.port}/mcp`
})

afterAll(async () => {
  await closeApp()
  await closeApp2()
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => server2.close(resolve))
})

async function connectClient(key = adminKey) {
  const client = new Client({ name: 'e2e', version: '0.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { 'x-api-key': key } },
  })
  await client.connect(transport)
  return { client, transport }
}

function text(result: unknown): string {
  return (result as { content: { type: string; text: string }[] }).content[0].text
}

describe('mcp e2e', () => {
  it('initializes a session and lists the three meta-tools', async () => {
    const { client, transport } = await connectClient()
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['find_tools', 'invoke_tool', 'list_integrations'])
    expect(transport.sessionId).toBeDefined()
    expect(await sessions.get(transport.sessionId!)).toBeDefined()
    await client.close()
  })

  it('carries the update notice into session instructions', async () => {
    const { client } = await connectClient()
    expect(client.getInstructions()).toContain('update is available')
    expect(client.getInstructions()).toContain('bbb2223')
    await client.close()
  })

  it('find_tools then invoke_tool round-trip over http', async () => {
    const { client } = await connectClient()
    const found = await client.callTool({ name: 'find_tools', arguments: { query: 'echo' } })
    expect(JSON.parse(text(found))[0].name).toBe('demo_echo')
    const res = await client.callTool({
      name: 'invoke_tool',
      arguments: { name: 'demo_echo', args: { text: 'over http' } },
    })
    expect(text(res)).toBe('over http')
    await client.close()
  })

  it('tool failures come back as isError, session survives', async () => {
    const { client } = await connectClient()
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_fail' } })
    expect((res as { isError?: boolean }).isError).toBe(true)
    const again = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_add', args: { a: 2, b: 2 } } })
    expect(text(again)).toBe('4')
    await client.close()
  })

  it('a session initialized on one instance resumes on another sharing the same stores', async () => {
    const { client, transport } = await connectClient()
    const sid = transport.sessionId!
    const res = await fetch(baseUrl2, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'mcp-protocol-version': '2025-03-26',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 99 }),
    })
    expect(res.status).toBe(200)
    const bodyText = await res.text()
    expect(bodyText).toMatch(/find_tools/)
    await client.close()
  })

  it('unknown session id gets a -32001 error', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'not-a-real-session',
        'mcp-protocol-version': '2025-03-26',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32001)
  })

  it('an expired durable session record is treated as not found and swept from adt', async () => {
    const table = await ensureTable('E2eSess')
    const past = new Date(Date.now() - 1000).toISOString()
    await table.upsertEntity({
      partitionKey: 'sessions',
      rowKey: 'expired-sid',
      json: JSON.stringify({
        sessionId: 'expired-sid',
        principal: 'anonymous',
        createdAt: past,
        lastSeenAt: past,
        expiresAt: past,
      }),
    })
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'expired-sid',
        'mcp-protocol-version': '2025-03-26',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })
    expect(res.status).toBe(404)
    expect(await sessions.get('expired-sid')).toBeUndefined()
  })

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
        id: 1,
      }),
    })
    expect(res.status).toBe(401)
  })

  it('read-only key sees filtered tools and denied invoke reads as unknown', async () => {
    const { client } = await connectClient(roKey)
    const found = await client.callTool({ name: 'find_tools', arguments: { query: 'fails' } })
    expect((JSON.parse(text(found)) as { name: string }[]).map((h) => h.name)).not.toContain('demo_fail')
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_fail' } })
    expect(text(res)).toMatch(/unknown tool/)
    const ok = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 'hi' } } })
    expect(text(ok)).toBe('hi')
    await client.close()
  })

  it('rejects a session used by a different principal', async () => {
    const { client, transport } = await connectClient(adminKey)
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': transport.sessionId!,
        'mcp-protocol-version': '2025-03-26',
        'x-api-key': roKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 9 }),
    })
    expect(res.status).toBe(403)
    await client.close()
  })

  it('a 403d cross-principal request does not keep a victim session alive past its idle timeout', async () => {
    const { app: idleApp, close: closeIdleApp } = await createApp({ ...deps, idleMs: 200, sweepMs: 20 })
    const idleServer: Server = await new Promise((resolve) => {
      const s = idleApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    const idleAddr = idleServer.address() as { port: number }
    const idleBaseUrl = `http://127.0.0.1:${idleAddr.port}/mcp`

    const idleTransport = new StreamableHTTPClientTransport(new URL(idleBaseUrl), {
      requestInit: { headers: { 'x-api-key': adminKey } },
    })
    const idleClient = new Client({ name: 'e2e-idle', version: '0.0.0' })
    await idleClient.connect(idleTransport)
    const sid = idleTransport.sessionId!

    await new Promise((resolve) => setTimeout(resolve, 150))
    const forbidden = await fetch(idleBaseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'mcp-protocol-version': '2025-03-26',
        'x-api-key': roKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })
    expect(forbidden.status).toBe(403)

    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterIdle = await fetch(idleBaseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'mcp-protocol-version': '2025-03-26',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    })
    expect(afterIdle.status).toBe(404)

    await idleClient.close()
    await closeIdleApp()
    await new Promise((resolve) => idleServer.close(resolve))
  })

  it('caps concurrent sessions per principal with a 429 once the limit is hit', async () => {
    const { app: cappedApp, close: closeCappedApp } = await createApp({ ...deps, maxSessionsPerPrincipal: 1 })
    const cappedServer: Server = await new Promise((resolve) => {
      const s = cappedApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    const cappedAddr = cappedServer.address() as { port: number }
    const cappedBaseUrl = `http://127.0.0.1:${cappedAddr.port}/mcp`

    const initRequest = () =>
      fetch(cappedBaseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-03-26',
          'x-api-key': adminKey,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
          id: 1,
        }),
      })

    const first = await initRequest()
    expect(first.status).toBe(200)

    const second = await initRequest()
    expect(second.status).toBe(429)

    await closeCappedApp()
    await new Promise((resolve) => cappedServer.close(resolve))
  })

  it('auth config updates reload the validator without restart', async () => {
    // config PUT through the admin api is exercised in admin-e2e; here poke the store directly
    await deps.config.updateDomain('auth', { tenantId: 'tid-2', clientId: 'client-2' })
    await vi.waitFor(async () => {
      const res = await fetch(`${appBaseUrl}/api/admin/auth-config`)
      const body = (await res.json()) as { tenantId?: string }
      expect(body.tenantId).toBe('tid-2')
    })
    await deps.config.updateDomain('auth', { tenantId: 'tid-1', clientId: 'client-1' })
  })
})

describe('usage flow', () => {
  it('invoke_tool lands in the usage store', async () => {
    const { client } = await connectClient(adminKey)
    await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 'tracked' } } })
    await client.close()
    await vi.waitFor(async () => {
      const rows = await usage.listDays([dayKey()])
      expect(rows.some((r) => r.tool === 'demo_echo' && r.ok)).toBe(true)
    })
  })

  it('failed invokes are recorded with ok false', async () => {
    const { client } = await connectClient(adminKey)
    await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_fail' } })
    await client.close()
    await vi.waitFor(async () => {
      const rows = await usage.listDays([dayKey()])
      expect(rows.some((r) => r.tool === 'demo_fail' && !r.ok && r.error === 'boom')).toBe(true)
    })
  })
})

describe('admin portal mount', () => {
  it('auth-config is reachable without auth and reports the configured flag', async () => {
    const res = await fetch(`${appBaseUrl}/api/admin/auth-config`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { configured: boolean }
    expect(typeof body.configured).toBe('boolean')
  })

  it('dashboard requires portal auth', async () => {
    const res = await fetch(`${appBaseUrl}/api/admin/dashboard`)
    expect(res.status).toBe(401)
  })

  it('an mcp api key does not authenticate the portal', async () => {
    const res = await fetch(`${appBaseUrl}/api/admin/dashboard`, {
      headers: { 'x-api-key': adminKey },
    })
    expect(res.status).toBe(401)
  })

  it('graph search is portal-gated and wired to a real GraphClient when auth is configured', async () => {
    const graphRoles = new RolesStore('E2eGraphRoles')
    await graphRoles.seedBuiltins()
    const admin = (await graphRoles.get('portal-admin'))!
    await graphRoles.upsert({ ...admin, members: { users: ['oid-graph-admin'], groups: [] } })
    const graphConfig = new ConfigStore({ tableName: 'E2eGraphCfg' })
    await graphConfig.updateDomain('auth', { tenantId: 'tid-graph', clientId: 'client-graph' })
    const pair = await generateKeyPair('RS256')
    const token = await new SignJWT({ oid: 'oid-graph-admin', scp: 'portal.access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/tid-graph/v2.0')
      .setAudience('client-graph')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey)

    // no AZURE_CLIENT_SECRET available, getToken() throws before any network call, proving the route reaches a real GraphClient
    const failingSecrets = {
      writable: false,
      getSecret: async () => {
        throw new Error('no secret in test env')
      },
      setSecret: async () => {},
    }
    const { app: graphApp, close: closeGraphApp } = await createApp({
      ...deps,
      roles: graphRoles,
      config: graphConfig,
      secrets: failingSecrets,
      createValidator: (cfg) => new EntraValidator(cfg, async () => pair.publicKey),
    })
    const graphServer: Server = await new Promise((resolve) => {
      const s = graphApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    const graphAddr = graphServer.address() as { port: number }
    const graphBaseUrl = `http://127.0.0.1:${graphAddr.port}`

    const unauthed = await fetch(`${graphBaseUrl}/api/admin/graph/users?q=ke`)
    expect(unauthed.status).toBe(401)

    const res = await fetch(`${graphBaseUrl}/api/admin/graph/users?q=ke`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(502)

    await closeGraphApp()
    await new Promise((resolve) => graphServer.close(resolve))
  })

  it('plugin routes mount behind the portal gate', async () => {
    const res = await fetch(`${appBaseUrl}/api/plugins/demo/ping`)
    expect(res.status).toBe(401)
  })
})

describe('auth config hot-reload lifecycle', () => {
  it('close() unsubscribes from config.onChange, a closed app does not reload on later auth changes', async () => {
    const leakConfig = new ConfigStore({ tableName: 'E2eLeakCfg' })
    await leakConfig.updateDomain('auth', { tenantId: 'tid-leak', clientId: 'client-leak' })
    let calls = 0
    const { app: leakApp, close: closeLeakApp } = await createApp({
      ...deps,
      config: leakConfig,
      createValidator: (cfg) => {
        calls += 1
        return new EntraValidator(cfg)
      },
    })
    const leakServer: Server = await new Promise((resolve) => {
      const s = leakApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    expect(calls).toBe(1)

    await closeLeakApp()
    await new Promise((resolve) => leakServer.close(resolve))

    await leakConfig.updateDomain('auth', { tenantId: 'tid-leak-2', clientId: 'client-leak-2' })
    // reload is fire-and-forget, give a leaked listener real time to fire before asserting it did not
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(calls).toBe(1)
  })

  it('a rejected auth reload leaves the previous validator and oauth metadata intact', async () => {
    const atomicRoles = new RolesStore('E2eAtomicRoles')
    await atomicRoles.seedBuiltins()
    const admin = (await atomicRoles.get('portal-admin'))!
    await atomicRoles.upsert({ ...admin, members: { users: ['oid-atomic-admin'], groups: [] } })
    const atomicConfig = new ConfigStore({ tableName: 'E2eAtomicCfg' })
    await atomicConfig.updateDomain('auth', {
      tenantId: 'tid-atomic',
      clientId: 'client-atomic',
      serverUrl: 'https://conduit.example.test',
    })
    const pair = await generateKeyPair('RS256')
    const token = await new SignJWT({ oid: 'oid-atomic-admin', scp: 'portal.access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/tid-atomic/v2.0')
      .setAudience('client-atomic')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey)

    const { app: atomicApp, close: closeAtomicApp } = await createApp({
      ...deps,
      roles: atomicRoles,
      config: atomicConfig,
      createValidator: (cfg) => new EntraValidator(cfg, async () => pair.publicKey),
    })
    const atomicServer: Server = await new Promise((resolve) => {
      const s = atomicApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    const atomicAddr = atomicServer.address() as { port: number }
    const atomicBaseUrl = `http://127.0.0.1:${atomicAddr.port}`

    const initBody = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
      id: 1,
    })
    const unauthedHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

    const before = await fetch(`${atomicBaseUrl}/api/admin/roles`, { headers: { authorization: `Bearer ${token}` } })
    expect(before.status).toBe(200)

    const unauthedBefore = await fetch(`${atomicBaseUrl}/mcp`, {
      method: 'POST',
      headers: unauthedHeaders,
      body: initBody,
    })
    expect(unauthedBefore.status).toBe(401)
    expect(unauthedBefore.headers.get('www-authenticate')).toContain(
      'https://conduit.example.test/.well-known/oauth-protected-resource',
    )

    // sdk's checkIssuerUrl rejects a query string on the issuer url, applyAuthDomain throws internally, auth_reload_failed logged
    await atomicConfig.updateDomain('auth', { serverUrl: 'https://host.example/?x=1' })
    // reload is fire-and-forget, give the failing attempt real time to run before asserting state held
    await new Promise((resolve) => setTimeout(resolve, 300))

    await vi.waitFor(async () => {
      const res = await fetch(`${atomicBaseUrl}/api/admin/auth-config`)
      const body = (await res.json()) as { tenantId?: string; clientId?: string }
      expect(body.tenantId).toBe('tid-atomic')
      expect(body.clientId).toBe('client-atomic')
    })

    const after = await fetch(`${atomicBaseUrl}/api/admin/roles`, { headers: { authorization: `Bearer ${token}` } })
    expect(after.status).toBe(200)

    const unauthedAfter = await fetch(`${atomicBaseUrl}/mcp`, {
      method: 'POST',
      headers: unauthedHeaders,
      body: initBody,
    })
    expect(unauthedAfter.status).toBe(401)
    expect(unauthedAfter.headers.get('www-authenticate')).toContain(
      'https://conduit.example.test/.well-known/oauth-protected-resource',
    )

    await closeAtomicApp()
    await new Promise((resolve) => atomicServer.close(resolve))
  })
})

describe('boot fault isolation', () => {
  it('a persisted auth config that fails sdk issuer validation crashes createApp, not a degraded boot', async () => {
    const bootConfig = new ConfigStore({ tableName: 'E2eBootCfg' })
    // c1a validates serverUrl at write time; this simulates a row that predates that validation
    await bootConfig.updateDomain('auth', {
      tenantId: 'tid-boot',
      clientId: 'client-boot',
      serverUrl: 'https://host.example/?x=1',
    })
    await expect(createApp({ ...deps, config: bootConfig })).rejects.toThrow(/query string/)
  })
})

describe('unhandled route errors', () => {
  it('a rejected route handler returns json 500, never an html stack trace', async () => {
    // first getDomain call is the boot-time applyAuthDomain read, must succeed so createApp doesn't reject;
    // the second is the route under test, which throws to simulate an ADT hiccup mid-request
    let calls = 0
    const throwingConfig = {
      getDomain: async () => {
        calls += 1
        if (calls === 1) {
          return {}
        }
        throw new Error('boom')
      },
      updateDomain: async () => {},
      onChange: () => () => {},
    } as unknown as ConfigStore
    const { app: errApp, close: closeErrApp } = await createApp({ ...deps, config: throwingConfig })
    const errServer: Server = await new Promise((resolve) => {
      const s = errApp.listen(0, '127.0.0.1', () => resolve(s))
    })
    const addr = errServer.address() as { port: number }

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/auth-config`)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()) as { error: string }).toEqual({ error: 'internal error' })

    await closeErrApp()
    await new Promise((resolve) => errServer.close(resolve))
  })
})
