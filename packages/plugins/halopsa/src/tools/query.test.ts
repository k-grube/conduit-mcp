import { describe, expect, it, vi, beforeEach } from 'vitest'
import { queryTools, resetLiveDataCache } from './query.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const getSchema = queryTools.find((t) => t.name === 'halopsa_get_schema')!
const query = queryTools.find((t) => t.name === 'halopsa_query')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function reportFetch(rows: unknown[]) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith('/auth/token')) {
      return tokenResponse()
    }
    return jsonResponse([{ report: { rows } }])
  })
}

function sentSql(fetchFn: ReturnType<typeof vi.fn>): string {
  const call = fetchFn.mock.calls.find((c) => String(c[0]).includes('/report'))!
  return JSON.parse(String(call[1]?.body))[0].sql
}

beforeEach(() => {
  resetClient()
  resetLiveDataCache()
})

describe('halopsa_get_schema', () => {
  it('defaults to rules, tables, relationships, canon', async () => {
    const ctx = fakeCtx()

    const result = (await getSchema.handler({ section: 'rules,tables,relationships,canon' }, ctx)) as string

    expect(result).toContain('## Critical Rules')
    expect(result).toContain('## Core Tables')
    expect(result).toContain('## Key JOIN Relationships')
    expect(result).toContain('## Canonical Definitions')
    expect(result).not.toContain('## Example Queries')
  })

  it('includes canon in the default sections', async () => {
    const ctx = fakeCtx()

    const result = (await getSchema.handler({ section: 'rules,tables,relationships,canon' }, ctx)) as string

    expect(result).toContain('## Canonical Definitions')
    expect(result).toContain('Idrecurringinvoiceid < -1')
    expect(result).toContain('Fn_GetWorkingHours_datetimes')
  })

  it('section=canon returns canon alone', async () => {
    const ctx = fakeCtx()

    const result = (await getSchema.handler({ section: 'canon' }, ctx)) as string

    expect(result).toContain('## Canonical Definitions')
    expect(result).not.toContain('## Core Tables')
  })

  it('section=all includes live_data and fetches statuses/agents once, then caches', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/Status')) {
        return jsonResponse([{ id: 9, name: 'Closed' }])
      }
      if (u.includes('/Agent')) {
        return jsonResponse([{ id: 1, name: 'Alice', email: 'alice@acme.com' }])
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const first = (await getSchema.handler({ section: 'all' }, ctx)) as string
    const statusCallsAfterFirst = fetchFn.mock.calls.filter((c) => String(c[0]).includes('/Status')).length
    const second = (await getSchema.handler({ section: 'all' }, ctx)) as string
    const statusCallsAfterSecond = fetchFn.mock.calls.filter((c) => String(c[0]).includes('/Status')).length

    expect(first).toContain('Live Status IDs')
    expect(first).toContain('9: Closed')
    expect(second).toContain('Live Status IDs')
    expect(statusCallsAfterFirst).toBe(1)
    expect(statusCallsAfterSecond).toBe(1)
  })
})

describe('halopsa_get_schema discovery actions', () => {
  it('tables: filtered INFORMATION_SCHEMA query', async () => {
    const fetchFn = reportFetch([{ TABLE_NAME: 'FAULTS' }])
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSchema.handler({ section: 'rules', action: 'tables', filter: 'fault' }, ctx)) as {
      action: string
      sql: string
      row_count: number
      truncated: boolean
      rows: unknown[]
    }

    expect(sentSql(fetchFn)).toBe(
      "SELECT TOP 200 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE '%fault%' ORDER BY TABLE_NAME",
    )
    expect(result.action).toBe('tables')
    expect(result.rows).toEqual([{ TABLE_NAME: 'FAULTS' }])
    expect(result.row_count).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('returns a load_error from the report envelope', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse([{ report: { load_error: 'Invalid object name Nope' } }])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSchema.handler({ section: 'rules', action: 'tables', filter: 'nope' }, ctx)) as {
      action: string
      sql: string
      error: string
    }

    expect(result).toEqual({ action: 'tables', sql: sentSql(fetchFn), error: 'Invalid object name Nope' })
  })

  it('columns: one table', async () => {
    const fetchFn = reportFetch([{ COLUMN_NAME: 'Faultid' }])
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await getSchema.handler({ section: 'rules', action: 'columns', table: 'Faults' }, ctx)

    expect(sentSql(fetchFn)).toBe(
      "SELECT TOP 500 COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Faults' ORDER BY ORDINAL_POSITION",
    )
  })

  it('columns: search across tables needs table or filter', async () => {
    const ctx = fakeCtx()
    const result = (await getSchema.handler({ section: 'rules', action: 'columns' }, ctx)) as { error: string }
    expect(result.error).toContain('table')
  })

  it('sample: top rows with where predicate, floors a fractional top', async () => {
    const fetchFn = reportFetch([{ Dinvno: 'PC-0042' }])
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await getSchema.handler(
      { section: 'rules', action: 'sample', table: 'Device', where: "Dinvno = 'PC-0042'", top: 3.5 },
      ctx,
    )

    expect(sentSql(fetchFn)).toBe("SELECT TOP 3 * FROM Device WHERE Dinvno = 'PC-0042'")
  })

  it('sample: truncated flag when rows hit the cap', async () => {
    const fetchFn = reportFetch([{ Dinvno: 'A' }, { Dinvno: 'B' }, { Dinvno: 'C' }])
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getSchema.handler({ section: 'rules', action: 'sample', table: 'Device', top: 3 }, ctx)) as {
      row_count: number
      truncated: boolean
    }

    expect(result.row_count).toBe(3)
    expect(result.truncated).toBe(true)
  })

  it('sample: rejects a bad table identifier and a DML where', async () => {
    const ctx = fakeCtx()
    const bad = (await getSchema.handler({ section: 'rules', action: 'sample', table: 'Device; DROP' }, ctx)) as {
      error: string
    }
    const badWhere = (await getSchema.handler(
      { section: 'rules', action: 'sample', table: 'Device', where: '1=1; DELETE FROM Faults' },
      ctx,
    )) as { error: string }
    expect(bad.error).toBeTruthy()
    expect(badWhere.error).toBeTruthy()
  })
})

