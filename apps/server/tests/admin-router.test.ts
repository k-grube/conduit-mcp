import type { Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { SignJWT, generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { definePlugin, defineTool, parseManifest, z, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { EntraValidator } from '../src/auth/entra.js'
import { createAdminRouter } from '../src/admin/router.js'
import { ApiKeysStore } from '../src/storage/api-keys-store.js'
import { RolesStore } from '../src/storage/roles-store.js'
import { ConfigStore } from '../src/storage/config-store.js'
import { EnvSecretProvider } from '../src/secrets/provider.js'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { PluginLoader } from '../src/plugins/loader.js'
import { UsageStore } from '../src/usage/usage-store.js'

let server: Server
let base: string
let adminToken: string

const apiKeys = new ApiKeysStore('AdmRT1Keys')
const roles = new RolesStore('AdmRT1Roles')
const config = new ConfigStore({ tableName: 'AdmRT1Cfg' })
const usage = new UsageStore('AdmRT1Usage')
const registry = new PluginRegistryStore('AdmRT1Plug')
const catalog = new ToolCatalog()
let loader: PluginLoader

beforeAll(async () => {
  await roles.seedBuiltins()
  const admin = (await roles.get('portal-admin'))!
  await roles.upsert({ ...admin, members: { users: ['oid-admin'], groups: [] } })
  await config.updateDomain('auth', { tenantId: 'tid-1', clientId: 'client-1' })
  const pair = await generateKeyPair('RS256')
  const validator = new EntraValidator({ tenantId: 'tid-1', clientId: 'client-1' }, async () => pair.publicKey)
  adminToken = await new SignJWT({ oid: 'oid-admin', scp: 'portal.access' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://login.microsoftonline.com/tid-1/v2.0')
    .setAudience('client-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(pair.privateKey)

  await usage.record({ tool: 'demo_echo', pluginId: 'demo', principal: 'apikey:k1', ok: true, durationMs: 7, chars: 2 })
  await new Promise((r) => setTimeout(r, 5))
  await usage.record({ tool: 'demo_late', pluginId: 'demo', principal: 'apikey:k1', ok: true, durationMs: 7, chars: 2 })

  const demoManifest = parseManifest({
    id: 'demo',
    name: 'Demo',
    toolPrefix: 'demo_',
    entry: 'src/index.ts',
    sdkVersion: '^0.1',
  })
  const stubCtx = {
    getSecret: async () => '',
    setSecret: async () => {},
    getConfig: async () => ({}),
    invokeTool: async () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
  } as PluginContext
  catalog.registerPlugin(
    demoManifest,
    definePlugin({
      tools: [
        defineTool({
          name: 'demo_echo',
          description: 'echo text back',
          params: { text: z.string() },
          readOnly: false,
          handler: async (args) => args.text,
        }),
      ],
    }),
    stubCtx,
  )

  loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-admrt-')),
    createContext: () => {
      throw new Error('not used in this suite')
    },
  })

  const app = express()
  app.use(express.json())
  app.use(
    '/api/admin',
    createAdminRouter({
      usage,
      roles,
      config,
      apiKeys,
      secrets: new EnvSecretProvider(),
      registry,
      loader,
      catalog,
      getValidator: () => validator,
      dropAllSessions: async () => {},
      getGraph: () => undefined,
    }),
  )
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('admin router', () => {
  it('auth-config is open and reports configuration', async () => {
    const res = await fetch(`${base}/api/admin/auth-config`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      configured: true,
      tenantId: 'tid-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
  })

  it('dashboard requires portal auth', async () => {
    expect((await fetch(`${base}/api/admin/dashboard`)).status).toBe(401)
  })

  it('dashboard aggregates recorded usage', async () => {
    const res = await fetch(`${base}/api/admin/dashboard?days=7`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { totals: { calls: number }; tools: { tool: string }[] }
    expect(body.totals.calls).toBeGreaterThanOrEqual(1)
    expect(body.tools.map((t) => t.tool)).toContain('demo_echo')
  })

  it('rejects invalid days', async () => {
    const res = await fetch(`${base}/api/admin/dashboard?days=banana`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(400)
  })

  it('activity lists stored usage rows newest first', async () => {
    const res = await fetch(`${base}/api/admin/activity?limit=10`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { tool: string }[] }
    expect(body.items.map((i) => i.tool)).toEqual(['demo_late', 'demo_echo'])
  })

  it('lists tools with schemas', async () => {
    const res = await fetch(`${base}/api/admin/tools`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tools: Record<string, unknown>[] }
    const t = body.tools.find((x) => x.name === 'demo_echo')
    expect(t).toMatchObject({ pluginId: 'demo', readOnly: false })
    expect(t?.jsonSchema).toBeTruthy()
    expect(t?.validate).toBeUndefined()
  })

  it('GET /tool-notes returns the filtered snapshot', async () => {
    await config.updateDomain('toolNotes', {
      tools: { demo_echo: { text: 'note', updatedBy: 'user:x', updatedAt: '2026-08-05T00:00:00.000Z' } },
      integrations: { gone: null },
    })
    const res = await fetch(`${base}/api/admin/tool-notes`, { headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tools: Record<string, { text: string }>; integrations: object }
    expect(body.tools.demo_echo.text).toBe('note')
    expect(body.integrations).toEqual({})
  })

  it('reloads the plugin after a config save', async () => {
    await registry.upsert({ id: 'refreshwire', source: 'local', localPath: 'x', enabled: true, status: 'active' })
    const loadSpy = vi.spyOn(loader, 'load').mockResolvedValue(undefined)
    try {
      const res = await fetch(`${base}/api/admin/plugins/refreshwire/config`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(200)
      expect(loadSpy).toHaveBeenCalledTimes(1)
      expect(loadSpy.mock.calls[0][0]).toMatchObject({ id: 'refreshwire' })
    } finally {
      loadSpy.mockRestore()
    }
  })
})
