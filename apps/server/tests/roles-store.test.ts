import { describe, expect, it } from 'vitest'
import { RolesStore, type Role } from '../src/storage/roles-store.js'

describe('RolesStore', () => {
  it('seedBuiltins creates the four builtin roles idempotently', async () => {
    const store = new RolesStore('RolesT1')
    await store.seedBuiltins()
    await store.seedBuiltins()
    const roles = await store.list()
    expect(roles.map((r) => r.id).sort()).toEqual(['admin', 'editor', 'portal-admin', 'read-only'])
    expect(roles.every((r) => r.builtin)).toBe(true)
  })

  it('seedBuiltins keeps existing member edits', async () => {
    const store = new RolesStore('RolesT2')
    await store.seedBuiltins()
    const admin = (await store.get('admin'))!
    await store.upsert({ ...admin, members: { users: ['oid-1'], groups: [] } })
    await store.seedBuiltins()
    expect((await store.get('admin'))!.members.users).toEqual(['oid-1'])
  })

  it('remove refuses builtin roles', async () => {
    const store = new RolesStore('RolesT3')
    await store.seedBuiltins()
    await expect(store.remove('admin')).rejects.toThrow(/builtin/)
  })

  it('remove is a no-op for a nonexistent non-builtin role', async () => {
    const store = new RolesStore('RolesT5')
    await expect(store.remove('nope')).resolves.toBeUndefined()
  })

  it('custom role round-trip with grants', async () => {
    const store = new RolesStore('RolesT4')
    await store.upsert({
      id: 'halo-ro',
      name: 'Halo read only',
      grants: [{ kind: 'integration', integrationId: 'halopsa', mode: 'read' }],
      surfaces: ['mcp'],
      members: { users: [], groups: ['g1'] },
    })
    const got = (await store.get('halo-ro'))!
    expect(got.grants[0]).toEqual({ kind: 'integration', integrationId: 'halopsa', mode: 'read' })
  })

  it('seedBuiltins reconciles grants but preserves members', async () => {
    const store = new RolesStore('RolesT6')
    await store.seedBuiltins()
    const admin = (await store.get('admin'))!
    await store.upsert({ ...admin, grants: [], members: { users: ['oid-1'], groups: [] } })
    await store.seedBuiltins()
    const after = (await store.get('admin'))!
    expect(after.grants).toEqual([{ kind: 'wildcard_all' }])
    expect(after.members.users).toEqual(['oid-1'])
  })

  it('seedBuiltins does not reconcile custom role squatting builtin id', async () => {
    const store = new RolesStore('RolesT7')
    const custom: Role = {
      id: 'admin',
      name: 'Custom Admin',
      grants: [{ kind: 'tool', toolName: 'custom' }],
      surfaces: ['mcp'],
      members: { users: [], groups: [] },
    }
    await store.upsert(custom)
    await store.seedBuiltins()
    const after = (await store.get('admin'))!
    expect(after.name).toBe('Custom Admin')
    expect(after.grants).toEqual([{ kind: 'tool', toolName: 'custom' }])
  })
})
