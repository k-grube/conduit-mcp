import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reportTools } from './reports.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const getReport = reportTools.find((t) => t.name === 'qbo_get_report')!

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

describe('qbo_get_report validation', () => {
  it('rejects summarize_by values not allowed for the report', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await getReport.handler({ report_name: 'AgedReceivables', summarize_by: 'Month' }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_summarize_by' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('requires date_from and date_to for GeneralLedger', async () => {
    const ctx = connectedCtx()
    await seedQboClient(ctx, vi.fn())

    const result = await getReport.handler({ report_name: 'GeneralLedger' }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'missing_date_range' })
  })

  it('returns report_range_too_large when GeneralLedger spans more than 31 days', async () => {
    const ctx = connectedCtx()
    await seedQboClient(ctx, vi.fn())

    const result = await getReport.handler(
      { report_name: 'GeneralLedger', date_from: '2026-01-01', date_to: '2026-03-01' },
      ctx,
    )

    expect(result).toEqual({
      error: 'report_range_too_large',
      message: expect.stringContaining('31 days'),
    })
  })
})

describe('qbo_get_report success', () => {
  it('sends as_of_date for point-in-time reports instead of start_date/end_date', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(JSON.stringify({ Rows: {} }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    await getReport.handler({ report_name: 'BalanceSheet', as_of: '2026-01-31' }, ctx)

    expect(capturedUrl).toContain('reports/BalanceSheet')
    expect(capturedUrl).toContain('as_of_date=2026-01-31')
    expect(capturedUrl).not.toContain('start_date')
  })

  it('sends start_date/end_date for range reports', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      capturedUrl = String(url)
      return new Response(JSON.stringify({ Rows: {} }), { status: 200 })
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    await getReport.handler({ report_name: 'ProfitAndLoss', date_from: '2026-01-01', date_to: '2026-01-31' }, ctx)

    expect(capturedUrl).toContain('start_date=2026-01-01')
    expect(capturedUrl).toContain('end_date=2026-01-31')
  })
})
