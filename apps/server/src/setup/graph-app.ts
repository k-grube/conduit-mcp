import { randomUUID } from 'node:crypto'
import { logEvent } from '../logger.js'

export const GRAPH_SP_APP_ID = '00000003-0000-0000-c000-000000000000'
export const GRAPH_ROLE_USER_READ_ALL = 'df021288-bdef-4463-88db-98f22de89214'
export const GRAPH_ROLE_GROUP_READ_ALL = '5b567255-7703-4780-807c-7be8301ae99b'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_BETA_BASE = 'https://graph.microsoft.com/beta'
const POLICY_EXEMPTION_NAME = 'conduit Exemption Policy'

export class GraphError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`graph request failed: ${status} ${body}`)
    this.name = 'GraphError'
    this.status = status
    this.body = body
  }
}

export async function graphRequest(
  token: string,
  method: string,
  url: string,
  body?: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    throw new GraphError(res.status, await res.text())
  }
  if (res.status === 204) {
    return {}
  }
  return res.json()
}

export interface EnsureAppResult {
  appObjectId: string
  clientId: string
  created: boolean
}

export async function ensureApp(
  token: string,
  displayName: string,
  fetchFn: typeof fetch = fetch,
): Promise<EnsureAppResult> {
  // odata string literal, double any single quote so a crafted displayName can't broaden the filter
  const filter = encodeURIComponent(`displayName eq '${displayName.replace(/'/g, "''")}'`)
  const existing = (await graphRequest(
    token,
    'GET',
    `${GRAPH_BASE}/applications?$filter=${filter}`,
    undefined,
    fetchFn,
  )) as {
    value: { id: string; appId: string }[]
  }
  if (existing.value.length > 0) {
    // craft FindExistingApp takes the last match
    const app = existing.value[existing.value.length - 1]
    return { appObjectId: app.id, clientId: app.appId, created: false }
  }
  const created = (await graphRequest(
    token,
    'POST',
    `${GRAPH_BASE}/applications`,
    {
      displayName,
      signInAudience: 'AzureADMyOrg',
    },
    fetchFn,
  )) as { id: string; appId: string }
  return { appObjectId: created.id, clientId: created.appId, created: true }
}

