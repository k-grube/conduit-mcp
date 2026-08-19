import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ticketWriteTools } from './ticket-writes.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const createTicket = ticketWriteTools.find((t) => t.name === 'halopsa_create_ticket')!
const addCrmNote = ticketWriteTools.find((t) => t.name === 'halopsa_add_crm_note')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_create_ticket', () => {
  it('refuses when writes are disabled', async () => {
    const ctx = fakeCtx()
    const result = (await createTicket.handler(
      { summary: 'Printer down', details: 'Lobby printer offline', client_id: 12 },
      ctx,
    )) as { error: string }
    expect(result.error).toContain('writes disabled')
  })

  it('posts a single-element array and returns the trimmed ticket', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        id: 9001,
        summary: 'Printer down',
        status_id: 1,
        status_name: 'New',
        client_id: 12,
        user_id: 34,
      })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await createTicket.handler(
      { summary: 'Printer down', details: 'Lobby printer offline', client_id: 12, user_id: 34 },
      ctx,
    )) as Record<string, unknown>

    const call = fetchFn.mock.calls.find((c) => String(c[0]).includes('/Tickets'))!
    expect(JSON.parse(String(call[1]?.body))).toEqual([
      { summary: 'Printer down', details: 'Lobby printer offline', client_id: 12, user_id: 34 },
    ])
    expect(result).toEqual({
      id: 9001,
      summary: 'Printer down',
      status_id: 1,
      status: 'New',
      client_id: 12,
      user_id: 34,
    })
  })

  it('unwraps array and {tickets} response shapes', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ tickets: [{ id: 9002, summary: 'S', status_name: 'New', client_id: 1 }] })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await createTicket.handler({ summary: 'S', details: 'D', client_id: 1 }, ctx)) as {
      id: number
    }
    expect(result.id).toBe(9002)
  })
})

describe('halopsa_add_crm_note', () => {
  it('requires exactly one scope', async () => {
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    const none = (await addCrmNote.handler({ subject: 'Call', note: 'Spoke to Dana' }, ctx)) as { error: string }
    const two = (await addCrmNote.handler(
      { subject: 'Call', note: 'Spoke to Dana', client_id: 1, user_id: 2 },
      ctx,
    )) as { error: string }
    expect(none.error).toContain('exactly one')
    expect(two.error).toContain('exactly one')
  })

  it('posts to /CRMNote and returns the trimmed note', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ actions: [{ id: 501, subject: 'Call', client_id: 12, datetime: '2026-08-13T10:00:00Z' }] })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await addCrmNote.handler(
      { subject: 'Call', note: 'Spoke to Dana about renewal', client_id: 12, timetaken: 0.25 },
      ctx,
    )) as Record<string, unknown>

    const call = fetchFn.mock.calls.find((c) => String(c[0]).includes('/CRMNote'))!
    expect(JSON.parse(String(call[1]?.body))).toEqual([
      { subject: 'Call', note: 'Spoke to Dana about renewal', client_id: 12, timetaken: 0.25 },
    ])
    expect(result).toEqual({
      id: 501,
      subject: 'Call',
      client_id: 12,
      user_id: undefined,
      site_id: undefined,
      datetime: '2026-08-13T10:00:00Z',
    })
  })

  it('refuses when writes are disabled', async () => {
    const ctx = fakeCtx()
    const result = (await addCrmNote.handler({ subject: 'Call', note: 'x', client_id: 1 }, ctx)) as {
      error: string
    }
    expect(result.error).toContain('writes disabled')
  })
})
