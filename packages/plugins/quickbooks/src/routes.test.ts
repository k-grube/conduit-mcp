import { describe, expect, it, vi, beforeEach } from 'vitest'
import { registerRoutes } from './routes.js'
import { resetQboClient, stateKey, type QboEnvState } from './client.js'
import { signState } from './state.js'
import { INTUIT_TOKEN_URL } from './oauth.js'
import { fakeCtx, fakeStore, fakeStoreWithFailingSet } from './test-helpers.js'

type Handler = (req: unknown, res: unknown) => void | Promise<void>

function makeFakeRouter() {
  const handlers = new Map<string, Handler>()
  const router = {
    get(path: string, handler: Handler) {
      handlers.set(`GET ${path}`, handler)
    },
    post(path: string, handler: Handler) {
      handlers.set(`POST ${path}`, handler)
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { router, handlers }
}

function fakeReq(overrides: { query?: Record<string, string> } = {}) {
  return {
    query: overrides.query ?? {},
    protocol: 'https',
    baseUrl: '/api/plugins/quickbooks',
    get(name: string) {
      return name === 'host' ? 'conduit.example.test' : undefined
    },
  }
}

function fakeRes() {
  const calls: { json?: unknown; redirect?: [number, string]; status?: number } = {}
  const res = {
    status(code: number) {
      calls.status = code
      return res
    },
    json(body: unknown) {
      calls.json = body
    },
    redirect(code: number, url: string) {
      calls.redirect = [code, url]
    },
  }
  return { res, calls }
}

function tokenResponse(refreshToken = 'refresh-new'): Response {
  return new Response(
    JSON.stringify({
      access_token: 'access-1',
      refresh_token: refreshToken,
      expires_in: 3600,
      x_refresh_token_expires_in: 8_640_000,
    }),
    { status: 200 },
  )
}

const CLIENT_SECRETS = {
  QBO_SANDBOX_CLIENT_ID: 'client-id',
  QBO_SANDBOX_CLIENT_SECRET: 'client-secret',
  QBO_STATE_JWT_SECRET: 'state-secret',
}

beforeEach(() => {
  resetQboClient()
})

describe('GET /authorize', () => {
  it('returns the Intuit authorize URL as JSON with a signed state param', async () => {
    const { router, handlers } = makeFakeRouter()
    const ctx = fakeCtx({ secrets: CLIENT_SECRETS })
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /authorize')!(fakeReq(), res)

    const body = calls.json as { url: string }
    const url = new URL(body.url)
    expect(url.origin + url.pathname).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://conduit.example.test/api/plugins/quickbooks/callback')
    expect(url.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting')
    expect(url.searchParams.get('state')).toEqual(expect.any(String))
  })

  it('returns a config_error when the client id secret is missing', async () => {
    const { router, handlers } = makeFakeRouter()
    const ctx = fakeCtx({ secrets: { QBO_STATE_JWT_SECRET: 'state-secret' } })
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /authorize')!(fakeReq(), res)

    expect(calls.status).toBe(500)
    expect((calls.json as { error: { type: string } }).error.type).toBe('config_error')
  })

  it('signs a state successfully when QBO_STATE_JWT_SECRET is unset, deriving from the client secret', async () => {
    const ctx = fakeCtx({ secrets: { QBO_SANDBOX_CLIENT_ID: 'client-id', QBO_SANDBOX_CLIENT_SECRET: 'client-secret' } })
    const setSecretSpy = vi.spyOn(ctx, 'setSecret')
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /authorize')!(fakeReq(), res)

    expect(calls.status).toBeUndefined()
    expect(calls.json).toMatchObject({ url: expect.any(String) })
    // derivation never persists anything -- no bootstrap write, no cross-replica race
    expect(setSecretSpy).not.toHaveBeenCalled()
  })
})

describe('GET /callback', () => {
  it('happy path: exchanges the code, stores realmId, and redirects to status=connected', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse('refresh-new')
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const setCalls: Array<[string, string]> = []
    const ctx = fakeCtx({
      secrets: CLIENT_SECRETS,
      setSecret: async (name, value) => {
        setCalls.push([name, value])
      },
    })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx, fetchFn)

    const state = await signState(ctx, { env: 'sandbox', redirectUri: 'https://conduit.example.test/cb' })
    const { res, calls } = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: { code: 'auth-code', realmId: '999', state } }), res)

    expect(calls.redirect).toEqual([302, '/plugins/settings/?id=quickbooks&status=connected'])
    expect(setCalls).toEqual([['QBO_SANDBOX_REFRESH_TOKEN', 'refresh-new']])
    const stored = await ctx.store.get<QboEnvState>(stateKey('sandbox'))
    expect(stored).toMatchObject({ realmId: '999', connectedAt: expect.any(String) })
  })

  it('redirects to status=connected even when the post-connect bookkeeping store write fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse('refresh-new')
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const setCalls: Array<[string, string]> = []
    const ctx = fakeCtx({
      secrets: CLIENT_SECRETS,
      store: fakeStoreWithFailingSet('state:'),
      setSecret: async (name, value) => {
        setCalls.push([name, value])
      },
    })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx, fetchFn)

    const state = await signState(ctx, { env: 'sandbox', redirectUri: 'https://conduit.example.test/cb' })
    const { res, calls } = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: { code: 'auth-code', realmId: '999', state } }), res)

    expect(calls.redirect).toEqual([302, '/plugins/settings/?id=quickbooks&status=connected'])
    expect(setCalls).toEqual([['QBO_SANDBOX_REFRESH_TOKEN', 'refresh-new']])
  })

  it('redirects with a fixed kv_write_failed reason, never the store error text, when persisting the refresh token fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse('refresh-new')
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const ctx = fakeCtx({
      secrets: CLIENT_SECRETS,
      setSecret: async () => {
        throw new Error('secret store down')
      },
    })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx, fetchFn)

    const state = await signState(ctx, { env: 'sandbox', redirectUri: 'https://conduit.example.test/cb' })
    const { res, calls } = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: { code: 'auth-code', realmId: '999', state } }), res)

    const [code, url] = calls.redirect!
    expect(code).toBe(302)
    expect(url).toBe('/plugins/settings/?id=quickbooks&status=error&reason=kv_write_failed')
    expect(url).not.toContain('secret store down')
  })

  it('redirects with status=error when code/realmId/state are missing', async () => {
    const ctx = fakeCtx({ secrets: CLIENT_SECRETS })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: {} }), res)

    const [code, url] = calls.redirect!
    expect(code).toBe(302)
    expect(url).toBe('/plugins/settings/?id=quickbooks&status=error&reason=missing_params')
  })

  it('redirects with a fixed invalid_state reason when state fails verification', async () => {
    const ctx = fakeCtx({ secrets: CLIENT_SECRETS })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /callback')!(
      fakeReq({ query: { code: 'c', realmId: '1', state: 'not-a-real-token' } }),
      res,
    )

    const [code, url] = calls.redirect!
    expect(code).toBe(302)
    expect(url).toBe('/plugins/settings/?id=quickbooks&status=error&reason=invalid_state')
  })

  it('redirects with a fixed exchange_failed reason, never the provider error text, when the code exchange fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'Auth code expired or reused' }),
          { status: 400 },
        )
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })
    const ctx = fakeCtx({ secrets: CLIENT_SECRETS })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx, fetchFn)

    const state = await signState(ctx, { env: 'sandbox', redirectUri: 'https://conduit.example.test/cb' })
    const { res, calls } = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: { code: 'auth-code', realmId: '999', state } }), res)

    const [code, url] = calls.redirect!
    expect(code).toBe(302)
    expect(url).toBe('/plugins/settings/?id=quickbooks&status=error&reason=exchange_failed')
    expect(url).not.toContain('invalid_grant')
    expect(url).not.toContain('Auth code expired')
  })

  it('rejects a replayed state token on the second callback', async () => {
    const fetchFn = vi.fn(async () => tokenResponse())
    const ctx = fakeCtx({ secrets: CLIENT_SECRETS })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx, fetchFn)

    const state = await signState(ctx, { env: 'sandbox', redirectUri: 'https://conduit.example.test/cb' })
    const first = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: { code: 'c', realmId: '1', state } }), first.res)
    expect(first.calls.redirect![1]).toContain('status=connected')

    const second = fakeRes()
    await handlers.get('GET /callback')!(fakeReq({ query: { code: 'c', realmId: '1', state } }), second.res)
    expect(second.calls.redirect![1]).toContain('status=error')
  })
})

