import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ticketTools, resetTicketCaches } from './tickets.js'
import { getClient, resetClient } from '../client.js'
import { resetTicketTypeCache } from '../ticket-types-cache.js'
import { fakeCtx } from '../test-helpers.js'

const listTickets = ticketTools.find((t) => t.name === 'halopsa_list_tickets')!
const getTicket = ticketTools.find((t) => t.name === 'halopsa_get_ticket')!
const listAttachments = ticketTools.find((t) => t.name === 'halopsa_list_attachments')!
const searchAttachments = ticketTools.find((t) => t.name === 'halopsa_search_attachments')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
  resetTicketCaches()
  resetTicketTypeCache()
})

describe('halopsa_list_tickets', () => {
  it('resolves agent_name to agent_id before listing', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Agent')) {
        return jsonResponse({ agents: [{ id: 42, name: 'Jane Smith' }] })
      }
      if (u.includes('/api/Status')) {
        return jsonResponse({ statuses: [] })
      }
      capturedUrl = u
      return jsonResponse({ tickets: [], record_count: 0 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await listTickets.handler({ agent_name: 'Jane Smith', open_only: false, page_size: 25, page_no: 1 }, ctx)

    const url = new URL(capturedUrl!)
    expect(url.searchParams.get('agent_id')).toBe('42')
  })

  it('returns a plain error string when agent_name has no match', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Agent')) {
        return jsonResponse({ agents: [] })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await listTickets.handler({ agent_name: 'Nobody', page_size: 25, page_no: 1 }, ctx)

    expect(result).toContain('No agent found matching "Nobody"')
  })

  it('applies the configured open tickets view_id when open_only is true and no status/ticket_type filter', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Status')) {
        return jsonResponse({ statuses: [] })
      }
      capturedUrl = u
      return jsonResponse({ tickets: [], record_count: 0 })
    })
    const ctx = fakeCtx({ config: { openTicketsViewId: 7 } })
    await getClient(ctx, fetchFn)

    await listTickets.handler({ page_size: 25, page_no: 1 }, ctx)

    const url = new URL(capturedUrl!)
    expect(url.searchParams.get('view_id')).toBe('7')
  })

  it('falls back to halo native open_only when no open-tickets view is configured', async () => {
    let capturedUrl: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Status')) {
        return jsonResponse({ statuses: [] })
      }
      capturedUrl = u
      return jsonResponse({ tickets: [], record_count: 0 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await listTickets.handler({ page_size: 25, page_no: 1 }, ctx)

    const url = new URL(capturedUrl!)
    expect(url.searchParams.get('open_only')).toBe('true')
    expect(url.searchParams.get('view_id')).toBeNull()
  })

  it('routes a single-match ticket_type through ticketarea_id', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/TicketType')) {
        return jsonResponse([{ id: 9, name: 'Incident', use: 'tickets', project_type: 0 }])
      }
      if (u.includes('/api/Status')) {
        return jsonResponse({ statuses: [] })
      }
      return jsonResponse({ tickets: [], record_count: 0 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listTickets.handler({ ticket_type: 'incident', page_size: 25, page_no: 1 }, ctx)) as Record<
      string,
      unknown
    >

    expect(result.tickets).toEqual([])
  })

  it('enriches status_id with status_name from the cached status map', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Status')) {
        return jsonResponse({ statuses: [{ id: 5, name: 'Open' }] })
      }
      return jsonResponse({ tickets: [{ id: 1, status_id: 5 }], record_count: 1 })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listTickets.handler({ open_only: false, page_size: 25, page_no: 1 }, ctx)) as {
      tickets: Array<Record<string, unknown>>
    }

    expect(result.tickets[0].status_name).toBe('Open')
    expect(result.tickets[0].url).toContain('/ticket?id=1')
  })
})

describe('halopsa_get_ticket', () => {
  it('fetches by id and enriches status_name', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Status')) {
        return jsonResponse({ statuses: [{ id: 5, name: 'Open' }] })
      }
      if (u.includes('/api/Lookup')) {
        return jsonResponse([])
      }
      return jsonResponse({ id: 99, status_id: 5, summary: 'Test' })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getTicket.handler({ id: 99, includedetails: true, includeactions: false }, ctx)) as Record<
      string,
      unknown
    >

    expect(result.status_name).toBe('Open')
    expect(result.url).toContain('/ticket?id=99')
  })
})

describe('halopsa_list_attachments', () => {
  it('fetches ticket attachments with ticket_id and attaches a parent url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ attachments: [{ id: 1, filename: 'a.pdf' }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listAttachments.handler({ object_type: 'ticket', object_id: 5 }, ctx)) as {
      attachments: Array<Record<string, unknown>>
      count: number
    }

    expect(result.count).toBe(1)
    expect(result.attachments[0].url).toContain('/ticket?id=5')
  })

  it('fetches both pdf and signed attachments for quotes', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      calls.push(u)
      const parsed = new URL(u)
      if (parsed.searchParams.get('type') === '50') {
        return jsonResponse({ attachments: [{ id: 1, filename: 'quote.pdf' }] })
      }
      return jsonResponse({ attachments: [{ id: 2, filename: 'signed.pdf' }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listAttachments.handler({ object_type: 'quote', object_id: 7 }, ctx)) as {
      count: number
    }

    expect(result.count).toBe(2)
  })
})

describe('halopsa_search_attachments', () => {
  it('builds a sql LIKE query and labels object types from the type column', async () => {
    let capturedSql: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      const body = JSON.parse(String(init?.body))
      capturedSql = String(body[0].sql)
      return jsonResponse({ report: { rows: [{ id: 1, filename: 'invoice.pdf', type: 8 }] } })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await searchAttachments.handler({ search: "o'reilly" }, ctx)) as {
      attachments: Array<Record<string, unknown>>
      count: number
    }

    expect(capturedSql).toContain("o''reilly")
    expect(result.attachments[0].object_type).toBe('contract')
  })
})
