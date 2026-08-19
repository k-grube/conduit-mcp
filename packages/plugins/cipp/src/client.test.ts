import { describe, expect, it, vi } from 'vitest'
import { CippClient, getClient, resetClient } from './client.js'
import { fakeCtx } from './test-helpers.js'

const tokenUrl = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token'

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function newClient(fetchFn: typeof fetch) {
  return new CippClient({
    baseUrl: 'https://cipp.example.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tenantId: 'tenant-id',
    fetchFn,
  })
}

describe('getClient eager validation', () => {
  it('throws when the client secret resolves empty', async () => {
    resetClient()
    const ctx = fakeCtx({ secrets: { CIPP_CLIENT_SECRET: '' } })
    await expect(getClient(ctx)).rejects.toThrow(/missing required cipp setting/)
  })

  it('throws when a required config value is missing', async () => {
    resetClient()
    const ctx = fakeCtx({ config: { baseUrl: '' } })
    await expect(getClient(ctx)).rejects.toThrow(/missing required cipp setting/)
  })

  it('constructs once all four settings resolve, and caches across calls', async () => {
    resetClient()
    const ctx = fakeCtx()
    const a = await getClient(ctx)
    const b = await getClient(ctx)
    expect(a).toBe(b)
  })
})

describe('CippClient auth', () => {
  it('requests a token from the tenant-scoped entra endpoint with the api://{clientId}/.default scope', async () => {
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ ok: true })
    })
    const client = newClient(fetchFn)

    await client.listConditionalAccessPolicies({ tenantFilter: 't.onmicrosoft.com' })

    expect(capturedBody).toContain('scope=api%3A%2F%2Fclient-id%2F.default')
  })

  it('sends an authorization bearer header and retries once on 401', async () => {
    let tokenCalls = 0
    let apiCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        tokenCalls++
        return tokenResponse()
      }
      apiCalls++
      if (apiCalls === 1) {
        return new Response('unauthorized', { status: 401 })
      }
      return jsonResponse({ ok: true })
    })
    const client = newClient(fetchFn)

    const result = await client.listConditionalAccessPolicies({ tenantFilter: 't.onmicrosoft.com' })

    expect(result).toEqual({ ok: true })
    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(2)
  })
})

describe('CippClient UPN resolution', () => {
  it('issues a ListUsers pre-call and resolves to the GUID when userId is a UPN', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      calls.push(u.pathname)
      if (u.pathname === '/api/ListUsers') {
        return jsonResponse([{ id: 'guid-123', userPrincipalName: 'jane@contoso.com' }])
      }
      expect(u.searchParams.get('UserID')).toBe('guid-123')
      return jsonResponse({ ok: true })
    })
    const client = newClient(fetchFn)

    await client.listUserSigninLogs({ tenantFilter: 'contoso.com', userId: 'Jane@Contoso.com' })

    expect(calls).toEqual(['/api/ListUsers', '/api/ListUserSigninLogs'])
  })

  it('skips the ListUsers pre-call when userId is already a GUID', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      calls.push(u.pathname)
      return jsonResponse({ ok: true })
    })
    const client = newClient(fetchFn)

    await client.listUserSigninLogs({ tenantFilter: 'contoso.com', userId: 'guid-abc' })

    expect(calls).toEqual(['/api/ListUserSigninLogs'])
  })

  it('throws when no user matches the UPN', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse([{ id: 'guid-1', userPrincipalName: 'someone-else@contoso.com' }])
    })
    const client = newClient(fetchFn)

    await expect(
      client.listUserSigninLogs({ tenantFilter: 'contoso.com', userId: 'jane@contoso.com' }),
    ).rejects.toThrow(/no user with UPN/)
  })
})

describe('CippClient error normalization', () => {
  it('extracts a plain-string error body', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse('something broke', 400)
    })
    const client = newClient(fetchFn)

    await expect(client.listConditionalAccessPolicies({ tenantFilter: 't' })).rejects.toThrow(
      'CIPP 400: something broke',
    )
  })

  it('joins an array-of-strings error body', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse(['bad tenant', 'bad scope'], 400)
    })
    const client = newClient(fetchFn)

    await expect(client.listConditionalAccessPolicies({ tenantFilter: 't' })).rejects.toThrow(
      'CIPP 400: bad tenant; bad scope',
    )
  })

  it('extracts message/Message/resultMessage/error keys from an object body', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse({ resultMessage: 'tenant not onboarded' }, 500)
    })
    const client = newClient(fetchFn)

    await expect(client.listConditionalAccessPolicies({ tenantFilter: 't' })).rejects.toThrow(
      'CIPP 500: tenant not onboarded',
    )
  })

  it('falls back to the raw body text when it is not JSON', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return new Response('<html>Internal Server Error</html>', { status: 500 })
    })
    const client = newClient(fetchFn)

    await expect(client.listConditionalAccessPolicies({ tenantFilter: 't' })).rejects.toThrow(
      'CIPP 500: <html>Internal Server Error</html>',
    )
  })

  it('normalizes the oauth token failure variant too, not just the api request-failed variant', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return jsonResponse({ error: 'invalid_client', error_description: 'AADSTS700016: app not found' }, 400)
      }
      return jsonResponse({ ok: true })
    })
    const client = newClient(fetchFn)

    await expect(client.listConditionalAccessPolicies({ tenantFilter: 't' })).rejects.toThrow(
      'CIPP 400: invalid_client',
    )
  })
})

describe('CippClient.getDomainHealthFull', () => {
  it('fans out the four checks in parallel', async () => {
    const inFlight: string[] = []
    let maxConcurrent = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      const action = u.searchParams.get('Action')!
      inFlight.push(action)
      maxConcurrent = Math.max(maxConcurrent, inFlight.length)
      await new Promise((r) => setTimeout(r, 5))
      inFlight.splice(inFlight.indexOf(action), 1)
      return jsonResponse({ action, ok: true })
    })
    const client = newClient(fetchFn)

    const result = await client.getDomainHealthFull('contoso.com')

    expect(maxConcurrent).toBeGreaterThan(1)
    expect(Object.keys(result).sort()).toEqual(
      ['ReadDkimRecord', 'ReadDmarcPolicy', 'ReadMxRecord', 'ReadSpfRecord'].sort(),
    )
  })

  it('embeds a per-action error and still resolves the other checks when one action fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      if (u.searchParams.get('Action') === 'ReadSpfRecord') {
        return new Response('boom', { status: 500 })
      }
      return jsonResponse({ ok: true })
    })
    const client = newClient(fetchFn)

    const result = await client.getDomainHealthFull('contoso.com')

    expect(result.ReadSpfRecord).toEqual({ error: 'Failed to fetch ReadSpfRecord' })
    expect(result.ReadMxRecord).toEqual({ ok: true })
  })
})
