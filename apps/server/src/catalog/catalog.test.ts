import { describe, expect, it } from 'vitest'
import { definePlugin, defineTool, parseManifest, z, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { ToolCatalog } from './catalog.js'

const manifest = parseManifest({
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

function demoPlugin() {
  return definePlugin({
    tools: [
      defineTool({
        name: 'demo_echo',
        description: 'echo text back',
        keywords: ['echo'],
        params: { text: z.string() },
        readOnly: true,
        handler: async (args) => args.text,
      }),
      defineTool({
        name: 'demo_add',
        description: 'add two numbers',
        params: { a: z.number(), b: z.number() },
        readOnly: true,
        handler: async (args) => args.a + args.b,
      }),
    ],
  })
}

describe('ToolCatalog', () => {
  it('registers tools and lists them', () => {
    const cat = new ToolCatalog()
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    expect(cat.list().map((e) => e.name)).toEqual(['demo_echo', 'demo_add'])
    expect(cat.get('demo_echo')?.integrationName).toBe('Demo')
  })

  it('invoke binds the plugin context', async () => {
    const cat = new ToolCatalog()
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    expect(await cat.get('demo_add')!.invoke({ a: 2, b: 3 })).toBe(5)
  })

  it('re-registering a plugin replaces its tools', () => {
    const cat = new ToolCatalog()
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    const v = cat.version
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    expect(cat.list()).toHaveLength(2)
    expect(cat.version).toBeGreaterThan(v)
  })

  it('rejects a tool name owned by another plugin', () => {
    const cat = new ToolCatalog()
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    const other = parseManifest({ ...manifest, id: 'demo2', name: 'Demo2' })
    expect(() => cat.registerPlugin(other, demoPlugin(), stubCtx)).toThrow(/owned by/)
  })

  it('enforces the manifest prefix', () => {
    const bad = definePlugin({
      tools: [defineTool({ name: 'other_x', description: 'x', params: {}, readOnly: true, handler: async () => null })],
    })
    const cat = new ToolCatalog()
    expect(() => cat.registerPlugin(manifest, bad, stubCtx)).toThrow(/prefix/)
  })

  it('removePlugin drops entries and integrations reports counts', () => {
    const cat = new ToolCatalog()
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    expect(cat.integrations()).toEqual([{ id: 'demo', name: 'Demo', toolCount: 2 }])
    cat.removePlugin('demo')
    expect(cat.list()).toEqual([])
    expect(cat.integrations()).toEqual([])
  })
})

describe('manifest and health retention', () => {
  it('getManifest returns the registered manifest', () => {
    const cat = new ToolCatalog()
    cat.registerPlugin(manifest, demoPlugin(), stubCtx)
    expect(cat.getManifest('demo')?.toolPrefix).toBe('demo_')
    expect(cat.getManifest('nope')).toBeUndefined()
  })

  it('health invokes the plugin healthCheck with ctx', async () => {
    const cat = new ToolCatalog()
    const withHealth = { ...demoPlugin(), healthCheck: async () => ({ ok: true, detail: 'fine' }) }
    cat.registerPlugin(manifest, withHealth, stubCtx)
    expect(await cat.health('demo')).toEqual({ ok: true, detail: 'fine' })
    expect(await cat.health('nope')).toBeUndefined()
  })

  it('health times out slow checks', async () => {
    const cat = new ToolCatalog()
    const slow = { ...demoPlugin(), healthCheck: () => new Promise<never>(() => {}) }
    cat.registerPlugin(manifest, slow as never, stubCtx)
    const result = await cat.health('demo', 50)
    expect(result).toEqual({ ok: false, detail: 'health check timeout' })
  })
})

function seededCatalog() {
  const cat = new ToolCatalog()
  cat.registerPlugin(manifest, demoPlugin(), stubCtx)
  return cat
}

function reRegisterSamePlugin(cat: ToolCatalog) {
  cat.registerPlugin(manifest, demoPlugin(), stubCtx)
}

describe('notes overlay', () => {
  it('setNotes attaches tool notes, bumps version, clears on empty snapshot', () => {
    const cat = seededCatalog()
    const before = cat.version
    cat.setNotes({ tools: { demo_echo: 'client uses CFClientCode' }, integrations: { demo: 'halo lore' } })
    expect(cat.version).toBeGreaterThan(before)
    expect(cat.get('demo_echo')?.notes).toBe('client uses CFClientCode')
    expect(cat.integrationNotes('demo')).toBe('halo lore')
    cat.setNotes({ tools: {}, integrations: {} })
    expect(cat.get('demo_echo')?.notes).toBeUndefined()
    expect(cat.integrationNotes('demo')).toBeUndefined()
  })

  it('registerPlugin re-applies existing notes', () => {
    const cat = seededCatalog()
    cat.setNotes({ tools: { demo_echo: 'note text' }, integrations: {} })
    reRegisterSamePlugin(cat)
    expect(cat.get('demo_echo')?.notes).toBe('note text')
  })
})
