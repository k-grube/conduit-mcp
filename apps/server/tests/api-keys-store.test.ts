import { describe, expect, it } from 'vitest'
import { ApiKeysStore } from '../src/storage/api-keys-store.js'

describe('ApiKeysStore', () => {
  it('create returns a cmk_ raw key and verify round-trips', async () => {
    const store = new ApiKeysStore('KeysT1')
    const { rawKey } = await store.create('ci key', ['read-only'])
    expect(rawKey).toMatch(/^cmk_[0-9a-f]{32}$/)
    const found = await store.verify(rawKey)
    expect(found?.name).toBe('ci key')
    expect(found?.roleIds).toEqual(['read-only'])
  })

  it('verify returns undefined for unknown key', async () => {
    const store = new ApiKeysStore('KeysT2')
    expect(await store.verify('cmk_' + '0'.repeat(32))).toBeUndefined()
  })

  it('list never exposes hashes or raw keys', async () => {
    const store = new ApiKeysStore('KeysT3')
    await store.create('a', ['admin'])
    const [item] = await store.list()
    expect(item).toEqual({
      id: expect.any(String),
      name: 'a',
      roleIds: ['admin'],
      createdAt: expect.any(String),
    })
  })

  it('remove kills verification', async () => {
    const store = new ApiKeysStore('KeysT4')
    const { id, rawKey } = await store.create('a', [])
    await store.remove(id)
    expect(await store.verify(rawKey)).toBeUndefined()
  })
})
