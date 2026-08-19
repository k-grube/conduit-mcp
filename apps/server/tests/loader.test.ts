import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'
import { ToolCatalog } from '../src/catalog/catalog.js'
import { PluginLoader } from '../src/plugins/loader.js'

const fixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'demo-plugin')

const stubCtx = {
  getSecret: async () => '',
  setSecret: async () => {},
  getConfig: async () => ({}),
  invokeTool: async () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
} as PluginContext

async function makeLoader(table: string) {
  const registry = new PluginRegistryStore(table)
  const catalog = new ToolCatalog()
  const loader = new PluginLoader({
    registry,
    catalog,
    pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-l-')),
    createContext: () => stubCtx,
  })
  return { registry, catalog, loader }
}

describe('PluginLoader', () => {
  it('loads a local plugin to active and registers tools', async () => {
    const { registry, catalog, loader } = await makeLoader('LoadT1')
    const rec = {
      id: 'demo',
      source: 'local' as const,
      localPath: fixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    expect((await registry.get('demo'))?.status).toBe('active')
    expect(catalog.get('demo_echo')).toBeDefined()
    expect(await catalog.get('demo_add')!.invoke({ a: 1, b: 2 })).toBe(3)
  })

  it('quarantines on bundle failure with stage-tagged error', async () => {
    const { registry, catalog, loader } = await makeLoader('LoadT2')
    const brokenDir = await mkdtemp(join(tmpdir(), 'conduit-broken-'))
    await writeFile(
      join(brokenDir, 'conduit.plugin.json'),
      JSON.stringify({ id: 'broken', name: 'B', toolPrefix: 'broken_', entry: 'src/index.ts', sdkVersion: '^0.1' }),
    )
    await mkdir(join(brokenDir, 'src'), { recursive: true })
    await writeFile(join(brokenDir, 'src', 'index.ts'), 'export default {{{')
    const rec = {
      id: 'broken',
      source: 'local' as const,
      localPath: brokenDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    const after = await registry.get('broken')
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^bundle: /)
    expect(catalog.list('broken')).toEqual([])
  })

  it('quarantines when manifest id mismatches the record', async () => {
    const { registry, loader } = await makeLoader('LoadT3')
    const rec = {
      id: 'other',
      source: 'local' as const,
      localPath: fixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    const after = await registry.get('other')
    expect(after?.status).toBe('quarantined')
    expect(after?.lastError).toMatch(/^manifest: /)
  })

  it('loadAll skips disabled records and survives failures', async () => {
    const { registry, catalog, loader } = await makeLoader('LoadT4')
    await registry.upsert({ id: 'demo', source: 'local', localPath: fixtureDir, enabled: true, status: 'loading' })
    await registry.upsert({ id: 'off', source: 'local', localPath: fixtureDir, enabled: false, status: 'loading' })
    await registry.upsert({
      id: 'gone',
      source: 'local',
      localPath: join(tmpdir(), 'nope'),
      enabled: true,
      status: 'loading',
    })
    await loader.loadAll()
    expect((await registry.get('demo'))?.status).toBe('active')
    expect((await registry.get('off'))?.status).toBe('loading')
    expect((await registry.get('gone'))?.status).toBe('quarantined')
    expect(catalog.get('demo_echo')).toBeDefined()
  })

  it('reload after quarantine returns to active and clears lastError', async () => {
    const { registry, loader } = await makeLoader('LoadT5')
    const rec = {
      id: 'demo',
      source: 'local' as const,
      localPath: join(tmpdir(), 'nope'),
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    expect((await registry.get('demo'))?.status).toBe('quarantined')
    const fixed = { ...rec, localPath: fixtureDir }
    await registry.upsert(fixed)
    await loader.load(fixed)
    const after = await registry.get('demo')
    expect(after?.status).toBe('active')
    expect(after?.lastError).toBeUndefined()
  })

  it('registers plugin jobs on load and unregisters on quarantine', async () => {
    const { JobScheduler } = await import('../src/jobs/scheduler.js')
    const scheduler = new JobScheduler()
    const registry = new PluginRegistryStore('LoadT6')
    const catalog = new ToolCatalog()
    const loader = new PluginLoader({
      registry,
      catalog,
      pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-lj-')),
      createContext: () => stubCtx,
      scheduler,
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
    expect(scheduler.names()).toEqual(['plugin:demo:tick'])
    const broken = { ...rec, localPath: join(tmpdir(), 'nope') }
    await registry.upsert(broken)
    await loader.load(broken)
    expect(scheduler.names()).toEqual([])
  })

  it('load does not throw when setStatus loses a race with a delete', async () => {
    const { registry, catalog, loader } = await makeLoader('LoadT7')
    const rec = {
      id: 'demo',
      source: 'local' as const,
      localPath: fixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    vi.spyOn(registry, 'setStatus').mockRejectedValue(new Error('unknown plugin: demo'))
    await expect(loader.load(rec)).resolves.toBeUndefined()
    expect(catalog.get('demo_echo')).toBeDefined()
  })

  it('load does not throw when the quarantine setStatus loses a race with a delete', async () => {
    const { registry, loader } = await makeLoader('LoadT8')
    const rec = {
      id: 'demo',
      source: 'local' as const,
      localPath: join(tmpdir(), 'nope'),
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    vi.spyOn(registry, 'setStatus').mockRejectedValue(new Error('unknown plugin: demo'))
    await expect(loader.load(rec)).resolves.toBeUndefined()
  })

  it('registers plugin routes on load and removes them on unload', async () => {
    const { PluginRoutesRegistry } = await import('../src/plugins/routes-registry.js')
    const routes = new PluginRoutesRegistry()
    const registry = new PluginRegistryStore('LoadT7')
    const catalog = new ToolCatalog()
    const loader = new PluginLoader({
      registry,
      catalog,
      pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-lr-')),
      createContext: () => stubCtx,
      routes,
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
    expect(routes.get('demo')).toBeDefined()
    await loader.unload('demo')
    expect(routes.get('demo')).toBeUndefined()
  })

  const healthFixtureDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'health-plugin')

  it('persists a passing health result after load', async () => {
    const { registry, loader } = await makeLoader('LoadT9')
    const rec = {
      id: 'health-demo',
      source: 'local' as const,
      localPath: healthFixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    const after = await registry.get('health-demo')
    expect(after?.status).toBe('active')
    expect(after?.health?.ok).toBe(true)
    expect(after?.health?.checkedAt).toBeDefined()
  })

  it('persists a failing health result without quarantining', async () => {
    const registry = new PluginRegistryStore('LoadT10')
    const catalog = new ToolCatalog()
    const unhealthyCtx = { ...stubCtx, getConfig: async () => ({ healthy: false }) } as PluginContext
    const loader = new PluginLoader({
      registry,
      catalog,
      pluginsRoot: await mkdtemp(join(tmpdir(), 'conduit-lh-')),
      createContext: () => unhealthyCtx,
    })
    const rec = {
      id: 'health-demo',
      source: 'local' as const,
      localPath: healthFixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    const after = await registry.get('health-demo')
    expect(after?.status).toBe('active')
    expect(after?.health).toMatchObject({ ok: false, detail: 'down' })
  })

  it('runHealthCheck returns undefined for a plugin without a health check and survives persist failure', async () => {
    const { registry, loader } = await makeLoader('LoadT11')
    expect(await loader.runHealthCheck('nope')).toBeUndefined()
    const rec = {
      id: 'health-demo',
      source: 'local' as const,
      localPath: healthFixtureDir,
      enabled: true,
      status: 'loading' as const,
    }
    await registry.upsert(rec)
    await loader.load(rec)
    vi.spyOn(registry, 'setHealth').mockRejectedValue(new Error('table down'))
    await expect(loader.runHealthCheck('health-demo')).resolves.toMatchObject({ ok: true })
  })
})
