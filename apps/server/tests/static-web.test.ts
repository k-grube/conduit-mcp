import type { Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
import { createApp } from '../src/app.js'

const webDist = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'web-out')

let server: Server
let base: string
let closeApp: () => Promise<void>

beforeAll(async () => {
  const catalog = new ToolCatalog()
  const registry = new PluginRegistryStore('StaticWebReg')
  const loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-staticweb-')),
    createContext: () => {
      throw new Error('not used in this suite')
    },
  })
  const { app, close } = await createApp({
    catalog,
    search: new ToolSearch(catalog),
    sessions: new AdtSessionStore('StaticWebSess'),
    eventStore: new AdtEventStore('StaticWebEvt'),
    roles: new RolesStore('StaticWebRoles'),
    apiKeys: new ApiKeysStore('StaticWebKeys'),
    config: new ConfigStore({ tableName: 'StaticWebCfg' }),
    usage: new UsageStore('StaticWebUsage'),
    secrets: new EnvSecretProvider(),
    registry,
    loader,
    routesRegistry: new PluginRoutesRegistry(),
    webDist,
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

describe('static web hosting', () => {
  it('serves the index page at /', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('fixture-index-marker')
  })

  it('serves a nested page', async () => {
    const res = await fetch(`${base}/dashboard/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('fixture-dashboard-marker')
  })

  it('falls back to 404.html for unknown paths', async () => {
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('fixture-404-marker')
  })

  it('does not shadow api routes', async () => {
    const res = await fetch(`${base}/api/admin/auth-config`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
