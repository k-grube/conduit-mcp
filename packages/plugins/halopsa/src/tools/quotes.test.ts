import { describe, expect, it, vi, beforeEach } from 'vitest'
import { quoteTools, resetClosedQuoteStatusCache } from './quotes.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listQuotes = quoteTools.find((t) => t.name === 'halopsa_list_quotes')!
const getQuote = quoteTools.find((t) => t.name === 'halopsa_get_quote')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
  resetClosedQuoteStatusCache()
})

describe('halopsa_list_quotes', () => {
  it('filters out closed quote statuses by default using the lookup 39 flag', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/api/Lookup')) {
        return jsonResponse([
          { id: 1, value3_bool: false },
          { id: 2, value3_bool: true },
        ])
      }
      return jsonResponse({
        quotations: [
          { id: 100, status: 1 },
          { id: 101, status: 2 },
        ],
        record_count: 2,
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listQuotes.handler({ page_size: 25, page_no: 1, open_only: true }, ctx)) as {
      quotations: Array<Record<string, unknown>>
      record_count: number
      returned: number
    }

    expect(result.quotations.map((q) => q.id)).toEqual([100])
    // record_count stays the api total across pages, returned is the post-filter page count
    expect(result.record_count).toBe(2)
    expect(result.returned).toBe(1)
  })

  it('skips the closed-status filter when open_only is false', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        quotations: [
          { id: 100, status: 1 },
          { id: 101, status: 2 },
        ],
        record_count: 2,
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listQuotes.handler({ page_size: 25, page_no: 1, open_only: false }, ctx)) as {
      quotations: Array<Record<string, unknown>>
    }

    expect(result.quotations).toHaveLength(2)
  })
})

describe('halopsa_get_quote', () => {
  it('fetches by id and adds the order deep link', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 55, lines: [] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getQuote.handler({ id: 55, includedetails: true }, ctx)) as Record<string, unknown>

    expect(result.url).toContain('/order?quoteid=55')
  })
})
