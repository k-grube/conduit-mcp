import { describe, expect, it, vi } from 'vitest'
import {
  createAppSecret,
  ensureApp,
  ensureCredentialPolicyExemption,
  ensureServicePrincipal,
  findGraphServicePrincipalId,
  grantAdminConsent,
  graphRequest,
  GraphError,
  patchManifest,
} from './graph-app.js'

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('graphRequest', () => {
  it('sends bearer auth and json body, returns parsed json', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(200, { id: '1' }))
    const r = await graphRequest(
      'tok',
      'POST',
      'https://graph.microsoft.com/v1.0/applications',
      { a: 1 },
      f as unknown as typeof fetch,
    )
    expect(r).toEqual({ id: '1' })
    const [, init] = f.mock.calls[0]
    expect(init.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ a: 1 })
  })

  it('throws GraphError with status and body on failure', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'Authorization_RequestDenied' } }))
    await expect(
      graphRequest('tok', 'GET', 'https://graph.microsoft.com/v1.0/x', undefined, f as unknown as typeof fetch),
    ).rejects.toSatisfy((e: GraphError) => e.status === 403 && e.body.includes('Authorization_RequestDenied'))
  })
})

describe('ensureApp', () => {
  it('returns the existing app when the display name matches', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(200, { value: [{ id: 'obj-1', appId: 'app-1' }] }))
    const r = await ensureApp('tok', 'conduit-mcp', f as unknown as typeof fetch)
    expect(r).toEqual({ appObjectId: 'obj-1', clientId: 'app-1', created: false })
  })

  it('creates a single-tenant app when none exists', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { value: [] }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'obj-2', appId: 'app-2' }))
    const r = await ensureApp('tok', 'conduit-mcp', f as unknown as typeof fetch)
    expect(r.created).toBe(true)
    const createBody = JSON.parse(f.mock.calls[1][1].body)
    expect(createBody.signInAudience).toBe('AzureADMyOrg')
    expect(createBody.displayName).toBe('conduit-mcp')
  })
})

