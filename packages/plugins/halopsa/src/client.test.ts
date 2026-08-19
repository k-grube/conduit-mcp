import { describe, expect, it, vi } from 'vitest'
import { HaloPSAClient, getClient, resetClient } from './client.js'
import { fakeCtx } from './test-helpers.js'

const tokenUrl = 'https://acme.halopsa.com/auth/token'

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function newClient(fetchFn: typeof fetch, opts: { scope?: string; tenant?: string } = {}) {
  return new HaloPSAClient({
    companyUrl: 'https://acme.halopsa.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    scope: opts.scope ?? 'all',
    tenant: opts.tenant,
    fetchFn,
  })
}

describe('HaloPSAClient auth', () => {
  it('requests a token from {companyUrl}/auth/token with client-credentials grant and scope', async () => {
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ tickets: [] })
    })
    const client = newClient(fetchFn)

    await client.getTickets()

    expect(capturedBody).toContain('grant_type=client_credentials')
    expect(capturedBody).toContain('client_id=client-id')
    expect(capturedBody).toContain('scope=all')
    expect(capturedBody).not.toContain('tenant=')
  })

  it('appends the tenant extraParam to the token request when configured', async () => {
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ tickets: [] })
    })
    const client = newClient(fetchFn, { tenant: 'acme-tenant' })

    await client.getTickets()

    expect(capturedBody).toContain('tenant=acme-tenant')
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
      return jsonResponse({ tickets: [] })
    })
    const client = newClient(fetchFn)

    await client.getTickets()
    await client.getTickets()

    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(3)
  })
})

describe('HaloPSAClient PAGINATE_DEFAULTS', () => {
  const listMethods: Array<[string, (c: HaloPSAClient) => Promise<unknown>]> = [
    ['getTickets', (c) => c.getTickets()],
    ['getClients', (c) => c.getClients()],
    ['getUsers', (c) => c.getUsers()],
    ['getAssets', (c) => c.getAssets()],
    ['getQuotations', (c) => c.getQuotations()],
    ['getContracts', (c) => c.getContracts()],
    ['getRecurringInvoices', (c) => c.getRecurringInvoices()],
    ['getSoftwareLicences', (c) => c.getSoftwareLicences()],
  ]

  it.each(listMethods)('%s always sends pageinate=true and page_no=1 by default', async (_name, call) => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return jsonResponse({})
    })
    const client = newClient(fetchFn)

    await call(client)

    const url = new URL(capturedUrl!)
    expect(url.searchParams.get('pageinate')).toBe('true')
    expect(url.searchParams.get('page_no')).toBe('1')
  })

  it('caller-supplied page_no overrides the default', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return jsonResponse({})
    })
    const client = newClient(fetchFn)

    await client.getTickets({ page_no: 3 })

    const url = new URL(capturedUrl!)
    expect(url.searchParams.get('page_no')).toBe('3')
  })
})

describe('HaloPSAClient executeQuery', () => {
  it('POSTs to /report with _loadreportonly:true and the sql text', async () => {
    let capturedUrl: string | undefined
    let capturedBody: unknown
    let capturedSignal: AbortSignal | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      capturedSignal = init?.signal ?? undefined
      return jsonResponse({ report: { loaded: true, rows: [] } })
    })
    const client = newClient(fetchFn)

    await client.executeQuery('SELECT 1 AS n')

    expect(capturedUrl).toBe('https://acme.halopsa.com/api/report')
    expect(capturedBody).toEqual([{ id: -1, _loadreportonly: true, sql: 'SELECT 1 AS n' }])
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })

  it('executeQuery posts an array of statements one at a time, in order', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      const sql = JSON.parse(String(init?.body))[0].sql as string
      if (sql === 'SELECT 1 AS a') {
        return jsonResponse({ report: { rows: [{ a: 1 }] } })
      }
      return jsonResponse({ report: { rows: [{ b: 2 }] } })
    })
    const client = newClient(fetchFn)

    const result = await client.executeQuery(['SELECT 1 AS a', 'SELECT 2 AS b'])

    const reportCalls = fetchFn.mock.calls.filter((c) => String(c[0]).includes('/report'))
    expect(reportCalls.length).toBe(2)
    expect(JSON.parse(String(reportCalls[0][1]?.body))).toEqual([
      { id: -1, _loadreportonly: true, sql: 'SELECT 1 AS a' },
    ])
    expect(JSON.parse(String(reportCalls[1][1]?.body))).toEqual([
      { id: -1, _loadreportonly: true, sql: 'SELECT 2 AS b' },
    ])
    expect(result).toEqual([{ report: { rows: [{ a: 1 }] } }, { report: { rows: [{ b: 2 }] } }])
  })
})

describe('getClient config resolution', () => {
  it('defaults scope to all when oauthScope is unset', async () => {
    resetClient()
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ tickets: [] })
    })
    const ctx = fakeCtx({ config: { companyUrl: 'https://acme.halopsa.com', clientId: 'client-id', oauthScope: '' } })

    const client = await getClient(ctx, fetchFn)
    await client.getTickets()

    expect(capturedBody).toContain('scope=all')
  })

  it('omits the tenant extraParam when tenant is unset', async () => {
    resetClient()
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse()
      }
      return jsonResponse({ tickets: [] })
    })
    const ctx = fakeCtx({ config: { tenant: '' } })

    const client = await getClient(ctx, fetchFn)
    await client.getTickets()

    expect(capturedBody).not.toContain('tenant=')
  })

  it('throws when companyUrl or clientId is missing from config', async () => {
    resetClient()
    const ctx = fakeCtx({ config: { companyUrl: '', clientId: '' } })
    await expect(getClient(ctx)).rejects.toThrow(/missing required halopsa setting/)
  })

  it('caches the client across calls', async () => {
    resetClient()
    const ctx = fakeCtx()
    const a = await getClient(ctx)
    const b = await getClient(ctx)
    expect(a).toBe(b)
  })
})
