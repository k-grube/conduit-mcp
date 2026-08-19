import { describe, expect, it } from 'vitest'
import { PluginRegistryStore } from '../src/storage/plugin-registry.js'

describe('PluginRegistryStore', () => {
  it('upserts and lists records', async () => {
    const store = new PluginRegistryStore('PlugT1')
    await store.upsert({
      id: 'halopsa',
      source: 'git',
      repoUrl: 'https://github.com/conduit-mcp/plugin-halopsa',
      ref: 'main',
      commit: 'abc123',
      enabled: true,
      status: 'loading',
    })
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].repoUrl).toContain('plugin-halopsa')
  })

  it('get returns undefined for missing', async () => {
    const store = new PluginRegistryStore('PlugT2')
    expect(await store.get('nope')).toBeUndefined()
  })

  it('setStatus updates status and error', async () => {
    const store = new PluginRegistryStore('PlugT3')
    await store.upsert({ id: 'x', source: 'local', localPath: 'packages/plugins/x', enabled: true, status: 'loading' })
    await store.setStatus('x', 'quarantined', 'build failed')
    const rec = await store.get('x')
    expect(rec?.status).toBe('quarantined')
    expect(rec?.lastError).toBe('build failed')
  })

  it('remove deletes', async () => {
    const store = new PluginRegistryStore('PlugT4')
    await store.upsert({ id: 'x', source: 'local', localPath: 'p', enabled: true, status: 'active' })
    await store.remove('x')
    expect(await store.get('x')).toBeUndefined()
  })

  it('remove is a no-op for a nonexistent plugin', async () => {
    const store = new PluginRegistryStore('PlugT5')
    await expect(store.remove('nope')).resolves.toBeUndefined()
  })

  it('setHealth persists health and no-ops on a missing record', async () => {
    const store = new PluginRegistryStore('PlugRegHealth')
    await store.upsert({ id: 'h1', source: 'local', localPath: '/x', enabled: true, status: 'active' })
    await store.setHealth('h1', { ok: false, detail: 'down', checkedAt: '2026-08-12T00:00:00.000Z' })
    expect((await store.get('h1'))?.health).toEqual({
      ok: false,
      detail: 'down',
      checkedAt: '2026-08-12T00:00:00.000Z',
    })
    await expect(store.setHealth('nope', { ok: true, checkedAt: '2026-08-12T00:00:00.000Z' })).resolves.toBeUndefined()
  })
})
