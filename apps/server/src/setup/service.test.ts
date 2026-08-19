import { describe, expect, it, vi } from 'vitest'
import {
  AlreadyConfiguredError,
  ManualValidationError,
  NotAuthenticatedError,
  OidMismatchError,
  ProvisionInProgressError,
  SetupService,
} from './service.js'
import { SetupSessionStore } from './session.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { Role, RolesStore } from '../storage/roles-store.js'

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `h.${b64}.s`
}

function makeConfig(initial: Record<string, unknown> = {}) {
  let auth: Record<string, unknown> = { ...initial }
  const updateDomain = vi.fn(async (_domain: string, patch: Record<string, unknown>) => {
    auth = { ...auth, ...patch }
  })
  const getDomain = vi.fn(async () => structuredClone(auth))
  const config = { getDomain, updateDomain }
  return { config: config as unknown as ConfigStore, updateDomain, getDomain }
}

function makeRoles() {
  const store = new Map<string, Role>()
  store.set('admin', { id: 'admin', name: 'Admin', grants: [], surfaces: ['mcp'], members: { users: [], groups: [] } })
  store.set('portal-admin', {
    id: 'portal-admin',
    name: 'Portal Admin',
    grants: [],
    surfaces: ['portal'],
    members: { users: [], groups: [] },
  })
  const get = vi.fn(async (id: string) => store.get(id))
  const upsert = vi.fn(async (role: Role) => {
    store.set(role.id, role)
  })
  return { roles: { get, upsert } as unknown as RolesStore, store }
}

function makeSecrets(writable: boolean) {
  return { writable, setSecret: vi.fn(async () => {}), getSecret: vi.fn(async () => '') }
}

