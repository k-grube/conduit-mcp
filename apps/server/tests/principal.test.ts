import { describe, expect, it } from 'vitest'
import { RolesStore } from '../src/storage/roles-store.js'
import { ConfigStore } from '../src/storage/config-store.js'
import {
  parsePrincipal,
  permissionsForPrincipal,
  rolesForPrincipal,
  serializePrincipal,
} from '../src/auth/principal.js'
import { ensureBootstrapAdmin, seedAuthFromEnv } from '../src/auth/bootstrap.js'

const apiKeyPrincipal = { kind: 'apikey' as const, id: 'apikey:k1', name: 'ci', roleIds: ['read-only'] }
const userPrincipal = { kind: 'user' as const, id: 'user:oid-1', oid: 'oid-1', groups: ['g1'] }

describe('principal serialization', () => {
  it('round-trips', () => {
    expect(parsePrincipal(serializePrincipal(apiKeyPrincipal))).toEqual(apiKeyPrincipal)
  })

  it('user round-trips with name', () => {
    const withName = { ...userPrincipal, name: 'alice' }
    expect(parsePrincipal(serializePrincipal(withName))).toEqual(withName)
  })

  it('returns undefined for garbage and legacy anonymous', () => {
    expect(parsePrincipal('anonymous')).toBeUndefined()
    expect(parsePrincipal('{}')).toBeUndefined()
  })

  it('rejects apikey with malformed roleIds', () => {
    const malformed = JSON.stringify({
      kind: 'apikey',
      id: 'apikey:k1',
      name: 'ci',
      roleIds: {},
    })
    expect(parsePrincipal(malformed)).toBeUndefined()
  })

  it('rejects user with malformed groups', () => {
    const malformed = JSON.stringify({
      kind: 'user',
      id: 'user:1',
      oid: '1',
      groups: 'nope',
    })
    expect(parsePrincipal(malformed)).toBeUndefined()
  })
})

describe('rolesForPrincipal', () => {
  it('apikey gets its roleIds, mcp surface only', async () => {
    const store = new RolesStore('PrinT1')
    await store.seedBuiltins()
    const roles = await rolesForPrincipal(apiKeyPrincipal, store)
    expect(roles.map((r) => r.id)).toEqual(['read-only'])
  })

  it('apikey referencing portal-only role gets nothing', async () => {
    const store = new RolesStore('PrinT2')
    await store.seedBuiltins()
    const roles = await rolesForPrincipal({ ...apiKeyPrincipal, roleIds: ['portal-admin'] }, store)
    expect(roles).toEqual([])
  })

  it('user matches by oid membership', async () => {
    const store = new RolesStore('PrinT3')
    await store.seedBuiltins()
    const admin = (await store.get('admin'))!
    await store.upsert({ ...admin, members: { users: ['oid-1'], groups: [] } })
    const roles = await rolesForPrincipal(userPrincipal, store)
    expect(roles.map((r) => r.id)).toEqual(['admin'])
  })

  it('user matches by group membership', async () => {
    const store = new RolesStore('PrinT4')
    await store.seedBuiltins()
    const ro = (await store.get('read-only'))!
    await store.upsert({ ...ro, members: { users: [], groups: ['g1'] } })
    const roles = await rolesForPrincipal(userPrincipal, store)
    expect(roles.map((r) => r.id)).toEqual(['read-only'])
  })

  it('permissionsForPrincipal composes', async () => {
    const store = new RolesStore('PrinT5')
    await store.seedBuiltins()
    const p = await permissionsForPrincipal(apiKeyPrincipal, store)
    expect(p.integrations.get('*')).toBe('read')
  })
})

describe('ensureBootstrapAdmin', () => {
  it('adds the oid to admin and portal-admin once, and is a no-op without an oid', async () => {
    const store = new RolesStore('PrinT6')
    await store.seedBuiltins()
    await ensureBootstrapAdmin(store, 'oid-b')
    await ensureBootstrapAdmin(store, 'oid-b')
    expect((await store.get('admin'))!.members.users).toEqual(['oid-b'])
    expect((await store.get('portal-admin'))!.members.users).toEqual(['oid-b'])
    await ensureBootstrapAdmin(store, undefined)
    expect((await store.get('admin'))!.members.users).toEqual(['oid-b'])
  })
})

describe('seedAuthFromEnv', () => {
  it('seeds when the auth domain is empty and env has both values', async () => {
    const config = new ConfigStore({ tableName: 'PrinT7Cfg' })
    await seedAuthFromEnv(config, { ENTRA_TENANT_ID: 'tid-x', ENTRA_CLIENT_ID: 'cid-x' })
    expect(await config.getDomain('auth')).toEqual({ tenantId: 'tid-x', clientId: 'cid-x' })
  })

  it('is a no-op when the auth domain already has a value', async () => {
    const config = new ConfigStore({ tableName: 'PrinT8Cfg' })
    await config.updateDomain('auth', { tenantId: 'existing' })
    await seedAuthFromEnv(config, { ENTRA_TENANT_ID: 'tid-x', ENTRA_CLIENT_ID: 'cid-x' })
    expect(await config.getDomain('auth')).toEqual({ tenantId: 'existing' })
  })

  it('is a no-op when env is missing either value', async () => {
    const config = new ConfigStore({ tableName: 'PrinT9Cfg' })
    await seedAuthFromEnv(config, { ENTRA_TENANT_ID: 'tid-x' })
    expect(await config.getDomain('auth')).toEqual({})
  })

  it('seeds serverUrl independently of tenantId/clientId presence', async () => {
    const config = new ConfigStore({ tableName: 'PrinT10Cfg' })
    await seedAuthFromEnv(config, { CONDUIT_SERVER_URL: 'https://conduit-app.example.test' })
    expect(await config.getDomain('auth')).toEqual({ serverUrl: 'https://conduit-app.example.test' })
  })

  it('is a no-op for serverUrl when the domain already has one', async () => {
    const config = new ConfigStore({ tableName: 'PrinT11Cfg' })
    await config.updateDomain('auth', { serverUrl: 'https://existing.example.test' })
    await seedAuthFromEnv(config, { CONDUIT_SERVER_URL: 'https://conduit-app.example.test' })
    expect(await config.getDomain('auth')).toEqual({ serverUrl: 'https://existing.example.test' })
  })

  it('seeds tenantId/clientId and serverUrl together in one pass', async () => {
    const config = new ConfigStore({ tableName: 'PrinT12Cfg' })
    await seedAuthFromEnv(config, {
      ENTRA_TENANT_ID: 'tid-x',
      ENTRA_CLIENT_ID: 'cid-x',
      CONDUIT_SERVER_URL: 'https://conduit-app.example.test',
    })
    expect(await config.getDomain('auth')).toEqual({
      tenantId: 'tid-x',
      clientId: 'cid-x',
      serverUrl: 'https://conduit-app.example.test',
    })
  })
})
