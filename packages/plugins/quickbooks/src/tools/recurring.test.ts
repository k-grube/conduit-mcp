import { describe, expect, it, vi, beforeEach } from 'vitest'
import { recurringTools } from './recurring.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listRecurring = recurringTools.find((t) => t.name === 'qbo_list_recurring_transactions')!
const getRecurring = recurringTools.find((t) => t.name === 'qbo_get_recurring_transaction')!

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

function listResponse(): Response {
  return new Response(
    JSON.stringify({
      QueryResponse: {
        RecurringTransaction: [
          {
            Bill: {
              Id: '1',
              TotalAmt: 50,
              RecurringInfo: { Name: 'Rent', Active: true, ScheduleInfo: { IntervalType: 'Monthly' } },
            },
          },
          {
            Invoice: {
              Id: '2',
              TotalAmt: 100,
              RecurringInfo: { Name: 'Retainer', Active: false, ScheduleInfo: { IntervalType: 'Monthly' } },
            },
          },
        ],
      },
    }),
    { status: 200 },
  )
}

beforeEach(() => {
  resetQboClient()
})

describe('qbo_list_recurring_transactions', () => {
  it('unwraps the one-key entity wrapper and filters to active templates by default', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return listResponse()
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listRecurring.handler({ active_only: true }, ctx)) as {
      recurringTransactions: Array<Record<string, unknown>>
    }

    expect(result.recurringTransactions).toEqual([
      expect.objectContaining({ id: '1', name: 'Rent', type: 'Bill', active: true }),
    ])
  })

  it('includes inactive templates when active_only is false, and filters by transaction_type', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return listResponse()
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listRecurring.handler({ active_only: false, transaction_type: 'Invoice' }, ctx)) as {
      recurringTransactions: Array<Record<string, unknown>>
    }

    expect(result.recurringTransactions).toEqual([expect.objectContaining({ id: '2', type: 'Invoice' })])
  })
})

describe('qbo_get_recurring_transaction', () => {
  it('returns the raw RecurringTransaction body', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(JSON.stringify({ RecurringTransaction: { Id: '7' } }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getRecurring.handler({ recurring_transaction_id: '7' }, ctx)

    expect(result).toEqual({ Id: '7' })
  })
})