describe('patchManifest', () => {
  // current app state returned by the initial GET
  const current = {
    spa: { redirectUris: ['https://keep.example'] },
    web: { redirectUris: [] },
    publicClient: { redirectUris: ['https://keep-public.example'] },
    api: {
      requestedAccessTokenVersion: null,
      oauth2PermissionScopes: [
        {
          id: 'scope-id-1',
          value: 'portal.access',
          type: 'User',
          isEnabled: true,
          adminConsentDisplayName: 'x',
          adminConsentDescription: 'x',
          userConsentDisplayName: 'x',
          userConsentDescription: 'x',
        },
      ],
    },
    requiredResourceAccess: [{ resourceAppId: 'other-app', resourceAccess: [{ id: 'other-perm', type: 'Scope' }] }],
  }

  it('unions redirects, reuses scope ids, merges rra, pins manifest fields', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonResponse(200, current)).mockResolvedValueOnce(jsonResponse(204, {}))
    await patchManifest(
      'tok',
      { appObjectId: 'obj-1', clientId: 'app-1' },
      'https://conduit.example/',
      f as unknown as typeof fetch,
    )
    const patch = JSON.parse(f.mock.calls[1][1].body)
    expect(patch.spa.redirectUris).toEqual(['https://keep.example', 'https://conduit.example', 'http://localhost:3000'])
    expect(patch.web.redirectUris).toEqual([
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost:3000/api/mcp/auth_callback',
      'http://127.0.0.1:3000/api/mcp/auth_callback',
    ])
    // claude code cli loopback callback, entra ignores the port on localhost for public clients only
    expect(patch.publicClient.redirectUris).toEqual(['https://keep-public.example', 'http://localhost/callback'])
    expect(patch.identifierUris).toEqual(['api://app-1'])
    expect(patch.api.requestedAccessTokenVersion).toBe(2)
    const portal = patch.api.oauth2PermissionScopes.find((s: { value: string }) => s.value === 'portal.access')
    expect(portal.id).toBe('scope-id-1') // stable across re-runs
    const mcpScope = patch.api.oauth2PermissionScopes.find((s: { value: string }) => s.value === 'mcp.access')
    expect(mcpScope.id).toBeTruthy()
    expect(patch.groupMembershipClaims).toBe('SecurityGroup')
    expect(patch.isFallbackPublicClient).toBe(true)
    const rra = patch.requiredResourceAccess
    expect(rra.find((r: { resourceAppId: string }) => r.resourceAppId === 'other-app')).toBeTruthy()
    const graph = rra.find((r: { resourceAppId: string }) => r.resourceAppId === '00000003-0000-0000-c000-000000000000')
    expect(graph.resourceAccess).toEqual(
      expect.arrayContaining([
        { id: 'df021288-bdef-4463-88db-98f22de89214', type: 'Role' },
        { id: '5b567255-7703-4780-807c-7be8301ae99b', type: 'Role' },
      ]),
    )
  })

  it('omits serverUrl from spa redirects when undefined', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          spa: { redirectUris: [] },
          web: { redirectUris: [] },
          api: { oauth2PermissionScopes: [] },
          requiredResourceAccess: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(204, {}))
    await patchManifest('tok', { appObjectId: 'obj-1', clientId: 'app-1' }, undefined, f as unknown as typeof fetch)
    const patch = JSON.parse(f.mock.calls[1][1].body)
    expect(patch.spa.redirectUris).toEqual(['http://localhost:3000'])
    // app with no publicClient platform still gets the loopback callback
    expect(patch.publicClient.redirectUris).toEqual(['http://localhost/callback'])
  })

  it('keeps a pre-existing scope that is not portal.access/mcp.access', async () => {
    const withThirdScope = {
      ...current,
      api: {
        ...current.api,
        oauth2PermissionScopes: [
          ...current.api.oauth2PermissionScopes,
          {
            id: 'scope-id-other',
            value: 'other.scope',
            type: 'User',
            isEnabled: true,
            adminConsentDisplayName: 'y',
            adminConsentDescription: 'y',
            userConsentDisplayName: 'y',
            userConsentDescription: 'y',
          },
        ],
      },
    }
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, withThirdScope))
      .mockResolvedValueOnce(jsonResponse(204, {}))
    await patchManifest('tok', { appObjectId: 'obj-1', clientId: 'app-1' }, undefined, f as unknown as typeof fetch)
    const patch = JSON.parse(f.mock.calls[1][1].body)
    const other = patch.api.oauth2PermissionScopes.find((s: { value: string }) => s.value === 'other.scope')
    expect(other).toEqual({
      id: 'scope-id-other',
      value: 'other.scope',
      type: 'User',
      isEnabled: true,
      adminConsentDisplayName: 'y',
      adminConsentDescription: 'y',
      userConsentDisplayName: 'y',
      userConsentDescription: 'y',
    })
    expect(patch.api.oauth2PermissionScopes).toHaveLength(3)
  })

  it('merges into an existing graph resourceAccess entry instead of replacing it', async () => {
    const withExistingGraphRra = {
      ...current,
      requiredResourceAccess: [
        ...current.requiredResourceAccess,
        {
          resourceAppId: '00000003-0000-0000-c000-000000000000',
          resourceAccess: [{ id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' }], // delegated User.Read
        },
      ],
    }
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, withExistingGraphRra))
      .mockResolvedValueOnce(jsonResponse(204, {}))
    await patchManifest('tok', { appObjectId: 'obj-1', clientId: 'app-1' }, undefined, f as unknown as typeof fetch)
    const patch = JSON.parse(f.mock.calls[1][1].body)
    const graph = patch.requiredResourceAccess.find(
      (r: { resourceAppId: string }) => r.resourceAppId === '00000003-0000-0000-c000-000000000000',
    )
    expect(graph.resourceAccess).toEqual(
      expect.arrayContaining([
        { id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' },
        { id: 'df021288-bdef-4463-88db-98f22de89214', type: 'Role' },
        { id: '5b567255-7703-4780-807c-7be8301ae99b', type: 'Role' },
      ]),
    )
    expect(graph.resourceAccess).toHaveLength(3)
  })
})

describe('ensureServicePrincipal', () => {
  it('returns the existing sp id', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonResponse(200, { value: [{ id: 'sp-1' }] }))
    expect(await ensureServicePrincipal('tok', 'app-1', f as unknown as typeof fetch)).toBe('sp-1')
  })

  it('creates the sp when missing', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { value: [] }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'sp-2' }))
    expect(await ensureServicePrincipal('tok', 'app-1', f as unknown as typeof fetch)).toBe('sp-2')
  })
})

