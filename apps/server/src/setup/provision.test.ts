import { describe, expect, it, vi } from 'vitest'
import { SetupSessionStore } from './session.js'
import type { SetupSession } from './session.js'
import { runProvision } from './provision.js'
import type { ProvisionDeps } from './provision.js'
import type { ConfigStore } from '../storage/config-store.js'
import type { Role } from '../storage/roles-store.js'
import type { RolesStore } from '../storage/roles-store.js'

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function makeSession(): SetupSession {
  const session = new SetupSessionStore().start('dc', 5)
  session.accessToken = 'tok'
  session.user = { oid: 'oid-1', tid: 'tid-1' }
  session.provisioning = true
  return session
}

function makeConfig() {
  const calls: { domain: string; patch: Record<string, unknown> }[] = []
  const config = {
    updateDomain: vi.fn(async (domain: string, patch: Record<string, unknown>) => {
      calls.push({ domain, patch })
    }),
  }
  return { config: config as unknown as ConfigStore, calls, updateDomain: config.updateDomain }
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
  const roles = { get, upsert } as unknown as RolesStore
  return { roles, store, get, upsert }
}

function makeSecrets(writable: boolean) {
  return {
    writable,
    setSecret: vi.fn(async () => {}),
    getSecret: vi.fn(async () => ''),
  }
}

