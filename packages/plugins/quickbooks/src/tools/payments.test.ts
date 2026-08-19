import { describe, expect, it, vi, beforeEach } from 'vitest'
import { paymentTools } from './payments.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listPayments = paymentTools.find((t) => t.name === 'qbo_list_payments')!
const getPayment = paymentTools.find((t) => t.name === 'qbo_get_payment')!

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

describe('qbo_list_payments', () => {
  it('rejects a malformed date_to without calling QBO', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await listPayments.handler({ page: 1, page_size: 25, date_to: 'not-a-date' }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_date' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps payments to camelCase and adds a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({
          QueryResponse: { Payment: [{ Id: '5', TotalAmt: 100, UnappliedAmt: 25 }] },
        }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listPayments.handler({ page: 1, page_size: 25 }, ctx)) as {
      payments: Array<Record<string, unknown>>
      hasMore: boolean
    }

    expect(result.payments[0]).toMatchObject({
      id: '5',
      totalAmt: 100,
      unappliedAmt: 25,
      url: 'https://sandbox.qbo.intuit.com/app/recvpayment?txnId=5',
    })
  })
})

describe('qbo_get_payment', () => {
  it('returns the raw payment with a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ Payment: { Id: '9' } }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getPayment.handler({ payment_id: '9' }, ctx)

    expect(result).toMatchObject({ Id: '9', url: expect.stringContaining('txnId=9') })
  })
})