describe('findGraphServicePrincipalId', () => {
  it('returns the graph sp id', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonResponse(200, { value: [{ id: 'graph-sp-1' }] }))
    expect(await findGraphServicePrincipalId('tok', f as unknown as typeof fetch)).toBe('graph-sp-1')
  })

  it('throws when the graph sp is missing', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonResponse(200, { value: [] }))
    await expect(findGraphServicePrincipalId('tok', f as unknown as typeof fetch)).rejects.toThrow()
  })
})

describe('grantAdminConsent', () => {
  it('assigns both graph roles, skipping already-assigned ones', async () => {
    const f = vi
      .fn()
      // existing assignments: user.read.all already there
      .mockResolvedValueOnce(
        jsonResponse(200, { value: [{ appRoleId: 'df021288-bdef-4463-88db-98f22de89214', resourceId: 'graph-sp' }] }),
      )
      .mockResolvedValueOnce(jsonResponse(201, {}))
    expect(await grantAdminConsent('tok', 'sp-1', 'graph-sp', f as unknown as typeof fetch)).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
    const assignBody = JSON.parse(f.mock.calls[1][1].body)
    expect(assignBody).toEqual({
      principalId: 'sp-1',
      resourceId: 'graph-sp',
      appRoleId: '5b567255-7703-4780-807c-7be8301ae99b',
    })
  })

  it('returns false when assignment is forbidden', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { value: [] }))
      .mockResolvedValueOnce(jsonResponse(403, { error: { code: 'Authorization_RequestDenied' } }))
    expect(await grantAdminConsent('tok', 'sp-1', 'graph-sp', f as unknown as typeof fetch)).toBe(false)
  })

  it('returns false when the initial read of existing assignments is forbidden', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonResponse(403, { error: { code: 'Authorization_RequestDenied' } }))
    expect(await grantAdminConsent('tok', 'sp-1', 'graph-sp', f as unknown as typeof fetch)).toBe(false)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('ensureCredentialPolicyExemption', () => {
  it('does nothing when the default policy does not block credentials', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { applicationRestrictions: { passwordCredentials: [] } }))
      .mockResolvedValueOnce(jsonResponse(200, { value: [] }))
    await ensureCredentialPolicyExemption(
      'tok',
      { appObjectId: 'obj-1', clientId: 'app-1' },
      f as unknown as typeof fetch,
    )
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('creates and assigns an exemption policy when blocked', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          applicationRestrictions: { passwordCredentials: [{ restrictionType: 'passwordAddition', state: 'enabled' }] },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { value: [] })) // no existing policies
      .mockResolvedValueOnce(jsonResponse(201, { id: 'pol-1' })) // create policy
      .mockResolvedValueOnce(jsonResponse(204, {})) // assign $ref
    await ensureCredentialPolicyExemption(
      'tok',
      { appObjectId: 'obj-1', clientId: 'app-1' },
      f as unknown as typeof fetch,
    )
    const assignUrl = f.mock.calls[3][0]
    expect(assignUrl).toContain('/beta/applications/obj-1/appManagementPolicies/$ref')
  })

  it('swallows errors (best effort)', async () => {
    const f = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      ensureCredentialPolicyExemption('tok', { appObjectId: 'o', clientId: 'a' }, f as unknown as typeof fetch),
    ).resolves.toBeUndefined()
  })
})

describe('createAppSecret', () => {
  it('returns the secret text', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonResponse(200, { secretText: 's3cret' }))
    expect(await createAppSecret('tok', 'obj-1', 'conduit-mcp', f as unknown as typeof fetch, [0])).toBe('s3cret')
  })

  it('retries on policy-blocked addPassword then succeeds', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: 'credential type not allowed by policy' } }))
      .mockResolvedValueOnce(jsonResponse(200, { secretText: 's3cret' }))
    expect(await createAppSecret('tok', 'obj-1', 'conduit-mcp', f as unknown as typeof fetch, [0, 0])).toBe('s3cret')
  })

  it('gives up after the delay ladder is exhausted', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'blocked by policy' } }))
    await expect(createAppSecret('tok', 'obj-1', 'conduit-mcp', f as unknown as typeof fetch, [0, 0])).rejects.toThrow(
      /policy/,
    )
  })

  it('does not retry on non-policy errors', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(404, { error: { message: 'not found' } }))
    await expect(createAppSecret('tok', 'obj-1', 'x', f as unknown as typeof fetch, [0, 0])).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })
})