// routes by method + url substring, matching the Task 4 graph-app test fake style
function makeFetch(overrides: Record<string, ReturnType<typeof jsonResponse>> = {}) {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${url}`

    for (const [pattern, response] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        return response
      }
    }

    if (method === 'GET' && url.includes('/applications?$filter=')) {
      return jsonResponse(200, { value: [] })
    }
    if (method === 'POST' && url.includes('/applications') && !url.includes('addPassword')) {
      return jsonResponse(201, { id: 'app-obj-1', appId: 'app-1' })
    }
    if (method === 'GET' && url.match(/\/applications\/[^/]+\?\$select=/)) {
      return jsonResponse(200, { spa: {}, web: {}, api: { oauth2PermissionScopes: [] }, requiredResourceAccess: [] })
    }
    if (method === 'PATCH' && url.includes('/applications/')) {
      return jsonResponse(204, {})
    }
    if (
      method === 'GET' &&
      url.includes('/servicePrincipals?$filter=') &&
      url.includes('00000003-0000-0000-c000-000000000000')
    ) {
      return jsonResponse(200, { value: [{ id: 'graph-sp-1' }] })
    }
    if (method === 'GET' && url.includes('/servicePrincipals?$filter=')) {
      return jsonResponse(200, { value: [] })
    }
    if (method === 'POST' && url.includes('/servicePrincipals') && !url.includes('appRoleAssignments')) {
      return jsonResponse(201, { id: 'sp-1' })
    }
    if (method === 'GET' && url.includes('/appRoleAssignments')) {
      return jsonResponse(200, { value: [] })
    }
    if (method === 'POST' && url.includes('/appRoleAssignments')) {
      return jsonResponse(201, {})
    }
    if (method === 'GET' && url.includes('/policies/defaultAppManagementPolicy')) {
      return jsonResponse(200, { applicationRestrictions: { passwordCredentials: [] } })
    }
    if (method === 'GET' && url.includes('/policies/appManagementPolicies')) {
      return jsonResponse(200, { value: [] })
    }
    if (method === 'POST' && url.includes('addPassword')) {
      return jsonResponse(201, { secretText: 's3cret' })
    }
    throw new Error(`unhandled fetch: ${key}`)
  }) as unknown as typeof fetch
}

function makeDeps(opts: { writable: boolean; overrides?: Record<string, ReturnType<typeof jsonResponse>> }) {
  const { config, calls, updateDomain } = makeConfig()
  const { roles, store, upsert } = makeRoles()
  const secrets = makeSecrets(opts.writable)
  const fetchFn = makeFetch(opts.overrides)
  const deps: ProvisionDeps = { config, secrets, roles, fetchFn, secretDelaysMs: [0] }
  return { deps, config, calls, updateDomain, roles, store, upsert, secrets, fetchFn }
}

describe('runProvision', () => {
  it('happy path: all steps done, config written last, token dropped', async () => {
    const session = makeSession()
    const { deps, updateDomain, upsert } = makeDeps({ writable: false })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    expect(session.steps.every((s) => s.state === 'done')).toBe(true)
    expect(session.result?.tenantId).toBe('tid-1')
    expect(session.result?.clientId).toBe('app-1')
    expect(session.provisioning).toBe(false)
    expect(session.accessToken).toBeUndefined()
    expect(updateDomain).toHaveBeenCalledTimes(1)
    expect(updateDomain).toHaveBeenCalledWith('auth', { tenantId: 'tid-1', clientId: 'app-1' })

    const updateDomainOrder = updateDomain.mock.invocationCallOrder[0]
    const upsertOrders = upsert.mock.invocationCallOrder
    for (const order of upsertOrders) {
      expect(updateDomainOrder).toBeGreaterThan(order)
    }
  })

  it('kv mode stores the secret and omits it from the result', async () => {
    const session = makeSession()
    const { deps, secrets, updateDomain } = makeDeps({ writable: true })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    expect(secrets.setSecret).toHaveBeenCalledWith('AZURE_CLIENT_SECRET', 's3cret')
    expect(session.result?.secretStored).toBe('keyvault')
    expect(session.result?.clientSecret).toBeUndefined()

    const setSecretOrder = secrets.setSecret.mock.invocationCallOrder[0]
    const updateDomainOrder = updateDomain.mock.invocationCallOrder[0]
    expect(updateDomainOrder).toBeGreaterThan(setSecretOrder)
  })

  it('env mode puts the secret in the result for one-time display', async () => {
    const session = makeSession()
    const { deps, secrets } = makeDeps({ writable: false })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    expect(session.result?.secretStored).toBe('shown')
    expect(session.result?.clientSecret).toBe('s3cret')
    expect(secrets.setSecret).not.toHaveBeenCalled()
  })

  it('consent 403 degrades: consent step done with detail, consentGranted false, chain continues', async () => {
    const session = makeSession()
    const { deps, updateDomain } = makeDeps({
      writable: false,
      overrides: {
        'POST https://graph.microsoft.com/v1.0/servicePrincipals/sp-1/appRoleAssignments': jsonResponse(403, {
          error: { code: 'Authorization_RequestDenied' },
        }),
      },
    })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    const consentStep = session.steps.find((s) => s.id === 'consent')
    expect(consentStep?.state).toBe('done')
    expect(consentStep?.detail).toBe('admin consent required, run the command shown after setup')
    expect(session.result?.consentGranted).toBe(false)
    expect(session.result?.consentCommand).toBe('az ad app permission admin-consent --id app-1')
    expect(updateDomain).toHaveBeenCalledTimes(1)
  })

  it('a step failure freezes the chain: step error, session.error set, config NOT written, token kept for retry', async () => {
    const session = makeSession()
    const { deps, updateDomain } = makeDeps({
      writable: false,
      overrides: {
        'POST https://graph.microsoft.com/v1.0/applications/app-obj-1/addPassword': jsonResponse(404, {
          error: { message: 'not found' },
        }),
      },
    })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    const secretStep = session.steps.find((s) => s.id === 'secret')
    expect(secretStep?.state).toBe('error')
    const storeStep = session.steps.find((s) => s.id === 'store')
    const adminStep = session.steps.find((s) => s.id === 'admin')
    const configStep = session.steps.find((s) => s.id === 'config')
    expect(storeStep?.state).toBe('pending')
    expect(adminStep?.state).toBe('pending')
    expect(configStep?.state).toBe('pending')
    expect(session.error).toBeTruthy()
    expect(updateDomain).not.toHaveBeenCalled()
    // kept, not dropped: POST /api/setup/provision must be able to retry against the same session
    expect(session.accessToken).toBe('tok')
    expect(session.provisioning).toBe(false)
  })

  it('graph error failure sanitizes the body out of session.error and step detail, keeps the status code', async () => {
    const session = makeSession()
    const { deps } = makeDeps({
      writable: false,
      overrides: {
        'POST https://graph.microsoft.com/v1.0/applications/app-obj-1/addPassword': jsonResponse(404, {
          error: { message: 'super secret internal detail should not leak' },
        }),
      },
    })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    const secretStep = session.steps.find((s) => s.id === 'secret')
    expect(secretStep?.detail).toBe('graph request failed (404)')
    expect(secretStep?.detail).not.toContain('super secret internal detail')
    expect(session.error).toBe('graph request failed (404)')
    expect(session.error).not.toContain('super secret internal detail')
  })

  it('seeds the signer into admin and portal-admin', async () => {
    const session = makeSession()
    const { deps, store } = makeDeps({ writable: false })

    await runProvision(session, 'conduit-mcp', 'https://conduit.example', deps)

    expect(store.get('admin')?.members.users).toContain('oid-1')
    expect(store.get('portal-admin')?.members.users).toContain('oid-1')
  })
})
