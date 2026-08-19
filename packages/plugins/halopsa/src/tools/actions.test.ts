import { describe, expect, it, vi, beforeEach } from 'vitest'
import { actionTools } from './actions.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listActions = actionTools.find((t) => t.name === 'halopsa_list_actions')!
const addAction = actionTools.find((t) => t.name === 'halopsa_add_action')!
const getOutcomes = actionTools.find((t) => t.name === 'halopsa_get_outcomes')!
const getStatuses = actionTools.find((t) => t.name === 'halopsa_get_statuses')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_actions', () => {
  it('strips html from note fields and trims to ACTION_FIELDS', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      expect(u).toContain('ticket_id=5')
      return jsonResponse({ record_count: 1, actions: [{ id: 1, note: '<p>hi</p>', secret: 'x' }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listActions.handler({ ticket_id: 5, page_size: 25, page_no: 1 }, ctx)) as {
      actions: Array<Record<string, unknown>>
    }

    expect(result.actions[0].note).toBe('hi')
    expect(result.actions[0]).not.toHaveProperty('secret')
  })

  it('caps an oversized page at 100 items with total_in_page/truncated markers, not a mid-json slice', async () => {
    const actions = Array.from({ length: 137 }, (_, i) => ({ id: i, note: `note ${i}` }))
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ record_count: 137, actions })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listActions.handler({ ticket_id: 5, page_size: 200, page_no: 1 }, ctx)) as {
      actions: Array<Record<string, unknown>>
      returned: number
      total_in_page: number
      truncated: boolean
    }

    expect(result.actions).toHaveLength(100)
    expect(result.returned).toBe(100)
    expect(result.total_in_page).toBe(137)
    expect(result.truncated).toBe(true)
    expect(result.actions[99].id).toBe(99)
  })
})

describe('halopsa_add_action write gate', () => {
  it('returns a disabled error and makes no network calls when writesEnabled is off', async () => {
    const fetchFn = vi.fn()
    const ctx = fakeCtx({ config: { writesEnabled: false } })
    await getClient(ctx, fetchFn as never)

    const result = await addAction.handler({ ticket_id: 5, note: 'hi' }, ctx)

    expect(result).toEqual({ error: 'writes disabled, enable writesEnabled in halopsa plugin settings' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('adds the action in one shot (no preview/confirm step) once writes are enabled', async () => {
    let capturedBody: unknown
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.endsWith('/Actions') && init?.method === 'POST') {
        capturedBody = JSON.parse(String(init.body))
        return jsonResponse({ id: 1, note: 'hi', outcome: 'Private Note' })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await addAction.handler({ ticket_id: 5, note: 'hi' }, ctx)) as { id: number }

    expect(result).toEqual({ id: 1, note: 'hi', outcome: 'Private Note' })
    expect(capturedBody).toEqual([{ ticket_id: 5, note: 'hi', outcome: 'Private Note' }])
  })
})

describe('halopsa_get_outcomes', () => {
  it('wraps a raw array result as {returned, items}', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse([{ id: 1, name: 'Private Note' }])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await getOutcomes.handler({}, ctx)

    expect(result).toEqual({ returned: 1, items: [{ id: 1, name: 'Private Note' }] })
  })

  it('caps an oversized raw array at 100 items with total/truncated markers', async () => {
    const outcomes = Array.from({ length: 150 }, (_, i) => ({ id: i, name: `Outcome ${i}` }))
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse(outcomes)
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getOutcomes.handler({}, ctx)) as {
      items: unknown[]
      returned: number
      total: number
      truncated: boolean
    }

    expect(result.items).toHaveLength(100)
    expect(result.returned).toBe(100)
    expect(result.total).toBe(150)
    expect(result.truncated).toBe(true)
  })
})

describe('halopsa_get_statuses', () => {
  it('wraps a raw array result as {returned, items}, requesting type=ticket', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      expect(u).toContain('type=ticket')
      return jsonResponse([{ id: 9, name: 'Open' }])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await getStatuses.handler({}, ctx)

    expect(result).toEqual({ returned: 1, items: [{ id: 9, name: 'Open' }] })
  })

  it('passes an object-shaped result (e.g. {statuses: [...]}) through unchanged, no wrapping', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ statuses: [{ id: 9, name: 'Open' }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await getStatuses.handler({}, ctx)

    expect(result).toEqual({ statuses: [{ id: 9, name: 'Open' }] })
  })
})
