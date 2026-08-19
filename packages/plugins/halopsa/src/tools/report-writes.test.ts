import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reportWriteTools, dedupeTokens } from './report-writes.js'
import { queryTools } from './query.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const createReport = reportWriteTools.find((t) => t.name === 'halopsa_create_report')!
const updateReport = reportWriteTools.find((t) => t.name === 'halopsa_update_report')!
const query = queryTools.find((t) => t.name === 'halopsa_query')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  resetClient()
})

describe('write gate', () => {
  it('returns a disabled error and makes no network calls when writesEnabled is off', async () => {
    const fetchFn = vi.fn()
    const ctx = fakeCtx({ config: { writesEnabled: false } })
    await getClient(ctx, fetchFn as never)

    const result = await createReport.handler(
      { name: 'x', sql: 'SELECT Faultid FROM Faults', description: 'a report' },
      ctx,
    )

    expect(result).toEqual({ error: 'writes disabled, enable writesEnabled in halopsa plugin settings' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('dedupeTokens', () => {
  it('drops stopwords and short tokens, keeps up to 4 longest', () => {
    expect(dedupeTokens('Open Tickets Report Dashboard')).toEqual(['tickets', 'open'])
  })
})

describe('halopsa_create_report', () => {
  it('requires a non-empty description', async () => {
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, vi.fn() as never)

    const result = (await createReport.handler({ name: 'x', sql: 'SELECT 1 AS n', description: '  ' }, ctx)) as {
      error: string
    }

    expect(result.error).toContain('description is required')
  })

  it('returns a validation error when sql-guard rejects the sql', async () => {
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, vi.fn() as never)

    const result = (await createReport.handler(
      { name: 'x', sql: 'UPDATE Faults SET Status = 9', description: 'a report' },
      ctx,
    )) as { error: string }

    expect(result.error).toContain('SQL validation failed')
    expect(result.error).toContain('Only SELECT queries are allowed')
  })

  // sql-guard (shared by both tools) never checked for SELECT *; only halopsa_query's handler adds
  // that restriction on top. locks the intentional divergence so a future guard change can't
  // silently start rejecting SELECT * in report sql too, or silently start allowing it in queries.
  it('permits SELECT * in report sql, unlike halopsa_query which rejects it', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ report: { available_columns: [{ name: 'Faultid' }], rows: [] } })
    })
    const reportCtx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(reportCtx, fetchFn)

    const reportResult = (await createReport.handler(
      { name: 'x', sql: 'SELECT * FROM Faults', description: 'a report' },
      reportCtx,
    )) as { error?: string; preview?: unknown }

    expect(reportResult.error).toBeUndefined()
    expect(reportResult.preview).toBeDefined()

    resetClient()
    const queryCtx = fakeCtx()
    await getClient(queryCtx, vi.fn() as never)

    const queryResult = (await query.handler({ sql: 'SELECT * FROM Faults', maxRows: 100 }, queryCtx)) as {
      error: string
    }

    expect(queryResult.error).toBe('SELECT * is not allowed. Specify the columns you need.')
  })

  it('returns a validation error when halo reports a load_error', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ report: { load_error: 'Invalid column name Bogus' } })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await createReport.handler(
      { name: 'x', sql: 'SELECT Bogus FROM Faults', description: 'a report' },
      ctx,
    )) as { error: string }

    expect(result.error).toContain('Invalid column name Bogus')
  })

  it('previews with columns/sample, resolves the default group, then commits on matching payload', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/Lookup')) {
        return jsonResponse([{ id: 41, name: 'AI Reports' }])
      }
      if (u.endsWith('/report') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>
        if (body[0].id === -1) {
          return jsonResponse({ report: { available_columns: [{ name: 'Faultid' }], rows: [{ Faultid: 1 }] } })
        }
        return jsonResponse({ id: 7, name: body[0].name, group_id: body[0].group_id })
      }
      // GET /report search calls from findExistingReports' dedupe lookup
      return jsonResponse({ reports: [] })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true, defaultReportGroupName: 'AI Reports' } })
    await getClient(ctx, fetchFn)

    const args = { name: 'Open Tickets By Agent', sql: 'SELECT Faultid FROM Faults', description: 'ticket counts' }
    const preview = (await createReport.handler(args, ctx)) as {
      confirm_token: string
      preview: { columns: string[]; row_sample: unknown[]; group_id: number }
    }

    expect(preview.preview.columns).toEqual(['Faultid'])
    expect(preview.preview.group_id).toBe(41)

    const committed = (await createReport.handler({ ...args, confirm_token: preview.confirm_token }, ctx)) as {
      id: number
      url: string
    }

    expect(committed.id).toBe(7)
    expect(committed.url).toContain('/report?id=7')
  })

  it('rejects commit when the payload no longer matches the preview', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.endsWith('/report') && init?.method === 'POST') {
        return jsonResponse({ report: { available_columns: [], rows: [] } })
      }
      return jsonResponse({ reports: [] })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const args = { name: 'Report A', sql: 'SELECT Faultid FROM Faults', description: 'desc' }
    const preview = (await createReport.handler(args, ctx)) as { confirm_token: string }

    await expect(
      createReport.handler({ ...args, name: 'Report B', confirm_token: preview.confirm_token }, ctx),
    ).rejects.toThrow(/mismatch/)
  })
})

describe('halopsa_update_report', () => {
  it('requires at least one field to change', async () => {
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, vi.fn() as never)

    const result = (await updateReport.handler({ id: 7 }, ctx)) as { error: string }

    expect(result.error).toBe('no fields to update')
  })

  it('diffs current vs new values on preview and commits the merged payload', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/report/7')) {
        return jsonResponse({ id: 7, name: 'Old Name', group_id: 41 })
      }
      if (u.endsWith('/report') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>
        return jsonResponse({ id: 7, name: body[0].name, group_id: 41 })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const preview = (await updateReport.handler({ id: 7, name: 'New Name' }, ctx)) as {
      confirm_token: string
      preview: { changes: Record<string, { current: unknown; new: unknown }> }
    }
    expect(preview.preview.changes.name).toEqual({ current: 'Old Name', new: 'New Name' })

    const committed = (await updateReport.handler(
      { id: 7, name: 'New Name', confirm_token: preview.confirm_token },
      ctx,
    )) as { name: string }

    expect(committed.name).toBe('New Name')
  })
})
