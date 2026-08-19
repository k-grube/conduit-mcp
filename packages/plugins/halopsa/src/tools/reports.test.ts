import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reportTools } from './reports.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listReports = reportTools.find((t) => t.name === 'halopsa_list_reports')!
const runReport = reportTools.find((t) => t.name === 'halopsa_run_report')!
const getReport = reportTools.find((t) => t.name === 'halopsa_get_report')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_reports', () => {
  it('maps reports with deep links via haloReportUrls', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ reports: [{ id: 5, name: 'Open Tickets', group_id: 41 }], record_count: 1 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listReports.handler({ page_size: 50, page_no: 1 }, ctx)) as {
      reports: Array<Record<string, unknown>>
    }

    expect(result.reports[0].url).toContain('/report?id=5')
    expect(result.reports[0].config_url).toContain('mainview=reportgroup&selid=41')
  })
})

describe('halopsa_run_report', () => {
  it('runs the full report and slices rows to max_rows/offset', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        id: 5,
        name: 'Open Tickets',
        available_columns: [{ name: 'Customer' }],
        report: { rows: [{ n: 1 }, { n: 2 }, { n: 3 }] },
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await runReport.handler({ id: 5, max_rows: 2, offset: 0, includedetails: false }, ctx)) as {
      report: { rows: unknown[] }
      _report_meta: { total_rows: number; truncated: boolean }
    }

    expect(result.report.rows).toEqual([{ n: 1 }, { n: 2 }])
    expect(result._report_meta).toEqual({ total_rows: 3, returned_rows: 2, offset: 0, truncated: true })
  })

  it('applies filters against the saved report sql and rejects unknown filter fields', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/report/5')) {
        return jsonResponse({ id: 5, name: 'Open Tickets', sql: 'SELECT 1', available_columns: [{ name: 'Customer' }] })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await runReport.handler(
      { id: 5, filters: [{ field: 'Nope', values: ['x'] }], max_rows: 200, offset: 0, includedetails: false },
      ctx,
    )) as { error: string; available_fields: string[] }

    expect(result.error).toContain('Nope')
    expect(result.available_fields).toEqual(['Customer'])
  })

  it('rejects a filter field containing ] even when it would otherwise match available_columns', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/report/5')) {
        return jsonResponse({
          id: 5,
          name: 'Open Tickets',
          sql: 'SELECT Customer FROM Faults',
          available_columns: [{ name: 'Customer] OR 1=1 --' }],
        })
      }
      // executeQuery POSTs to /report; must never be reached
      if (u.endsWith('/report') && init?.method === 'POST') {
        throw new Error('must not execute a query for a rejected filter field')
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await runReport.handler(
      {
        id: 5,
        filters: [{ field: 'Customer] OR 1=1 --', values: ['Acme'] }],
        max_rows: 200,
        offset: 0,
        includedetails: false,
      },
      ctx,
    )) as { error: string }

    expect(result.error).toContain('Invalid filter field(s)')
    expect(result.error).toContain(']')
  })

  it('rejects a quote-breakout filter field when the report has no available_columns to check', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/report/5')) {
        return jsonResponse({ id: 5, name: 'Open Tickets', sql: 'SELECT Customer FROM Faults' })
      }
      if (u.endsWith('/report') && init?.method === 'POST') {
        throw new Error('must not execute a query for a rejected filter field')
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await runReport.handler(
      {
        id: 5,
        filters: [{ field: "Customer'); DROP TABLE Foo;--", values: ['Acme'] }],
        max_rows: 200,
        offset: 0,
        includedetails: false,
      },
      ctx,
    )) as { error: string }

    expect(result.error).toContain('Invalid filter field(s)')
  })

  it('allows a legit field name when the report has no available_columns to check', async () => {
    let capturedQuery: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/report/5')) {
        return jsonResponse({ id: 5, name: 'Open Tickets', sql: 'SELECT Customer FROM Faults' })
      }
      if (u.endsWith('/report') && init?.method === 'POST') {
        capturedQuery = (JSON.parse(String(init.body)) as Array<{ sql: string }>)[0].sql
        return jsonResponse({ report: { rows: [{ Customer: 'Acme' }] } })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await runReport.handler(
      {
        id: 5,
        filters: [{ field: 'Customer Name', values: ['Acme'] }],
        max_rows: 200,
        offset: 0,
        includedetails: false,
      },
      ctx,
    )) as { report: { rows: unknown[] } }

    expect(capturedQuery).toContain('[Customer Name] IN (')
    expect(result.report.rows).toEqual([{ Customer: 'Acme' }])
  })

  it('wraps the saved sql and applies matching filters', async () => {
    let capturedQuery: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/report/5')) {
        return jsonResponse({ id: 5, name: 'Open Tickets', sql: 'SELECT Customer FROM Faults' })
      }
      if (u.endsWith('/report') && init?.method === 'POST') {
        capturedQuery = (JSON.parse(String(init.body)) as Array<{ sql: string }>)[0].sql
        return jsonResponse({ report: { rows: [{ Customer: 'Acme' }] } })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await runReport.handler(
      { id: 5, filters: [{ field: 'Customer', values: ['Acme'] }], max_rows: 200, offset: 0, includedetails: false },
      ctx,
    )) as { report: { rows: unknown[] } }

    expect(capturedQuery).toContain('[Customer] IN (')
    expect(result.report.rows).toEqual([{ Customer: 'Acme' }])
  })
})

describe('halopsa_get_report', () => {
  it('returns the definition with sql and loads flag, never rows', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        id: 42,
        name: 'MRR by month',
        group_name: 'Finance',
        group_id: 7,
        mainentity: 'Faults',
        sql: 'SELECT Ihid FROM Invoiceheader',
        usesdynamicsql: false,
        report: { loaded: true, rows: [{ Ihid: 1 }], table_html: '<table/>' },
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getReport.handler({ id: 42 }, ctx)) as Record<string, unknown>

    expect(result.sql).toBe('SELECT Ihid FROM Invoiceheader')
    expect(result.loads).toEqual({ loaded: true, error: null })
    expect(result.group).toBe('Finance')
    expect(result.main_entity).toBe('Faults')
    expect(JSON.stringify(result)).not.toContain('table_html')
    expect(JSON.stringify(result)).not.toContain('"rows"')
  })

  it('surfaces a broken report instead of hiding it', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        id: 43,
        name: 'Broken',
        sql: 'SELECT Nope FROM Missing',
        usesdynamicsql: true,
        report: { loaded: false, load_error: 'Invalid column name Nope' },
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getReport.handler({ id: 43 }, ctx)) as Record<string, unknown>

    expect(result.loads).toEqual({ loaded: false, error: 'Invalid column name Nope' })
    expect(result.uses_dynamic_sql).toBe(true)
    expect(result.group).toBe(null)
  })
})
