import express from 'express'
import type { Server } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { PluginLoader } from '../src/plugins/loader.js'
import { createPluginsRouter } from '../src/admin/plugins-router.js'
import { deleteRow, ensureTable } from '../src/storage/tables.js'
import { ConfigStore } from '../src/storage/config-store.js'
import type { SecretProvider } from '../src/secrets/provider.js'

const noSecrets: SecretProvider = {
  writable: false,
  getSecret: async (name: string) => {
    throw new Error(`missing ${name}`)
  },
  setSecret: async () => {},
}

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
let base: string
const registry = new PluginRegistryStore('PlugRtT1')
const catalog = new ToolCatalog()

beforeAll(async () => {
  const loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-pr-')),
    createContext: () => stubCtx,
  })
  const app = express()
  app.use(express.json())
  app.use(
    '/plugins',
    createPluginsRouter({
      registry,
      loader,
      catalog,
      config: new ConfigStore({ tableName: 'PlugRtCfg' }),
      secrets: noSecrets,
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

async function post(path: string, body?: unknown, method = 'POST') {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('plugins router', () => {
  it('registers and loads a local plugin', async () => {
    const res = await post('/plugins', { id: 'demo', source: 'local', localPath: fixtureDir })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { status: string; displayStatus: string; configured: boolean }
    expect(body.status).toBe('active')
    expect(body.displayStatus).toBe('active')
    expect(body.configured).toBe(true)
    const list = (await (await fetch(`${base}/plugins`)).json()) as {
      id: string
      toolCount: number
      displayStatus: string
    }[]
    expect(list[0].toolCount).toBeGreaterThan(0)
    expect(list[0].displayStatus).toBe('active')
  })

  it('409s duplicate registration and validates bodies', async () => {
    expect((await post('/plugins', { id: 'demo', source: 'local', localPath: fixtureDir })).status).toBe(409)
    expect((await post('/plugins', { id: 'Bad', source: 'local', localPath: fixtureDir })).status).toBe(400)
    expect((await post('/plugins', { id: 'x', source: 'git' })).status).toBe(400)
  })

  it('detail returns record, manifest and derived status', async () => {
    const res = await fetch(`${base}/plugins/demo`)
    const body = (await res.json()) as {
      record: { id: string }
      manifest: { toolPrefix: string }
      displayStatus: string
      configured: boolean
    }
    expect(body.record.id).toBe('demo')
    expect(body.manifest.toolPrefix).toBe('demo_')
    expect(body.displayStatus).toBe('active')
    expect(body.configured).toBe(true)
  })

  it('health reports for the loaded plugin', async () => {
    const res = await fetch(`${base}/plugins/demo/health`)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('reload reloads the local plugin back to active', async () => {
    const res = await post('/plugins/demo/reload')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('active')
  })

  it('disable unloads, enable reloads', async () => {
    expect((await post('/plugins/demo/disable')).status).toBe(200)
    expect(catalog.get('demo_echo')).toBeUndefined()
    expect((await post('/plugins/demo/enable')).status).toBe(200)
    expect(catalog.get('demo_echo')).toBeDefined()
  })

  it('disable derives a disabled display status', async () => {
    const res = await post('/plugins/demo/disable')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { displayStatus: string }
    expect(body.displayStatus).toBe('disabled')
    expect((await post('/plugins/demo/enable')).status).toBe(200)
  })

  it('health endpoint persists the result on the record', async () => {
    const res = await fetch(`${base}/plugins/demo/health`)
    const body = (await res.json()) as { ok: boolean; checkedAt?: string }
    expect(body.ok).toBe(true)
    expect(body.checkedAt).toBeDefined()
    expect((await registry.get('demo'))?.health?.ok).toBe(true)
  })

  it('reload on a disabled plugin 409s instead of resurrecting it', async () => {
    expect((await post('/plugins/demo/disable')).status).toBe(200)
    expect(catalog.get('demo_echo')).toBeUndefined()
    const res = await post('/plugins/demo/reload')
    expect(res.status).toBe(409)
    expect((await res.json()) as { error: string }).toEqual({ error: 'plugin disabled' })
    expect(catalog.get('demo_echo')).toBeUndefined()
    // restore for the tests below that expect demo enabled
    expect((await post('/plugins/demo/enable')).status).toBe(200)
  })

  it('409s when a lifecycle lock is already held for the plugin', async () => {
    const table = await ensureTable('Locks')
    await table.upsertEntity({
      partitionKey: 'locks',
      rowKey: 'plugin-lifecycle:demo',
      json: JSON.stringify({ expires: Date.now() + 60_000, holder: 'test' }),
    })
    const res = await post('/plugins/demo/disable')
    expect(res.status).toBe(409)
    await deleteRow(table, 'locks', 'plugin-lifecycle:demo')
  })

  it('resurrection guard: a delete winning the lock race after the fast-path check is not resurrected', async () => {
    const rec = {
      id: 'ghost',
      source: 'local' as const,
      localPath: fixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    const seeded = await registry.get('ghost')
    expect(seeded).toBeDefined()
    await registry.remove('ghost')
    // the fast-path 404 check is the only call this queued mock covers, simulating it having seen
    // the record a beat before a delete won the lock race; the real (now-empty) store answers every
    // call after that, so the authoritative re-read inside the lock must see it gone
    vi.spyOn(registry, 'get').mockImplementationOnce(async () => seeded)
    const res = await post('/plugins/ghost/disable')
    expect(res.status).toBe(404)
    expect(await registry.get('ghost')).toBeUndefined()
  })

  it('delete removes everything', async () => {
    expect((await post('/plugins/demo', undefined, 'DELETE')).status).toBe(204)
    expect(await registry.get('demo')).toBeUndefined()
    expect(catalog.get('demo_echo')).toBeUndefined()
    expect((await fetch(`${base}/plugins/demo`)).status).toBe(404)
  })
})