describe('GET /status', () => {
  it('reports disconnected when no state is stored', async () => {
    const ctx = fakeCtx({ secrets: CLIENT_SECRETS })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /status')!(fakeReq(), res)

    expect(calls.json).toEqual({
      environment: 'sandbox',
      connected: false,
      connectedAt: null,
      refreshTokenRotatedAt: null,
    })
  })

  it('reports connected with timestamps once state is stored', async () => {
    const ctx = fakeCtx({
      secrets: CLIENT_SECRETS,
      store: fakeStore({ 'state:sandbox': { realmId: '42', connectedAt: 't1', refreshTokenRotatedAt: 't1' } }),
    })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('GET /status')!(fakeReq(), res)

    expect(calls.json).toEqual({
      environment: 'sandbox',
      connected: true,
      connectedAt: 't1',
      refreshTokenRotatedAt: 't1',
    })
  })
})

describe('POST /disconnect', () => {
  it('clears the stored state and evicts the cached client', async () => {
    const ctx = fakeCtx({
      secrets: CLIENT_SECRETS,
      store: fakeStore({ 'state:sandbox': { realmId: '42' } }),
    })
    const { router, handlers } = makeFakeRouter()
    registerRoutes(router, ctx)

    const { res, calls } = fakeRes()
    await handlers.get('POST /disconnect')!(fakeReq(), res)

    expect(calls.json).toEqual({ ok: true, environment: 'sandbox' })
    expect(await ctx.store.get(stateKey('sandbox'))).toBeUndefined()
  })
})
