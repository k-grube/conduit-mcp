import { describe, expect, it } from 'vitest'
import { definePlugin, defineTool, parseManifest, z, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { ConfigStore } from '../src/storage/config-store.js'
import { EnvSecretProvider } from '../src/secrets/provider.js'
import { AdtPluginStore } from '../src/plugins/plugin-store.js'
import { createPluginContext } from '../src/plugins/context.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import type { UsageEvent } from '../src/mcp/meta-tools.js'

const manifest = parseManifest({
  id: 'demo',
  name: 'Demo',
  toolPrefix: 'demo_',
  entry: 'src/index.ts',
  sdkVersion: '^0.1',
  secrets: ['DEMO_TOKEN'],
})

describe('AdtPluginStore', () => {
  it('round-trips and deletes values', async () => {
    const store = new AdtPluginStore('demo', 'PStoreT1')
    await store.set('cursor', { page: 3 })
    expect(await store.get('cursor')).toEqual({ page: 3 })
    await store.delete('cursor')
    expect(await store.get('cursor')).toBeUndefined()
  })

  it('isolates plugins by partition', async () => {
    const a = new AdtPluginStore('a', 'PStoreT2')
    const b = new AdtPluginStore('b', 'PStoreT2')
    await a.set('k', 1)
    expect(await b.get('k')).toBeUndefined()
  })
})

describe('createPluginContext', () => {
  it('scopes secrets to the manifest', async () => {
    process.env.DEMO_TOKEN = 'tok'
    const ctx = createPluginContext(manifest, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: 'PCtxT1' }),
      storeTableName: 'PStoreT3',
    })
    expect(await ctx.getSecret('DEMO_TOKEN')).toBe('tok')
    await expect(ctx.getSecret('OTHER_TOKEN')).rejects.toThrow(/not declared/)
    await expect(ctx.setSecret('OTHER_TOKEN', 'x')).rejects.toThrow(/not declared/)
  })

  it('getConfig reads the plugin config domain', async () => {
    const config = new ConfigStore({ tableName: 'PCtxT2' })
    await config.updateDomain('plugin:demo', { writes: { enabled: true } })
    const ctx = createPluginContext(manifest, {
      secrets: new EnvSecretProvider(),
      config,
      storeTableName: 'PStoreT4',
    })
    expect(await ctx.getConfig()).toEqual({ writes: { enabled: true } })
  })
})

describe('createPluginContext invokeTool', () => {
  const stubCtx = {
    getSecret: async () => '',
    setSecret: async () => {},
    getConfig: async () => ({}),
    invokeTool: async () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
  } as PluginContext

  function makeCatalog() {
    const catalog = new ToolCatalog()
    catalog.registerPlugin(
      parseManifest({ id: 'b', name: 'B', toolPrefix: 'b_', entry: 'e', sdkVersion: '^0.1' }),
      definePlugin({
        tools: [
          defineTool({
            name: 'b_echo',
            description: 'echo text back',
            params: { text: z.string() },
            readOnly: true,
            handler: async (args) => args.text,
          }),
        ],
      }),
      stubCtx,
    )
    return catalog
  }

  it('invokes another plugin tool through the catalog and records usage with a plugin principal', async () => {
    const catalog = makeCatalog()
    const usage: UsageEvent[] = []
    const ctxA = createPluginContext(manifest, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: 'PCtxT3' }),
      storeTableName: 'PStoreT5',
      getCatalog: () => catalog,
      onUsage: (e) => usage.push(e),
    })
    const result = await ctxA.invokeTool('b_echo', { text: 'hi' })
    expect(result).toBe('hi')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ tool: 'b_echo', pluginId: 'b', principal: 'plugin:demo', ok: true })
  })

  it('throws on an unknown tool without recording usage', async () => {
    const catalog = makeCatalog()
    const usage: UsageEvent[] = []
    const ctxA = createPluginContext(manifest, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: 'PCtxT4' }),
      storeTableName: 'PStoreT6',
      getCatalog: () => catalog,
      onUsage: (e) => usage.push(e),
    })
    await expect(ctxA.invokeTool('b_nope', {})).rejects.toThrow(/unknown tool/)
    expect(usage).toHaveLength(0)
  })

  it('throws on invalid args without recording usage', async () => {
    const catalog = makeCatalog()
    const usage: UsageEvent[] = []
    const ctxA = createPluginContext(manifest, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: 'PCtxT5' }),
      storeTableName: 'PStoreT7',
      getCatalog: () => catalog,
      onUsage: (e) => usage.push(e),
    })
    await expect(ctxA.invokeTool('b_echo', { text: 5 })).rejects.toThrow(/invalid args/)
    expect(usage).toHaveLength(0)
  })

  it('rejects runaway mutual recursion with a depth limit instead of hanging', async () => {
    const catalog = new ToolCatalog()
    const manifestA = parseManifest({ id: 'demo', name: 'Demo', toolPrefix: 'demo_', entry: 'e', sdkVersion: '^0.1' })
    const manifestC = parseManifest({ id: 'c', name: 'C', toolPrefix: 'c_', entry: 'e', sdkVersion: '^0.1' })
    const ctxA = createPluginContext(manifestA, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: 'PCtxT8' }),
      storeTableName: 'PStoreT10',
      getCatalog: () => catalog,
    })
    const ctxC = createPluginContext(manifestC, {
      secrets: new EnvSecretProvider(),
      config: new ConfigStore({ tableName: 'PCtxT9' }),
      storeTableName: 'PStoreT11',
      getCatalog: () => catalog,
    })
    // A's tool calls C's tool which calls A's tool back, unbounded without the depth guard
    catalog.registerPlugin(
      manifestA,
      definePlugin({
        tools: [
          defineTool({
            name: 'demo_ping',
            description: 'pings c',
            params: {},
            readOnly: true,
            handler: async (_args, ctx) => ctx.invokeTool('c_ping', {}),
          }),
        ],
      }),
      ctxA,
    )
    catalog.registerPlugin(
      manifestC,
      definePlugin({
        tools: [
          defineTool({
            name: 'c_ping',
            description: 'pings demo',
            params: {},
            readOnly: true,
            handler: async (_args, ctx) => ctx.invokeTool('demo_ping', {}),
          }),
        ],
      }),
      ctxC,
    )
    await expect(ctxA.invokeTool('demo_ping', {})).rejects.toThrow(/depth limit/)
  })
})
