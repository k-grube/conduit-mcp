import { describe, expect, it } from 'vitest'
import type { TableClient } from '@azure/data-tables'
import { ConfigStore, deepMerge } from '../src/storage/config-store.js'

function tableClientOf(store: ConfigStore): TableClient {
  return (store as unknown as { client: TableClient }).client
}

describe('ConfigStore', () => {
  it('returns empty object for unknown domain', async () => {
    const store = new ConfigStore({ tableName: 'CfgT1' })
    expect(await store.getDomain('server')).toEqual({})
  })

  it('updateDomain deep-merges and persists', async () => {
    const store = new ConfigStore({ tableName: 'CfgT2' })
    await store.updateDomain('server', { limits: { maxItems: 100 }, name: 'a' })
    await store.updateDomain('server', { limits: { timeoutMs: 5 } })
    const got = await store.getDomain('server')
    expect(got).toEqual({ limits: { maxItems: 100, timeoutMs: 5 }, name: 'a' })
  })

  it('caches reads within ttl and invalidates on write', async () => {
    const store = new ConfigStore({ tableName: 'CfgT3', ttlMs: 60_000 })
    await store.updateDomain('a', { v: 1 })
    await store.getDomain('a')
    // second store writing behind the first's cache
    const other = new ConfigStore({ tableName: 'CfgT3' })
    await other.updateDomain('a', { v: 2 })
    // cached value still served
    expect((await store.getDomain('a')).v).toBe(1)
    await store.updateDomain('a', { w: 3 })
    expect((await store.getDomain('a')).v).toBe(2)
  })

  it('fires onChange with the domain', async () => {
    const store = new ConfigStore({ tableName: 'CfgT4' })
    const seen: string[] = []
    const off = store.onChange((d) => seen.push(d))
    await store.updateDomain('x', { a: 1 })
    off()
    await store.updateDomain('x', { a: 2 })
    expect(seen).toEqual(['x'])
  })

  it('a throwing listener does not block later listeners or fail the write', async () => {
    const store = new ConfigStore({ tableName: 'CfgT7' })
    const seen: string[] = []
    store.onChange(() => {
      throw new Error('boom')
    })
    store.onChange((d) => seen.push(d))
    await expect(store.updateDomain('x', { a: 1 })).resolves.toBeUndefined()
    expect(seen).toEqual(['x'])
  })

  it('plugin domains use plugin: prefix rows', async () => {
    const store = new ConfigStore({ tableName: 'CfgT5' })
    await store.updateDomain('plugin:halopsa', { writes: { enabled: false } })
    expect(await store.getDomain('plugin:halopsa')).toEqual({ writes: { enabled: false } })
  })

  it('getDomain returns a clone, mutating it does not poison the cache', async () => {
    const store = new ConfigStore({ tableName: 'CfgT6' })
    await store.updateDomain('a', { nested: { v: 1 } })
    const first = await store.getDomain<{ nested: { v: number } }>('a')
    first.nested.v = 999
    const second = await store.getDomain<{ nested: { v: number } }>('a')
    expect(second.nested.v).toBe(1)
  })

  it('retries once on a stale etag and succeeds', async () => {
    const store = new ConfigStore({ tableName: 'CfgT8' })
    await store.updateDomain('a', { v: 1 })
    const client = tableClientOf(store)
    const original = client.updateEntity.bind(client)
    let calls = 0
    client.updateEntity = (async (...args: Parameters<TableClient['updateEntity']>) => {
      calls += 1
      if (calls === 1) {
        throw { statusCode: 412 }
      }
      return original(...args)
    }) as TableClient['updateEntity']

    await expect(store.updateDomain('a', { v: 2 })).resolves.toBeUndefined()
    expect(calls).toBe(2)
    expect((await store.getDomain<{ v: number }>('a')).v).toBe(2)
  })

  it('propagates the error when both attempts hit a stale etag', async () => {
    const store = new ConfigStore({ tableName: 'CfgT9' })
    await store.updateDomain('a', { v: 1 })
    const client = tableClientOf(store)
    client.updateEntity = (async () => {
      throw { statusCode: 412 }
    }) as TableClient['updateEntity']

    await expect(store.updateDomain('a', { v: 2 })).rejects.toMatchObject({ statusCode: 412 })
  })

  it('deepMerge ignores dangerous keys', () => {
    const merged = deepMerge({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"ok":1}'))
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(merged).toEqual({ ok: 1 })
  })
})
