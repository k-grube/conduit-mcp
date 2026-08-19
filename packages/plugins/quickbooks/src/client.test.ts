import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getQboClient, resetQboClient, isQboError } from './client.js'
import { INTUIT_TOKEN_URL } from './oauth.js'
import { fakeCtx, fakeStore, fakeStoreWithFailingSet } from './test-helpers.js'

function tokenResponse(
  overrides: Partial<{
    access_token: string
    refresh_token: string
    expires_in: number
    x_refresh_token_expires_in: number
  }> = {},
): Response {
  return new Response(
    JSON.stringify({
      access_token: overrides.access_token ?? 'access-1',
      refresh_token: overrides.refresh_token ?? 'refresh-rotated',
      expires_in: overrides.expires_in ?? 3600,
      x_refresh_token_expires_in: overrides.x_refresh_token_expires_in ?? 8_640_000,
    }),
    { status: 200 },
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const CONNECTED_SECRETS = {
  QBO_SANDBOX_CLIENT_ID: 'client-id',
  QBO_SANDBOX_CLIENT_SECRET: 'client-secret',
  QBO_SANDBOX_REFRESH_TOKEN: 'refresh-1',
}

beforeEach(() => {
  resetQboClient()
})

describe('QboClient auth', () => {
  it('exchanges the refresh token via Basic auth + grant_type=refresh_token', async () => {
    let capturedAuth: string | undefined
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        capturedAuth = (init?.headers as Record<string, string>).authorization
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    await client.query('SELECT * FROM Customer')

    expect(capturedAuth).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`)
    expect(capturedBody).toContain('grant_type=refresh_token')
    expect(capturedBody).toContain('refresh_token=refresh-1')
  })

  it('caches the access token across calls, one token request for two api calls', async () => {
    let tokenCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        tokenCalls++
        return tokenResponse()
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    await client.query('SELECT 1')
    await client.query('SELECT 1')

    expect(tokenCalls).toBe(1)
  })

  it('forces a refresh and retries once on 401, then succeeds', async () => {
    let tokenCalls = 0
    let apiCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        tokenCalls++
        return tokenResponse()
      }
      apiCalls++
      if (apiCalls === 1) {
        return new Response('unauthorized', { status: 401 })
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.query('SELECT 1')

    expect(isQboError(result)).toBe(false)
    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(2)
  })

  it('rotation persists the new refresh token via ctx.setSecret before the access token is used', async () => {
    const setCalls: Array<[string, string]> = []
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse({ refresh_token: 'rotated-refresh' })
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const ctx = fakeCtx({
      secrets: CONNECTED_SECRETS,
      store: fakeStore({ 'state:sandbox': { realmId: '123' } }),
      setSecret: async (name, value) => {
        setCalls.push([name, value])
      },
    })
    const client = await getQboClient(ctx, fetchFn)

    await client.query('SELECT 1')

    expect(setCalls).toEqual([['QBO_SANDBOX_REFRESH_TOKEN', 'rotated-refresh']])
    const state = await ctx.store.get<{ realmId: string; refreshTokenRotatedAt: string }>('state:sandbox')
    expect(state).toMatchObject({ realmId: '123', refreshTokenRotatedAt: expect.any(String) })
  })

  it('returns kv_write_failed when persisting the rotated refresh token itself fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const ctx = fakeCtx({
      secrets: CONNECTED_SECRETS,
      store: fakeStore({ 'state:sandbox': { realmId: '123' } }),
      setSecret: async () => {
        throw new Error('secret store down')
      },
    })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.query('SELECT 1')

    expect(result).toEqual({ error: 'kv_write_failed', message: expect.stringContaining('secret store down') })
  })

  it('truncates a long store error in the kv_write_failed message', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const longError = `${'x'.repeat(50)}\n${'y'.repeat(250)}`
    const ctx = fakeCtx({
      secrets: CONNECTED_SECRETS,
      store: fakeStore({ 'state:sandbox': { realmId: '123' } }),
      setSecret: async () => {
        throw new Error(longError)
      },
    })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.query('SELECT 1')

    expect(result).toEqual({
      error: 'kv_write_failed',
      message: `Failed to persist refresh token: ${'x'.repeat(50)} ${'y'.repeat(149)}...`,
    })
  })

  it('truncates a long oauth error description in the qbo_api_error detail field', async () => {
    const longDescription = `${'a'.repeat(50)}\n${'b'.repeat(250)}`
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return jsonResponse({ error: 'server_error', error_description: longDescription }, 500)
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    const result = (await client.query('SELECT 1')) as { error: string; code?: string; detail: string }

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'server_error' })
    expect(result.detail).toBe(`${'a'.repeat(50)} ${'b'.repeat(149)}...`)
  })

  it('still returns tool data when the post-rotation bookkeeping store write fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return jsonResponse({ QueryResponse: { Customer: [] } })
    })
    const ctx = fakeCtx({
      secrets: CONNECTED_SECRETS,
      store: fakeStoreWithFailingSet('state:', { 'state:sandbox': { realmId: '123' } }),
    })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.query('SELECT 1')

    expect(isQboError(result)).toBe(false)
    expect(result).toEqual({ QueryResponse: { Customer: [] } })
  })

  it('de-dupes concurrent getToken calls into a single refresh request', async () => {
    let tokenCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        tokenCalls++
        return tokenResponse()
      }
      return jsonResponse({ QueryResponse: {} })
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    const [r1, r2] = await Promise.all([client.query('SELECT 1'), client.query('SELECT 2')])

    expect(tokenCalls).toBe(1)
    expect(isQboError(r1)).toBe(false)
    expect(isQboError(r2)).toBe(false)
  })

  it('returns not_connected when no refresh token is stored', async () => {
    const ctx = fakeCtx({
      secrets: { QBO_SANDBOX_CLIENT_ID: 'x', QBO_SANDBOX_CLIENT_SECRET: 'y' },
      store: fakeStore({ 'state:sandbox': { realmId: '123' } }),
    })
    const client = await getQboClient(ctx, vi.fn())

    const result = await client.query('SELECT 1')

    expect(result).toMatchObject({ error: 'not_connected', environment: 'sandbox' })
  })

  it('returns not_connected when realmId is missing, without attempting auth', async () => {
    const fetchFn = vi.fn()
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.query('SELECT 1')

    expect(result).toMatchObject({ error: 'not_connected' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns reauth_required when the refresh token is rejected with invalid_grant', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'Token invalid' }, 400)
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.query('SELECT 1')

    expect(result).toEqual({ error: 'reauth_required', message: expect.any(String) })
  })

  it('maps a non-2xx QBO API response to a qbo_api_error envelope with the Fault code', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return jsonResponse({ Fault: { Error: [{ code: '6000', Message: 'boom' }] } }, 400)
    })
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '123' } }) })
    const client = await getQboClient(ctx, fetchFn)

    const result = await client.get('customer/1')

    expect(result).toMatchObject({ error: 'qbo_api_error', status: 400, code: '6000' })
  })

  it('getQboClient caches a client per environment', async () => {
    const ctx = fakeCtx({ secrets: CONNECTED_SECRETS })
    const a = await getQboClient(ctx, vi.fn())
    const b = await getQboClient(ctx, vi.fn())
    expect(a).toBe(b)
  })
})
