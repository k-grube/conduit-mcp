import type { Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
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
import type { SecretProvider } from '../src/secrets/provider.js'
import { createPluginContext } from '../src/plugins/context.js'
import { createApp } from '../src/app.js'

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'demo-plugin')

let server: Server
let base: string
let adminToken: string
let viewerToken: string
let closeApp: () => Promise<void>

const roles = new RolesStore('AdmE2eRoles')
const config = new ConfigStore({ tableName: 'AdmE2eCfg' })
const registry = new PluginRegistryStore('AdmE2eReg')

function authedWith(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  })
}

function authed(path: string, init: RequestInit = {}) {
  return authedWith(adminToken, path, init)
}

beforeAll(async () => {
  await roles.seedBuiltins()
  const portalAdmin = (await roles.get('portal-admin'))!
  await roles.upsert({ ...portalAdmin, members: { users: ['oid-admin'], groups: [] } })
  await roles.upsert({
    id: 'viewer',
    name: 'Viewer',
    grants: [],
    // portal-only, plugin route grants now resolve on the portal surface, no mcp surface needed or granted
    surfaces: ['portal'],
    members: { users: ['oid-viewer'], groups: [] },
  })
  await config.updateDomain('auth', { tenantId: 'tid-1', clientId: 'client-1' })
  const pair = await generateKeyPair('RS256')
  const sign = (oid: string) =>
    new SignJWT({ oid, scp: 'portal.access' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
      .setAudience('client-1')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(pair.privateKey)
  adminToken = await sign('oid-admin')
  viewerToken = await sign('oid-viewer')

  const catalog = new ToolCatalog()
  // getSecret always throws, graph token fetch fails before any network call;
  // demo plugin declares no secrets so this is safe everywhere else
  const secrets: SecretProvider = {
    writable: false,
    getSecret: async () => {
      throw new Error('no secret in test env')
    },
    setSecret: async () => {},
  }
  const routesRegistry = new PluginRoutesRegistry()
  const loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-adme2e-')),
    createContext: (m) => createPluginContext(m, { secrets, config, storeTableName: 'AdmE2ePStore' }),
    routes: routesRegistry,
  })
  const rec = { id: 'demo', source: 'local' as const, localPath: fixtureDir, enabled: true, status: 'loading' as const }
  await registry.upsert(rec)
  await loader.load(rec)

  const { app, close } = await createApp({
    catalog,
    search: new ToolSearch(catalog),
    sessions: new AdtSessionStore('AdmE2eSess'),
    eventStore: new AdtEventStore('AdmE2eEvt'),
    roles,
    apiKeys: new ApiKeysStore('AdmE2eKeys'),
    config,
    usage: new UsageStore('AdmE2eUsage'),
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

describe('management e2e', () => {
  it('role -> key -> filtered mcp access', async () => {
    const roleRes = await authed('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({
        id: 'demo-ro',
        name: 'Demo RO',
        grants: [{ kind: 'integration', integrationId: 'demo', mode: 'read' }],
        surfaces: ['mcp'],
        members: { users: [], groups: [] },
      }),
    })
    expect(roleRes.status).toBe(201)
    const keyRes = await authed('/api/admin/keys', {
      method: 'POST',
      body: JSON.stringify({ name: 'demo key', roleIds: ['demo-ro'] }),
    })
    expect(keyRes.status).toBe(201)
    const { rawKey } = (await keyRes.json()) as { rawKey: string }

    const client = new Client({ name: 'e2e', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { 'x-api-key': rawKey } },
    })
    await client.connect(transport)
    const res = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_fail' } })
    expect((res as { content: { text: string }[] }).content[0].text).toMatch(/unknown tool/)
    const ok = await client.callTool({ name: 'invoke_tool', arguments: { name: 'demo_echo', args: { text: 'hi' } } })
    expect((ok as { content: { text: string }[] }).content[0].text).toBe('hi')
    await client.close()
  })

  it('plugin lifecycle and detail over the api', async () => {
    const list = await authed('/api/admin/plugins')
    expect(((await list.json()) as { id: string }[])[0].id).toBe('demo')
    const detail = await authed('/api/admin/plugins/demo')
    expect(((await detail.json()) as { manifest: { toolPrefix: string } }).manifest.toolPrefix).toBe('demo_')
    const health = await authed('/api/admin/plugins/demo/health')
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('plugin config and secrets endpoints', async () => {
    const put = await authed('/api/admin/plugins/demo/config', {
      method: 'PUT',
      body: JSON.stringify({ limit: 5 }),
    })
    expect(put.status).toBe(200)
    const secretsRes = await authed('/api/admin/plugins/demo/secrets')
    expect(secretsRes.status).toBe(200)
  })

  it('plugin routes reachable with portal auth', async () => {
    const res = await authed('/api/plugins/demo/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pong: true })
  })

  it('graph endpoints 502 without a real secret', async () => {
    const res = await authed('/api/admin/graph/users?q=ke')
    expect(res.status).toBe(502)
  })

  it('mcp token without portal scope cannot reach admin', async () => {
    const res = await fetch(`${base}/api/admin/roles`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(200)
    // the negative (no scp) is pinned in portal-auth tests; here pin that api keys stay rejected
    const keyDenied = await fetch(`${base}/api/admin/roles`, { headers: { 'x-api-key': 'cmk_' + '0'.repeat(32) } })
    expect(keyDenied.status).toBe(401)
  })

  it('non-admin portal role is read-only on admin mutations and needs a grant for plugin routes', async () => {
    const list = await authedWith(viewerToken, '/api/admin/plugins')
    expect(list.status).toBe(200)
    const disable = await authedWith(viewerToken, '/api/admin/plugins/demo/disable', { method: 'POST' })
    expect(disable.status).toBe(403)
    const pingDenied = await authedWith(viewerToken, '/api/plugins/demo/ping')
    expect(pingDenied.status).toBe(403)

    const viewer = (await roles.get('viewer'))!
    await roles.upsert({
      ...viewer,
      grants: [{ kind: 'integration', integrationId: 'demo', mode: 'read' }],
    })

    const readGrantGet = await authedWith(viewerToken, '/api/plugins/demo/ping')
    expect(readGrantGet.status).toBe(200)
    const readGrantPost = await authedWith(viewerToken, '/api/plugins/demo/ping', { method: 'POST' })
    expect(readGrantPost.status).toBe(403)

    await roles.upsert({
      ...viewer,
      grants: [{ kind: 'integration', integrationId: 'demo', mode: 'all' }],
    })

    const allGrantGet = await authedWith(viewerToken, '/api/plugins/demo/ping')
    expect(allGrantGet.status).toBe(200)
    const allGrantPost = await authedWith(viewerToken, '/api/plugins/demo/ping', { method: 'POST' })
    expect(allGrantPost.status).toBe(200)

    // portal-only role, its integration grant unlocks /api/plugins above but must not reach mcp tools
    const mcpClient = new Client({ name: 'e2e-viewer', version: '0.0.0' })
    const mcpTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${viewerToken}` } },
    })
    await mcpClient.connect(mcpTransport)
    const denied = await mcpClient.callTool({
      name: 'invoke_tool',
      arguments: { name: 'demo_echo', args: { text: 'hi' } },
    })
    expect((denied as { content: { text: string }[] }).content[0].text).toMatch(/unknown tool/)
    await mcpClient.close()
  })
})
