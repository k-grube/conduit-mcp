import { describe, expect, it, vi, beforeEach } from 'vitest'
import { haloLinkTools } from './halo-link.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const getCustomerForHaloClient = haloLinkTools.find((t) => t.name === 'qbo_get_customer_for_halo_client')!
const getCustomerBalanceForHaloClient = haloLinkTools.find(
  (t) => t.name === 'qbo_get_customer_balance_for_halo_client',
)!

const CONNECTED_SECRETS = {
  QBO_SANDBOX_CLIENT_ID: 'id',
  QBO_SANDBOX_CLIENT_SECRET: 'secret',
  QBO_SANDBOX_REFRESH_TOKEN: 'refresh',
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, refresh_token: 'r2' }), { status: 200 })
}

function connectedCtx(
  invokeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): ReturnType<typeof fakeCtx> {
  return fakeCtx({
    secrets: CONNECTED_SECRETS,
    store: fakeStore({ 'state:sandbox': { realmId: '9' } }),
    invokeTool,
  })
}

beforeEach(() => {
  resetQboClient()
})

describe('qbo_get_customer_for_halo_client', () => {
  it('returns halo_link_missing when ctx.invokeTool rejects (halopsa not installed / halo api error)', async () => {
    const ctx = connectedCtx(async () => {
      throw new Error('unknown tool: halopsa_get_client')
    })
    await seedQboClient(ctx, vi.fn())

    const result = await getCustomerForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({ error: 'halo_link_missing', halo_client_id: 42 })
  })

  it('returns halo_link_missing when the halo client has no accountsid', async () => {
    const ctx = connectedCtx(async () => ({ id: 42, name: 'Acme', accountsid: 0 }))
    await seedQboClient(ctx, vi.fn())

    const result = await getCustomerForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({ error: 'halo_link_missing', halo_client_id: 42 })
  })

  it('returns halo+qbo summary on success', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ Customer: { Id: '501', DisplayName: 'Acme', Balance: 10, Active: true } }), {
        status: 200,
      })
    })
    const ctx = connectedCtx(async (name, args) => {
      expect(name).toBe('halopsa_get_client')
      expect(args).toMatchObject({ id: 42 })
      return { id: 42, name: 'Acme', accountsid: 501 }
    })
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomerForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toEqual({
      halo: { id: 42, name: 'Acme' },
      qbo: { id: '501', displayName: 'Acme', balance: 10, active: true, url: expect.stringContaining('nameId=501') },
    })
  })

  it('returns halo_link_missing when the accountsid does not match any QBO customer', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    const ctx = connectedCtx(async () => ({ id: 42, name: 'Acme', accountsid: 501 }))
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomerForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({ error: 'halo_link_missing', halo_client_id: 42 })
  })

  it('returns halo_link_missing when QBO faults 610 object not found for the accountsid', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({ Fault: { Error: [{ Message: 'Object Not Found', code: '610' }], type: 'ValidationFault' } }),
        { status: 400 },
      )
    })
    const ctx = connectedCtx(async () => ({ id: 42, name: 'Acme', accountsid: 501 }))
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomerForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({
      error: 'halo_link_missing',
      halo_client_id: 42,
      message: expect.stringContaining('different QBO realm'),
    })
  })

  it('surfaces non-610 QBO faults as qbo_api_error', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ Fault: { Error: [{ Message: 'throttled', code: '3001' }] } }), {
        status: 429,
      })
    })
    const ctx = connectedCtx(async () => ({ id: 42, name: 'Acme', accountsid: 501 }))
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomerForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', status: 429, code: '3001' })
  })
})

describe('qbo_get_customer_balance_for_halo_client', () => {
  it('buckets open invoices by days overdue', async () => {
    const fixedNow = new Date('2026-06-15T00:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    try {
      const fetchFn = vi.fn(async (url: string | URL | Request) => {
        if (String(url) === INTUIT_TOKEN_URL) {
          return tokenResponse()
        }
        const u = String(url)
        if (u.includes('/customer/')) {
          return new Response(JSON.stringify({ Customer: { Id: '501', Balance: 300 } }), { status: 200 })
        }
        return new Response(
          JSON.stringify({
            QueryResponse: {
              Invoice: [
                { Id: '1', Balance: 100, DueDate: '2026-06-10' }, // 5 days overdue -> days_1_30
                { Id: '2', Balance: 200, DueDate: '2026-01-01' }, // well over 90 days -> days_over_90
              ],
            },
          }),
          { status: 200 },
        )
      })
      const ctx = connectedCtx(async () => ({ id: 42, name: 'Acme', accountsid: 501 }))
      await seedQboClient(ctx, fetchFn)

      const result = (await getCustomerBalanceForHaloClient.handler({ halo_client_id: 42 }, ctx)) as {
        aging: Record<string, number>
        openInvoices: Array<{ id: string; daysOverdue: number }>
      }

      expect(result.aging).toEqual({ current: 0, days_1_30: 100, days_31_60: 0, days_61_90: 0, days_over_90: 200 })
      expect(result.openInvoices).toEqual([
        expect.objectContaining({ id: '1', daysOverdue: 5 }),
        expect.objectContaining({ id: '2', daysOverdue: expect.any(Number) }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns halo_link_missing when QBO faults 610 object not found for the accountsid', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({ Fault: { Error: [{ Message: 'Object Not Found', code: '610' }], type: 'ValidationFault' } }),
        { status: 400 },
      )
    })
    const ctx = connectedCtx(async () => ({ id: 42, name: 'Acme', accountsid: 501 }))
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomerBalanceForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({
      error: 'halo_link_missing',
      halo_client_id: 42,
      message: expect.stringContaining('different QBO realm'),
    })
  })

  it('returns halo_link_missing without querying invoices when the halo lookup fails', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx(async () => {
      throw new Error('boom')
    })
    await seedQboClient(ctx, fetchFn)

    const result = await getCustomerBalanceForHaloClient.handler({ halo_client_id: 42 }, ctx)

    expect(result).toMatchObject({ error: 'halo_link_missing' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
