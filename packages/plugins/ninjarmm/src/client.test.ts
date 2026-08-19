import { describe, expect, it, vi } from 'vitest'
import { NinjaClient, getClient, resetClient } from './client.js'
import { fakeCtx } from './test-helpers.js'

const tokenUrl = 'https://app.ninjarmm.com/ws/oauth/token'

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function newClient(fetchFn: typeof fetch, scope = 'monitoring') {
  return new NinjaClient({
    baseUrl: 'https://app.ninjarmm.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    scope,
    fetchFn,
  })
}

describe('NinjaClient auth', () => {
  it('requests a token from {baseUrl}/ws/oauth/token with client-credentials grant and scope', async () => {
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ id: 1 })
    })
    const client = newClient(fetchFn, 'monitoring management')

    await client.getOrganizations()

    expect(capturedBody).toContain('grant_type=client_credentials')
    expect(capturedBody).toContain('client_id=client-id')
    expect(capturedBody).toContain('scope=monitoring+management')
  })

  it('caches the token across calls and only refreshes once on 401', async () => {
    let tokenCalls = 0
    let apiCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        tokenCalls++
        return tokenResponse()
      }
      apiCalls++
      if (apiCalls === 2) {
        return new Response('unauthorized', { status: 401 })
      }
      return jsonResponse({ id: 1 })
    })
    const client = newClient(fetchFn)

    await client.getOrganizations()
    await client.getOrganizations()

    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(3)
  })
})

describe('NinjaClient cursor flattening', () => {
  it('flattens an object cursor {name, offset, count, expires} to the string cursor.name', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse({
        results: [{ id: 1 }],
        cursor: { name: 'cursor-abc', offset: 25, count: 25, expires: 123 },
      })
    })
    const client = newClient(fetchFn)

    const result = (await client.queryDeviceHealth()) as { cursor: unknown; results: unknown[] }

    expect(result.cursor).toBe('cursor-abc')
    expect(result.results).toEqual([{ id: 1 }])
  })

  it('leaves a response with no cursor field untouched', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse([{ id: 1 }])
    })
    const client = newClient(fetchFn)

    const result = await client.getOrganizations()

    expect(result).toEqual([{ id: 1 }])
  })
})

describe('NinjaClient request building', () => {
  it('sends id-scoped device requests to the expected path', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return jsonResponse({ id: 5 })
    })
    const client = newClient(fetchFn)

    await client.getDeviceById(5)

    expect(capturedUrl).toBe('https://app.ninjarmm.com/api/v2/device/5')
  })

  it('drops undefined query params and serializes the rest', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return jsonResponse([])
    })
    const client = newClient(fetchFn)

    await client.getDevices({ df: 'org = 5', after: undefined, pageSize: 50 })

    const url = new URL(capturedUrl!)
    expect(url.searchParams.get('df')).toBe('org = 5')
    expect(url.searchParams.get('pageSize')).toBe('50')
    expect(url.searchParams.has('after')).toBe(false)
  })
})

describe('getClient config resolution', () => {
  it('defaults scope to monitoring when oauthScope is unset', async () => {
    resetClient()
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse([])
    })
    const ctx = fakeCtx({ config: { baseUrl: 'https://app.ninjarmm.com', clientId: 'client-id', oauthScope: '' } })

    const client = await getClient(ctx, fetchFn)
    await client.getOrganizations()

    expect(capturedBody).toContain('scope=monitoring')
    expect(capturedBody).not.toContain('scope=monitoring+management')
  })

  it('throws when baseUrl or clientId is missing from config', async () => {
    resetClient()
    const ctx = fakeCtx({ config: { baseUrl: '' } })
    await expect(getClient(ctx)).rejects.toThrow(/missing required ninja setting/)
  })

  it('uses oauthScope when present, and caches the client across calls', async () => {
    resetClient()
    const ctx = fakeCtx()
    const a = await getClient(ctx)
    const b = await getClient(ctx)
    expect(a).toBe(b)
  })
})
