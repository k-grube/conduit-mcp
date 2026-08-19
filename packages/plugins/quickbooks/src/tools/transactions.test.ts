import { describe, expect, it, vi, beforeEach } from 'vitest'
import { transactionTools, flattenSections, displayToEntity, type ReportRow } from './transactions.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listTransactions = transactionTools.find((t) => t.name === 'qbo_list_transactions')!
const getTransaction = transactionTools.find((t) => t.name === 'qbo_get_transaction')!

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

describe('flattenSections', () => {
  it('carries the nearest enclosing account section down to nested Data rows', () => {
    const rows: ReportRow[] = [
      {
        type: 'Section',
        Header: { ColData: [{ value: 'Checking', id: 'acct-1' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: '2026-01-01' }] },
            {
              type: 'Section',
              Header: { ColData: [{ value: 'Sub-account' }] },
              Rows: { Row: [{ type: 'Data', ColData: [{ value: '2026-01-02' }] }] },
            },
          ],
        },
      },
    ]

    const flat = flattenSections(rows)

    expect(flat).toEqual([
      { row: rows[0].Rows!.Row![0], account: 'Checking', accountId: 'acct-1' },
      // sub-account header carries no id, so accountId is null rather than inherited from the parent
      { row: rows[0].Rows!.Row![1].Rows!.Row![0], account: 'Sub-account', accountId: null },
    ])
  })
})

describe('displayToEntity', () => {
  it('maps display labels to canonical entity names', () => {
    expect(displayToEntity('Bill Payment (Check)')).toBe('BillPayment')
    expect(displayToEntity('unknown label')).toBeNull()
  })
})

describe('qbo_list_transactions', () => {
  it('requires date_from/date_to and rejects a malformed date without calling QBO', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await listTransactions.handler({ date_from: 'bad', date_to: '2026-01-31', max_rows: 500 }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_date' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps report rows to camelCase transactions with entityType', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({
          Header: { StartPeriod: '2026-01-01', EndPeriod: '2026-01-31' },
          Columns: { Column: [{ ColType: 'tx_date' }, { ColType: 'txn_type' }, { ColType: 'subt_nat_amount' }] },
          Rows: {
            Row: [
              {
                type: 'Section',
                Header: { ColData: [{ value: 'Checking', id: 'a1' }] },
                Rows: {
                  Row: [
                    {
                      type: 'Data',
                      ColData: [{ value: '2026-01-05' }, { value: 'Invoice', id: 'txn-1' }, { value: '100.00' }],
                    },
                  ],
                },
              },
            ],
          },
        }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = (await listTransactions.handler(
      { date_from: '2026-01-01', date_to: '2026-01-31', max_rows: 500 },
      ctx,
    )) as {
      transactions: Array<Record<string, unknown>>
      hasMore: boolean
      returnedRows: number
    }

    expect(result.transactions).toEqual([
      expect.objectContaining({
        date: '2026-01-05',
        type: 'Invoice',
        entityType: 'Invoice',
        txnId: 'txn-1',
        amount: '100.00',
      }),
    ])
    expect(result.hasMore).toBe(false)
    expect(result.returnedRows).toBe(1)
  })
})

describe('qbo_get_transaction', () => {
  it('resolves the type-specific endpoint and unwraps the PascalCase entity key', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(JSON.stringify({ Bill: { Id: '55' } }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getTransaction.handler({ transaction_type: 'Bill', transaction_id: '55' }, ctx)

    expect(capturedUrl).toContain('/bill/55')
    expect(result).toMatchObject({ Id: '55', url: expect.stringContaining('/app/bill?txnId=55') })
  })
})
