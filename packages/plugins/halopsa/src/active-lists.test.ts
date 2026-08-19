import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildFuzzyPattern,
  executeListClients,
  executeListUsers,
  executeListContracts,
  executeListRecurringInvoices,
} from './active-lists.js'
import { getClient, resetClient } from './client.js'
import { fakeCtx } from './test-helpers.js'

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('buildFuzzyPattern', () => {
  it('lowercases and joins tokens with % wildcards, punctuation-insensitive', () => {
    expect(buildFuzzyPattern('Acme & Co')).toBe('%acme%co%')
  })

  it('falls back to a plain wrapped pattern when no tokens survive', () => {
    expect(buildFuzzyPattern('---')).toBe('%---%')
  })
})

describe('executeListClients', () => {
  it('default path (active only) runs a report sql query and does not include pritech/accountmanagertech', async () => {
    const sentSql: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      const body = JSON.parse(String(init?.body))
      const sql = String(body[0].sql)
      sentSql.push(sql)
      if (sql.startsWith('SELECT COUNT')) {
        return jsonResponse({ report: { loaded: true, rows: [{ n: 2 }] } })
      }
      return jsonResponse({
        report: {
          loaded: true,
          rows: [{ id: 501, name: 'Acme', inactive: false, toplevel_id: 0 }],
        },
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await executeListClients(ctx, {})

    expect(result.active_rule).toBe('not flagged inactive')
    // CFType is a custom field, must not appear unless the type settings are configured
    expect(sentSql.join('\n')).not.toContain('CFType')
    const clients = result.clients as Record<string, unknown>[]
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({ id: 501, name: 'Acme' })
    expect(clients[0]).not.toHaveProperty('client_type')
    expect(clients[0]).not.toHaveProperty('pritech')
    expect(clients[0]).not.toHaveProperty('accountmanagertech')
  })

  it('excludes-only client type config still selects and filters CFType', async () => {
    const sentSql: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      const body = JSON.parse(String(init?.body))
      const sql = String(body[0].sql)
      sentSql.push(sql)
      if (sql.startsWith('SELECT COUNT')) {
        return jsonResponse({ report: { loaded: true, rows: [{ n: 1 }] } })
      }
      return jsonResponse({ report: { loaded: true, rows: [] } })
    })
    const ctx = fakeCtx({ config: { clientTypeExcludes: ['Prospect'] } })
    await getClient(ctx, fetchFn)

    const result = await executeListClients(ctx, {})

    const listSql = sentSql.find((s) => !s.startsWith('SELECT COUNT'))!
    expect(listSql).toContain('CFType AS client_type')
    expect(listSql).toContain(`LOWER(CFType) NOT LIKE '%prospect%'`)
    expect(listSql).not.toContain('LOWER(CFType) LIKE')
    expect(result.active_rule).toBe("not 'prospect', not flagged inactive")
  })

  it('applies CFType include/exclude filters from the client type settings', async () => {
    const sentSql: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      const body = JSON.parse(String(init?.body))
      const sql = String(body[0].sql)
      sentSql.push(sql)
      if (sql.startsWith('SELECT COUNT')) {
        return jsonResponse({ report: { loaded: true, rows: [{ n: 1 }] } })
      }
      return jsonResponse({
        report: {
          loaded: true,
          rows: [{ id: 501, name: 'Acme', inactive: false, toplevel_id: 0, client_type: 'gold tier' }],
        },
      })
    })
    const ctx = fakeCtx({ config: { clientTypeIncludes: ['Gold Tier'], clientTypeExcludes: ['Prospect'] } })
    await getClient(ctx, fetchFn)

    const result = await executeListClients(ctx, {})

    const listSql = sentSql.find((s) => !s.startsWith('SELECT COUNT'))!
    expect(listSql).toContain('CFType AS client_type')
    expect(listSql).toContain(`LOWER(CFType) LIKE '%gold tier%'`)
    expect(listSql).toContain(`LOWER(CFType) NOT LIKE '%prospect%'`)
    expect(result.active_rule).toBe("type contains 'gold tier', not 'prospect', not flagged inactive")
    const clients = result.clients as Record<string, unknown>[]
    expect(clients[0]).toMatchObject({ id: 501, client_type: 'gold tier' })
  })

  it('include_inactive:true routes to the REST endpoint and includes pritech/accountmanagertech', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      expect(String(url)).toContain('/api/Client')
      return jsonResponse({
        page_no: 1,
        page_size: 25,
        record_count: 1,
        clients: [{ id: 501, name: 'Acme', pritech: 7, accountmanagertech: 0 }],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await executeListClients(ctx, { include_inactive: true })

    const clients = result.clients as Record<string, unknown>[]
    expect(clients[0]).toMatchObject({ id: 501, pritech: 7, accountmanagertech: 0 })
    expect(result.active_rule).toBeUndefined()
  })
})

describe('executeListUsers', () => {
  it('filters out inactive and service-account users by default', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        record_count: 3,
        users: [
          { id: 1, name: 'Active User', inactive: false, isserviceaccount: false },
          { id: 2, name: 'Inactive User', inactive: true, isserviceaccount: false },
          { id: 3, name: 'Service Account', inactive: false, isserviceaccount: true },
        ],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await executeListUsers(ctx, {})

    const users = result.users as Record<string, unknown>[]
    expect(users.map((u) => u.id)).toEqual([1])
    expect(result.active_rule).toBe('not inactive, not a service account')
  })

  it('include_inactive:true keeps everyone and omits active_rule', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        record_count: 2,
        users: [
          { id: 1, name: 'Active User', inactive: false },
          { id: 2, name: 'Inactive User', inactive: true },
        ],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await executeListUsers(ctx, { include_inactive: true })

    expect((result.users as unknown[]).length).toBe(2)
    expect(result.active_rule).toBeUndefined()
  })
})

describe('executeListContracts', () => {
  it('sweeps pages, keeps only Live (status=3) contracts by default, counts expired separately', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      if (u.searchParams.get('includeinactive') === 'true') {
        return jsonResponse({ record_count: 2 })
      }
      return jsonResponse({
        record_count: 2,
        contracts: [
          { id: 1, status: 3 },
          { id: 2, status: 4 },
        ],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await executeListContracts(ctx, {})

    const contracts = result.contracts as Record<string, unknown>[]
    expect(contracts.map((c) => c.id)).toEqual([1])
    expect(result.active_count).toBe(1)
    expect(result.expired_awaiting_action).toBe(1)
  })
})

describe('executeListRecurringInvoices', () => {
  it('excludes disabled invoices by default', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        record_count: 2,
        invoices: [
          { id: 1, disabled: false },
          { id: 2, disabled: true },
        ],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await executeListRecurringInvoices(ctx, {})

    const invoices = result.invoices as Record<string, unknown>[]
    expect(invoices.map((i) => i.id)).toEqual([1])
    expect(result.active_rule).toBe('not disabled')
  })
})
