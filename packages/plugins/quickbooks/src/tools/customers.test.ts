import { describe, expect, it, vi, beforeEach } from 'vitest'
import { customerTools } from './customers.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listCustomers = customerTools.find((t) => t.name === 'qbo_list_customers')!
const getCustomer = customerTools.find((t) => t.name === 'qbo_get_customer')!
const searchCustomers = customerTools.find((t) => t.name === 'qbo_search_customers')!

const CONNECTED_SECRETS = {
  QBO_SANDBOX_CLIENT_ID: 'id',
  QBO_SANDBOX_CLIENT_SECRET: 'secret',
  QBO_SANDBOX_REFRESH_TOKEN: 'refresh',
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, refresh_token: 'r2' }), { status: 200 })
}

function connectedCtx(): ReturnType<typeof fakeCtx> {
  return fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '9' } }) })
}

beforeEach(() => {
  resetQboClient()
})

describe('qbo_list_customers', () => {
  it('queries active customers by default and adds a deep link url', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(
        JSON.stringify({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Acme', Balance: 12.5 }] } }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listCustomers.handler({ active_only: true, page: 1, page_size: 25 }, ctx)) as {
      customers: Array<Record<string, unknown>>
      hasMore: boolean
    }

    expect(new URL(capturedUrl!).searchParams.get('query')).toContain('WHERE Active = true')
    expect(result.customers[0]).toMatchObject({
      id: '1',
      displayName: 'Acme',
      balance: 12.5,
      url: 'https://sandbox.qbo.intuit.com/app/customerdetail?nameId=1',
    })
    expect(result.hasMore).toBe(false)
  })

  it('omits the Active filter when active_only is false', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    await listCustomers.handler({ active_only: false, page: 1, page_size: 25 }, ctx)

    expect(capturedUrl).not.toContain('Active')
  })
})

describe('qbo_get_customer', () => {
  it('fetches by id and returns the raw entity with a url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ Customer: { Id: '42', DisplayName: 'Widgets Inc' } }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomer.handler({ customer_id: '42' }, ctx)

    expect(result).toMatchObject({ Id: '42', url: expect.stringContaining('nameId=42') })
  })
})

describe('qbo_search_customers', () => {
  it('returns an empty list without calling QBO for a blank search string', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await searchCustomers.handler({ name: '   ' }, ctx)

    expect(result).toEqual({ customers: [] })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('filters case-insensitively on DisplayName or CompanyName', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({
          QueryResponse: {
            Customer: [
              { Id: '1', DisplayName: 'Acme Corp' },
              { Id: '2', DisplayName: 'Other', CompanyName: 'Acme Holdings' },
              { Id: '3', DisplayName: 'Nomatch' },
            ],
          },
        }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await searchCustomers.handler({ name: 'acme' }, ctx)) as { customers: Array<{ id: string }> }

    expect(result.customers.map((c) => c.id)).toEqual(['1', '2'])
  })
})