describe('halopsa_query', () => {
  it('rejects non-SELECT statements', async () => {
    const ctx = fakeCtx()
    const result = (await query.handler({ sql: 'UPDATE Faults SET Status = 9', maxRows: 100 }, ctx)) as {
      error: string
    }
    expect(result.error).toBe('Only SELECT queries are allowed.')
  })

  it('rejects multiple statements', async () => {
    const ctx = fakeCtx()
    const result = (await query.handler({ sql: 'SELECT 1; SELECT 2', maxRows: 100 }, ctx)) as { error: string }
    expect(result.error).toBe('Multiple statements are not allowed.')
  })

  it('rejects SELECT *', async () => {
    const ctx = fakeCtx()
    const result = (await query.handler({ sql: 'SELECT * FROM Faults', maxRows: 100 }, ctx)) as { error: string }
    expect(result.error).toBe('SELECT * is not allowed. Specify the columns you need.')
  })

  it('injects TOP N and trims the report envelope', async () => {
    let capturedBody: unknown
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ report: { rows: [{ n: 1 }], table_html: '<table>huge</table>' } })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await query.handler({ sql: 'SELECT Faultid FROM Faults', maxRows: 50 }, ctx)) as {
      report: { rows: unknown[] }
    }

    expect((capturedBody as Array<{ sql: string }>)[0].sql).toBe('SELECT TOP 50 Faultid FROM Faults')
    expect(result.report.rows).toEqual([{ n: 1 }])
    expect(result).not.toHaveProperty('table_html')
  })

  it('leaves an existing TOP clause untouched', async () => {
    let capturedBody: unknown
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ report: { rows: [] } })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await query.handler({ sql: 'SELECT TOP 10 Faultid FROM Faults', maxRows: 100 }, ctx)

    expect((capturedBody as Array<{ sql: string }>)[0].sql).toBe('SELECT TOP 10 Faultid FROM Faults')
  })

  it('accepts an array of statements and returns results in order', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      const sql = JSON.parse(String(init?.body))[0].sql as string
      if (sql.includes('1 AS a')) {
        return jsonResponse({ report: { rows: [{ a: 1 }], table_html: '<table/>' } })
      }
      return jsonResponse({ report: { rows: [{ b: 2 }], table_html: '<table/>' } })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await query.handler({ sql: ['SELECT 1 AS a', 'SELECT 2 AS b'], maxRows: 100 }, ctx)) as Array<{
      report: { rows: unknown[] }
    }>

    expect(result).toHaveLength(2)
    expect(result[0].report.rows).toEqual([{ a: 1 }])
    expect(result[1].report.rows).toEqual([{ b: 2 }])
    expect(JSON.stringify(result)).not.toContain('table_html')
  })

  it('rejects a batch when any statement fails the guard, naming the index', async () => {
    const ctx = fakeCtx()

    const result = (await query.handler({ sql: ['SELECT 1 AS a', 'DELETE FROM Faults'], maxRows: 100 }, ctx)) as {
      error: string
      statement_errors: Array<{ index: number; error: string }>
    }

    expect(result.error).toBeTruthy()
    expect(result.statement_errors).toEqual([{ index: 1, error: 'Only SELECT queries are allowed.' }])
  })

  it('rejects more than 10 statements', async () => {
    const ctx = fakeCtx()

    const result = (await query.handler(
      { sql: Array.from({ length: 11 }, (_, i) => `SELECT ${i} AS n`), maxRows: 100 },
      ctx,
    )) as { error: string }

    expect(result.error).toContain('10')
  })
})
