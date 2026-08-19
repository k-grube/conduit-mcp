import express from 'express'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseManifest, definePlugin, defineTool, z as sdkZ, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { ConfigStore } from '../src/storage/config-store.js'
import { EnvSecretProvider, type SecretProvider } from '../src/secrets/provider.js'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { createPluginConfigRouter } from '../src/admin/plugin-config-router.js'

let server: Server
let base: string
const config = new ConfigStore({ tableName: 'PCfgRtT1' })
const registry = new PluginRegistryStore('PCfgRtReg')
const catalog = new ToolCatalog()
const refresh = vi.fn(async () => undefined)

// EnvSecretProvider is read-only, PUT /:id/secrets happy path needs a provider that actually writes
const fakeSecrets = (() => {
  const store = new Map<string, string>([['DEMO_TOKEN', 'tok']])
  return {
    writable: true,
    getSecret: async (n: string) => {
      const v = store.get(n)
      if (v === undefined) {
        throw new Error(`missing ${n}`)
      }
      return v
    },
    setSecret: async (n: string, v: string) => {
      store.set(n, v)
    },
    peek: (n: string) => store.get(n),
  }
})()

beforeAll(async () => {
  process.env.DEMO_TOKEN = 'tok'
  const manifest = parseManifest({
    id: 'demo',
    name: 'Demo',
    toolPrefix: 'demo_',
    entry: 'src/index.ts',
    sdkVersion: '^0.1',
    secrets: ['DEMO_TOKEN', 'DEMO_OTHER'],
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
    manifest,
    definePlugin({
      tools: [
        defineTool({
          name: 'demo_x',
          description: 'x',
          params: { v: sdkZ.string() },
          readOnly: true,
          handler: async () => null,
        }),
      ],
    }),
    stubCtx,
  )
  await registry.upsert({ id: 'demo', source: 'local', localPath: 'x', enabled: true, status: 'active' })
  const app = express()
  app.use(express.json())
  app.use(
    '/plugins',
    createPluginConfigRouter({ config, secrets: new EnvSecretProvider(), catalog, registry, refresh }),
  )
  app.use(
    '/wplugins',
    createPluginConfigRouter({ config, secrets: fakeSecrets as SecretProvider, catalog, registry, refresh }),
  )
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

describe('plugin config router', () => {
  it('round-trips plugin config', async () => {
    const put = await fetch(`${base}/plugins/demo/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ writes: { enabled: true } }),
    })
    expect(put.status).toBe(200)
    const got = (await (await fetch(`${base}/plugins/demo/config`)).json()) as { writes: { enabled: boolean } }
    expect(got.writes.enabled).toBe(true)
  })

  it('404s unknown plugins', async () => {
    expect((await fetch(`${base}/plugins/nope/config`)).status).toBe(404)
  })

  it('reports secret status without values', async () => {
    const res = await fetch(`${base}/plugins/demo/secrets`)
    const body = (await res.json()) as { items: { name: string; set: boolean }[] }
    expect(body.items).toEqual([
      { name: 'DEMO_TOKEN', set: true },
      { name: 'DEMO_OTHER', set: false },
    ])
  })

  it('rejects undeclared secret names', async () => {
    const res = await fetch(`${base}/plugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ NOT_DECLARED: 'v' }),
    })
    expect(res.status).toBe(400)
  })

  it('409s a valid secrets write when the store is read-only', async () => {
    refresh.mockClear()
    const res = await fetch(`${base}/plugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ DEMO_TOKEN: 'v' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()) as { error: string }).toEqual({
      error: 'secret store is read-only, set secrets via environment variables',
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('empty secrets save stays a 204 no-op on a read-only store', async () => {
    const res = await fetch(`${base}/plugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(204)
  })

  it('writes declared secrets and returns 204', async () => {
    const res = await fetch(`${base}/wplugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ DEMO_OTHER: 'newval' }),
    })
    expect(res.status).toBe(204)
    expect(fakeSecrets.peek('DEMO_OTHER')).toBe('newval')
    const status = (await (await fetch(`${base}/wplugins/demo/secrets`)).json()) as {
      items: { name: string; set: boolean }[]
    }
    expect(status.items.find((i) => i.name === 'DEMO_OTHER')?.set).toBe(true)
  })

  it('refreshes the plugin after a config save', async () => {
    refresh.mockClear()
    const res = await fetch(`${base}/plugins/demo/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ some: 'value' }),
    })
    expect(res.status).toBe(200)
    expect(refresh).toHaveBeenCalledWith('demo')
  })

  it('refreshes the plugin after a secrets save', async () => {
    refresh.mockClear()
    // /plugins mounts EnvSecretProvider (read-only), /wplugins mounts the writable fake
    const res = await fetch(`${base}/wplugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ DEMO_TOKEN: 'new' }),
    })
    expect(res.status).toBe(204)
    expect(refresh).toHaveBeenCalledWith('demo')
  })

  it('does not refresh on a rejected save', async () => {
    refresh.mockClear()
    const res = await fetch(`${base}/plugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ NOT_DECLARED: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not refresh on an empty secrets save', async () => {
    refresh.mockClear()
    const res = await fetch(`${base}/wplugins/demo/secrets`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(204)
    expect(refresh).not.toHaveBeenCalled()
  })
})