// routes by method + url substring, matching the provision.test.ts fake style
function makeFetch(overrides: Record<string, ReturnType<typeof jsonResponse>> = {}) {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${url}`
    for (const [pattern, response] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        return response
      }
    }
    throw new Error(`unhandled fetch: ${key}`)
  }) as unknown as typeof fetch
}

// never resolves, freezes runProvision at the first fetch so status() can observe the
// synchronous 'active'/'pending' reset without racing the fire-and-forget chain
function hangingFetch() {
  return vi.fn(() => new Promise(() => {})) as unknown as typeof fetch
}

describe('SetupService.status', () => {
  it('unconfigured, no session', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    const status = await service.status()
    expect(status).toEqual({ configured: false, oidLockActive: false, secretsWritable: true, session: undefined })
  })

  it('configured, no live session -> bare { configured: true }, no other fields', async () => {
    const { config } = makeConfig({ tenantId: 't', clientId: 'c' })
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    const status = await service.status()
    expect(status).toEqual({ configured: true })
  })

  it('configured AND session still alive -> session block with steps/result served to the token holder', async () => {
    const { config } = makeConfig({ tenantId: 't', clientId: 'c' })
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    session.user = { oid: 'oid-1', tid: 't' }
    session.result = { tenantId: 't', clientId: 'c', consentGranted: true, secretStored: 'keyvault' }
    const service = new SetupService({ config, secrets, roles, sessions })
    const status = await service.status(session.token)
    expect(status.configured).toBe(true)
    expect(status.session?.steps).toEqual(session.steps)
    expect(status.session?.result).toEqual(session.result)
  })

  it('live session but no/wrong token -> session block hidden, base fields still returned', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-secret', 5)
    session.user = { oid: 'oid-1', tid: 't' }
    session.result = {
      tenantId: 't',
      clientId: 'c',
      consentGranted: true,
      secretStored: 'shown',
      clientSecret: 'super-secret',
    }
    const service = new SetupService({ config, secrets, roles, sessions })
    const anon = await service.status()
    expect(anon.session).toBeUndefined()
    expect(anon.secretsWritable).toBe(false)
    expect(JSON.stringify(anon)).not.toContain('super-secret')
    const wrong = await service.status('not-the-token')
    expect(wrong.session).toBeUndefined()
    expect(JSON.stringify(wrong)).not.toContain('super-secret')
  })

  it('session with result clientSecret "shown" -> secret served to token holder, no accessToken/deviceCode leak', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-secret', 5)
    session.accessToken = 'tok-secret'
    session.user = { oid: 'oid-1', tid: 't' }
    session.result = {
      tenantId: 't',
      clientId: 'c',
      consentGranted: true,
      secretStored: 'shown',
      clientSecret: 'super-secret',
    }
    const service = new SetupService({ config, secrets, roles, sessions })
    const status = await service.status(session.token)
    expect(status.session?.result?.clientSecret).toBe('super-secret')
    expect(status.session?.steps).toEqual(session.steps)
    const json = JSON.stringify(status)
    expect(json).not.toContain('accessToken')
    expect(json).not.toContain('tok-secret')
    expect(json).not.toContain('deviceCode')
    expect(json).not.toContain('dc-secret')
    expect(json).not.toContain(session.token)
  })
})

describe('SetupService.start', () => {
  it('configured -> AlreadyConfiguredError', async () => {
    const { config } = makeConfig({ tenantId: 't', clientId: 'c' })
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    await expect(service.start()).rejects.toThrow(AlreadyConfiguredError)
  })

  it('returns userCode/verificationUri/expiresIn/message/setupToken, no deviceCode', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const fetchFn = makeFetch({
      'POST https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode': jsonResponse(200, {
        device_code: 'dc-1',
        user_code: 'ABC-123',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
        message: 'go sign in',
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore(), fetchFn })
    const result = await service.start()
    expect(result).toMatchObject({
      userCode: 'ABC-123',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      message: 'go sign in',
    })
    expect(typeof result.setupToken).toBe('string')
    expect(result.setupToken.length).toBeGreaterThan(0)
    expect('deviceCode' in result).toBe(false)
  })
})

describe('SetupService.poll', () => {
  it('configured -> AlreadyConfiguredError', async () => {
    const { config } = makeConfig({ tenantId: 't', clientId: 'c' })
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    await expect(service.poll()).rejects.toThrow(AlreadyConfiguredError)
  })

  it('no session -> NotAuthenticatedError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    await expect(service.poll()).rejects.toThrow(NotAuthenticatedError)
  })

  it('wrong token -> NotAuthenticatedError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    sessions.start('dc-1', 5)
    const service = new SetupService({ config, secrets, roles, sessions })
    await expect(service.poll('not-the-token')).rejects.toThrow(NotAuthenticatedError)
  })

  it('oid mismatch with lock -> OidMismatchError, session cleared', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    const token = jwtWith({ oid: 'oid-attacker', tid: 'tid-1' })
    const fetchFn = makeFetch({
      'POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token': jsonResponse(200, {
        access_token: token,
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn, bootstrapAdminOid: 'oid-admin' })
    await expect(service.poll(session.token)).rejects.toThrow(OidMismatchError)
    expect(sessions.get()).toBeUndefined()
  })

  it('oid match with lock -> authenticated', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    const token = jwtWith({ oid: 'oid-admin', tid: 'tid-1', name: 'Ada', upn: 'ada@contoso.com' })
    const fetchFn = makeFetch({
      'POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token': jsonResponse(200, {
        access_token: token,
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn, bootstrapAdminOid: 'oid-admin' })
    const result = await service.poll(session.token)
    expect(result).toEqual({ pending: false, user: { name: 'Ada', upn: 'ada@contoso.com' } })
    expect(sessions.get()?.user?.oid).toBe('oid-admin')
  })

  it('no lock -> any oid accepted', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    const token = jwtWith({ oid: 'oid-anyone', tid: 'tid-1' })
    const fetchFn = makeFetch({
      'POST https://login.microsoftonline.com/organizations/oauth2/v2.0/token': jsonResponse(200, {
        access_token: token,
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn })
    const result = await service.poll(session.token)
    expect(result.pending).toBe(false)
    expect(sessions.get()?.user?.oid).toBe('oid-anyone')
  })
})

describe('SetupService.provision', () => {
  it('configured -> AlreadyConfiguredError', async () => {
    const { config } = makeConfig({ tenantId: 't', clientId: 'c' })
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    session.accessToken = 'tok'
    session.user = { oid: 'oid-1', tid: 't' }
    const service = new SetupService({ config, secrets, roles, sessions })
    await expect(service.provision(session.token)).rejects.toThrow(AlreadyConfiguredError)
  })

  it('not authenticated (no session) -> NotAuthenticatedError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    await expect(service.provision(undefined)).rejects.toThrow(NotAuthenticatedError)
  })

  it('wrong token -> NotAuthenticatedError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    session.accessToken = 'tok'
    session.user = { oid: 'oid-1', tid: 'tid-1' }
    const service = new SetupService({ config, secrets, roles, sessions })
    await expect(service.provision('not-the-token')).rejects.toThrow(NotAuthenticatedError)
  })

  it('not authenticated (session without access token) -> NotAuthenticatedError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    const service = new SetupService({ config, secrets, roles, sessions })
    await expect(service.provision(session.token)).rejects.toThrow(NotAuthenticatedError)
  })

  it('sets provisioning and resets steps', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    session.accessToken = 'tok'
    session.user = { oid: 'oid-1', tid: 'tid-1' }
    session.steps = session.steps.map((s) => ({ ...s, state: 'error' as const }))
    session.error = 'previous failure'
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn: hangingFetch() })
    await service.provision(session.token, 'conduit-mcp')
    const status = await service.status(session.token)
    expect(status.session?.provisioning).toBe(true)
    const steps = status.session!.steps
    expect(steps.find((s) => s.id === 'app')?.state).toBe('active')
    expect(steps.filter((s) => s.id !== 'app').every((s) => s.state === 'pending')).toBe(true)
    expect(status.session?.error).toBeUndefined()
  })

  it('second call while provisioning -> ProvisionInProgressError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    session.accessToken = 'tok'
    session.user = { oid: 'oid-1', tid: 'tid-1' }
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn: hangingFetch() })
    await service.provision(session.token, 'conduit-mcp')
    await expect(service.provision(session.token, 'conduit-mcp')).rejects.toThrow(ProvisionInProgressError)
  })
})

describe('SetupService.manual', () => {
  it('configured -> AlreadyConfiguredError', async () => {
    const { config } = makeConfig({ tenantId: 't', clientId: 'c' })
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore() })
    await expect(service.manual(undefined, { tenantId: 'tenant-1', clientId: 'client-1' })).rejects.toThrow(
      AlreadyConfiguredError,
    )
  })

  it('lock active without session -> NotAuthenticatedError', async () => {
    const { config } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const service = new SetupService({
      config,
      secrets,
      roles,
      sessions: new SetupSessionStore(),
      bootstrapAdminOid: 'oid-admin',
    })
    await expect(service.manual(undefined, { tenantId: 'tenant-1', clientId: 'client-1' })).rejects.toThrow(
      NotAuthenticatedError,
    )
  })

  it('live session but wrong token -> NotAuthenticatedError', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const sessions = new SetupSessionStore()
    sessions.start('dc-1', 5)
    const service = new SetupService({ config, secrets, roles, sessions })
    await expect(service.manual('not-the-token', { tenantId: 'tenant-1', clientId: 'client-1' })).rejects.toThrow(
      NotAuthenticatedError,
    )
    expect(updateDomain).not.toHaveBeenCalled()
  })

  it('bad tenant (openid-config 404) -> ManualValidationError', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-bad/v2.0/.well-known/openid-configuration': jsonResponse(404, {
        error: 'not_found',
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore(), fetchFn })
    await expect(service.manual(undefined, { tenantId: 'tenant-bad', clientId: 'client-1' })).rejects.toThrow(
      ManualValidationError,
    )
    expect(updateDomain).not.toHaveBeenCalled()
  })

  it('secret rejected with AADSTS7000215 body -> ManualValidationError, setSecret not called', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration': jsonResponse(200, {}),
      'POST https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token': jsonResponse(401, {
        error: 'invalid_client',
        error_description: 'AADSTS7000215: Invalid client secret provided.',
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore(), fetchFn })
    await expect(
      service.manual(undefined, { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'bad-secret' }),
    ).rejects.toThrow(ManualValidationError)
    expect(secrets.setSecret).not.toHaveBeenCalled()
    expect(updateDomain).not.toHaveBeenCalled()
  })

  it('token endpoint 500 -> warning returned, setSecret called, config written', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(true)
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration': jsonResponse(200, {}),
      'POST https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token': jsonResponse(500, {
        error: 'server_error',
      }),
    })
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore(), fetchFn })
    const result = await service.manual(undefined, {
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'a-secret',
    })
    expect(result.warning).toBe('secret stored but could not be verified against entra')
    expect(secrets.setSecret).toHaveBeenCalledWith('AZURE_CLIENT_SECRET', 'a-secret')
    expect(updateDomain).toHaveBeenCalledWith('auth', { tenantId: 'tenant-1', clientId: 'client-1' })
  })

  it('happy path -> config.updateDomain(auth, { tenantId, clientId }), session cleared', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration': jsonResponse(200, {}),
    })
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn })
    const result = await service.manual(session.token, { tenantId: 'tenant-1', clientId: 'client-1' })
    expect(result.warning).toBeUndefined()
    expect(updateDomain).toHaveBeenCalledWith('auth', { tenantId: 'tenant-1', clientId: 'client-1' })
    expect(sessions.get()).toBeUndefined()
  })

  it('no session (TOFU manual) -> succeeds without a token', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration': jsonResponse(200, {}),
    })
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore(), fetchFn })
    const result = await service.manual(undefined, { tenantId: 'tenant-1', clientId: 'client-1' })
    expect(result.warning).toBeUndefined()
    expect(updateDomain).toHaveBeenCalledWith('auth', { tenantId: 'tenant-1', clientId: 'client-1' })
  })

  it('non-writable secrets + clientSecret provided -> warning, no verify/store attempted', async () => {
    const { config, updateDomain } = makeConfig()
    const { roles } = makeRoles()
    const secrets = makeSecrets(false)
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration': jsonResponse(200, {}),
    })
    const service = new SetupService({ config, secrets, roles, sessions: new SetupSessionStore(), fetchFn })
    const result = await service.manual(undefined, {
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'a-secret',
    })
    expect(result.warning).toBe('secret not stored, this deployment reads AZURE_CLIENT_SECRET from the environment')
    expect(secrets.setSecret).not.toHaveBeenCalled()
    expect(updateDomain).toHaveBeenCalledWith('auth', { tenantId: 'tenant-1', clientId: 'client-1' })
  })

  it('with authenticated session -> seeds signer oid into admin and portal-admin', async () => {
    const { config } = makeConfig()
    const { roles, store } = makeRoles()
    const secrets = makeSecrets(false)
    const sessions = new SetupSessionStore()
    const session = sessions.start('dc-1', 5)
    session.user = { oid: 'oid-signer', tid: 'tenant-1' }
    const fetchFn = makeFetch({
      'GET https://login.microsoftonline.com/tenant-1/v2.0/.well-known/openid-configuration': jsonResponse(200, {}),
    })
    const service = new SetupService({ config, secrets, roles, sessions, fetchFn })
    await service.manual(session.token, { tenantId: 'tenant-1', clientId: 'client-1' })
    expect(store.get('admin')?.members.users).toContain('oid-signer')
    expect(store.get('portal-admin')?.members.users).toContain('oid-signer')
  })
})