function union(current: string[] | undefined, desired: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of [...(current ?? []), ...desired]) {
    if (!seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

// consent strings ported from infra/scripts/setup-entra-app.ps1 $apiScopes (lines 146-161)
const API_SCOPE_DEFS = [
  {
    value: 'portal.access',
    adminConsentDisplayName: 'Access the conduit portal',
    adminConsentDescription: 'Allows the app to access the conduit portal on behalf of the signed-in user.',
    userConsentDisplayName: 'Access the conduit portal on your behalf',
    userConsentDescription: 'Allows the app to access the conduit portal on your behalf.',
  },
  {
    value: 'mcp.access',
    adminConsentDisplayName: 'Access the conduit MCP server',
    adminConsentDescription: 'Allows the app to access the conduit MCP server on behalf of the signed-in user.',
    userConsentDisplayName: 'Access the conduit MCP server on your behalf',
    userConsentDescription: 'Allows the app to access the conduit MCP server on your behalf.',
  },
]

interface OAuth2PermissionScope {
  id: string
  type: string
  value: string
  isEnabled: boolean
  adminConsentDisplayName: string
  adminConsentDescription: string
  userConsentDisplayName: string
  userConsentDescription: string
}

interface RequiredResourceAccess {
  resourceAppId: string
  resourceAccess: { id: string; type: string }[]
}

interface CurrentApp {
  spa?: { redirectUris?: string[] }
  web?: { redirectUris?: string[] }
  publicClient?: { redirectUris?: string[] }
  api?: { oauth2PermissionScopes?: OAuth2PermissionScope[] }
  requiredResourceAccess?: RequiredResourceAccess[]
}

export async function patchManifest(
  token: string,
  app: { appObjectId: string; clientId: string },
  serverUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const current = (await graphRequest(
    token,
    'GET',
    `${GRAPH_BASE}/applications/${app.appObjectId}?$select=spa,web,publicClient,api,requiredResourceAccess`,
    undefined,
    fetchFn,
  )) as CurrentApp

  const spaDesired = [...(serverUrl ? [serverUrl.replace(/\/$/, '')] : []), 'http://localhost:3000']
  const webDesired = [
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost:3000/api/mcp/auth_callback',
    'http://127.0.0.1:3000/api/mcp/auth_callback',
  ]
  // mcp cli loopback callbacks use an ephemeral port, entra ignores the port on
  // localhost (never 127.0.0.1) for the mobile/desktop platform only
  const publicDesired = ['http://localhost/callback']

  const existingScopes = current.api?.oauth2PermissionScopes ?? []
  const managedValues = new Set(API_SCOPE_DEFS.map((def) => def.value))
  const untouchedScopes = existingScopes.filter((s) => !managedValues.has(s.value))
  const managedScopes: OAuth2PermissionScope[] = API_SCOPE_DEFS.map((def) => {
    const found = existingScopes.find((s) => s.value === def.value)
    if (found) {
      return found
    }
    return {
      id: randomUUID(),
      type: 'User',
      isEnabled: true,
      ...def,
    }
  })
  const scopes: OAuth2PermissionScope[] = [...untouchedScopes, ...managedScopes]

  const otherRra = (current.requiredResourceAccess ?? []).filter((r) => r.resourceAppId !== GRAPH_SP_APP_ID)
  const existingGraphRra = (current.requiredResourceAccess ?? []).find((r) => r.resourceAppId === GRAPH_SP_APP_ID)
  const requiredRoles = [
    { id: GRAPH_ROLE_USER_READ_ALL, type: 'Role' },
    { id: GRAPH_ROLE_GROUP_READ_ALL, type: 'Role' },
  ]
  // upsert by id, existing unrelated resourceAccess entries (eg delegated User.Read) survive
  const mergedGraphAccess = [...(existingGraphRra?.resourceAccess ?? [])]
  for (const role of requiredRoles) {
    const idx = mergedGraphAccess.findIndex((r) => r.id === role.id)
    if (idx >= 0) {
      mergedGraphAccess[idx] = role
    } else {
      mergedGraphAccess.push(role)
    }
  }
  const graphRra: RequiredResourceAccess = {
    resourceAppId: GRAPH_SP_APP_ID,
    resourceAccess: mergedGraphAccess,
  }

  const patch = {
    spa: { redirectUris: union(current.spa?.redirectUris, spaDesired) },
    web: { redirectUris: union(current.web?.redirectUris, webDesired) },
    publicClient: { redirectUris: union(current.publicClient?.redirectUris, publicDesired) },
    identifierUris: [`api://${app.clientId}`],
    api: {
      requestedAccessTokenVersion: 2,
      oauth2PermissionScopes: scopes,
    },
    groupMembershipClaims: 'SecurityGroup',
    isFallbackPublicClient: true,
    requiredResourceAccess: [...otherRra, graphRra],
  }

  await graphRequest(token, 'PATCH', `${GRAPH_BASE}/applications/${app.appObjectId}`, patch, fetchFn)
}

export async function ensureServicePrincipal(
  token: string,
  clientId: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const filter = encodeURIComponent(`appId eq '${clientId}'`)
  const existing = (await graphRequest(
    token,
    'GET',
    `${GRAPH_BASE}/servicePrincipals?$filter=${filter}`,
    undefined,
    fetchFn,
  )) as {
    value: { id: string }[]
  }
  if (existing.value.length > 0) {
    return existing.value[0].id
  }
  const created = (await graphRequest(
    token,
    'POST',
    `${GRAPH_BASE}/servicePrincipals`,
    { appId: clientId },
    fetchFn,
  )) as { id: string }
  return created.id
}

export async function findGraphServicePrincipalId(token: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const filter = encodeURIComponent(`appId eq '${GRAPH_SP_APP_ID}'`)
  const result = (await graphRequest(
    token,
    'GET',
    `${GRAPH_BASE}/servicePrincipals?$filter=${filter}`,
    undefined,
    fetchFn,
  )) as { value: { id: string }[] }
  if (result.value.length === 0) {
    throw new Error('graph service principal not found')
  }
  return result.value[0].id
}

export async function grantAdminConsent(
  token: string,
  spObjectId: string,
  graphSpId: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const existing = (await graphRequest(
      token,
      'GET',
      `${GRAPH_BASE}/servicePrincipals/${spObjectId}/appRoleAssignments`,
      undefined,
      fetchFn,
    )) as { value: { appRoleId: string; resourceId: string }[] }
    const assigned = new Set(existing.value.filter((a) => a.resourceId === graphSpId).map((a) => a.appRoleId))
    const neededRoles = [GRAPH_ROLE_USER_READ_ALL, GRAPH_ROLE_GROUP_READ_ALL].filter((r) => !assigned.has(r))

    for (const appRoleId of neededRoles) {
      await graphRequest(
        token,
        'POST',
        `${GRAPH_BASE}/servicePrincipals/${spObjectId}/appRoleAssignments`,
        { principalId: spObjectId, resourceId: graphSpId, appRoleId },
        fetchFn,
      )
    }
  } catch (err) {
    if (err instanceof GraphError && err.status === 403) {
      return false
    }
    throw err
  }
  return true
}

interface AppManagementPolicyRestrictions {
  applicationRestrictions?: { passwordCredentials?: { state: string; restrictionType: string }[] }
}

// mirrors craft DefaultPolicyBlocksCredentials/PolicyBlocksCredentials, both check the same shape
function blocksCredentials(restrictions: AppManagementPolicyRestrictions): boolean {
  const creds = restrictions.applicationRestrictions?.passwordCredentials ?? []
  return creds.some(
    (c) =>
      c.state === 'enabled' &&
      (c.restrictionType === 'passwordAddition' || c.restrictionType === 'symmetricKeyAddition'),
  )
}

// port of craft EnsurePolicyExemption, simplified: no per-policy appliesTo check, just look up by name
export async function ensureCredentialPolicyExemption(
  token: string,
  app: { appObjectId: string; clientId: string },
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    const defaultPolicy = (await graphRequest(
      token,
      'GET',
      `${GRAPH_BASE}/policies/defaultAppManagementPolicy`,
      undefined,
      fetchFn,
    )) as AppManagementPolicyRestrictions
    const appPolicies = (await graphRequest(
      token,
      'GET',
      `${GRAPH_BASE}/policies/appManagementPolicies`,
      undefined,
      fetchFn,
    )) as { value: { id: string; displayName: string }[] }

    if (!blocksCredentials(defaultPolicy)) {
      return
    }

    const policyBody = {
      displayName: POLICY_EXEMPTION_NAME,
      isEnabled: true,
      restrictions: {
        passwordCredentials: [
          {
            restrictionType: 'passwordAddition',
            state: 'disabled',
            restrictForAppsCreatedAfterDateTime: '0001-01-01T00:00:00Z',
          },
          {
            restrictionType: 'symmetricKeyAddition',
            state: 'disabled',
            restrictForAppsCreatedAfterDateTime: '0001-01-01T00:00:00Z',
          },
        ],
        keyCredentials: [],
      },
    }

    const existing = appPolicies.value.find((p) => p.displayName === POLICY_EXEMPTION_NAME)
    let policyId: string
    if (existing) {
      await graphRequest(
        token,
        'PATCH',
        `${GRAPH_BASE}/policies/appManagementPolicies/${existing.id}`,
        policyBody,
        fetchFn,
      )
      policyId = existing.id
    } else {
      const created = (await graphRequest(
        token,
        'POST',
        `${GRAPH_BASE}/policies/appManagementPolicies`,
        policyBody,
        fetchFn,
      )) as { id: string }
      policyId = created.id
    }

    try {
      await graphRequest(
        token,
        'POST',
        `${GRAPH_BETA_BASE}/applications/${app.appObjectId}/appManagementPolicies/$ref`,
        { '@odata.id': `${GRAPH_BETA_BASE}/policies/appManagementPolicies/${policyId}` },
        fetchFn,
      )
    } catch (err) {
      // already assigned to the app, harmless - log for visibility, still swallow
      logEvent('setup', 'policy_assign_failed', { error: (err as Error).message })
    }
  } catch (err) {
    logEvent('setup', 'policy_exemption_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

const CREDENTIAL_SECRET_DEFAULT_DELAYS_MS = [2000, 5000, 10000, 15000, 20000, 30000]

export async function createAppSecret(
  token: string,
  appObjectId: string,
  displayName: string,
  fetchFn: typeof fetch = fetch,
  delaysMs: number[] = CREDENTIAL_SECRET_DEFAULT_DELAYS_MS,
): Promise<string> {
  const passwordBody = { passwordCredential: { displayName: `${displayName}-secret` } }

  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    try {
      const result = (await graphRequest(
        token,
        'POST',
        `${GRAPH_BASE}/applications/${appObjectId}/addPassword`,
        passwordBody,
        fetchFn,
      )) as { secretText: string }
      return result.secretText
    } catch (err) {
      const isPolicyBlocked = err instanceof GraphError && /policy|credential type not allowed/i.test(err.body)
      if (!isPolicyBlocked || attempt >= delaysMs.length - 1) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
  throw new Error('failed to create app secret after max retries')
}
