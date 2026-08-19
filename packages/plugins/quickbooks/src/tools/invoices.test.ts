import { describe, expect, it, vi, beforeEach } from 'vitest'
import { invoiceTools } from './invoices.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listInvoices = invoiceTools.find((t) => t.name === 'qbo_list_invoices')!
const getInvoice = invoiceTools.find((t) => t.name === 'qbo_get_invoice')!

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

describe('qbo_list_invoices', () => {
  it('rejects a malformed date_from without calling QBO', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await listInvoices.handler({ status: 'all', page: 1, page_size: 25, date_from: '07-01-2026' }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_date' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('filters to overdue rows client-side when status=overdue, and pushes Balance>0 into the sql', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(
        JSON.stringify({
          QueryResponse: {
            Invoice: [
              { Id: '1', Balance: 0, TotalAmt: 100 },
              { Id: '2', Balance: 50, DueDate: '2000-01-01', TotalAmt: 50 },
            ],
          },
        }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listInvoices.handler({ status: 'overdue', page: 1, page_size: 25 }, ctx)) as {
      invoices: Array<{ id: string; status: string }>
    }

    expect(new URL(capturedUrl!).searchParams.get('query')).toContain("Balance > '0'")
    expect(result.invoices).toHaveLength(1)
    expect(result.invoices[0]).toMatchObject({ id: '2', status: 'overdue' })
  })

  it('marks a paid invoice with Balance=0 as status paid', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ QueryResponse: { Invoice: [{ Id: '1', Balance: 0, TotalAmt: 100 }] } }), {
        status: 200,
      })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listInvoices.handler({ status: 'all', page: 1, page_size: 25 }, ctx)) as {
      invoices: Array<{ status: string }>
    }

    expect(result.invoices[0].status).toBe('paid')
  })

  it('does not claim paid when Balance is absent', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ QueryResponse: { Invoice: [{ Id: '1', TotalAmt: 100 }] } }), {
        status: 200,
      })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listInvoices.handler({ status: 'all', page: 1, page_size: 25 }, ctx)) as {
      invoices: Array<{ status: string }>
    }

    expect(result.invoices[0].status).toBe('unknown')
  })
})

describe('qbo_get_invoice', () => {
  it('returns the raw invoice with a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ Invoice: { Id: '77' } }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getInvoice.handler({ invoice_id: '77' }, ctx)

    expect(result).toMatchObject({ Id: '77', url: expect.stringContaining('txnId=77') })
  })
})
