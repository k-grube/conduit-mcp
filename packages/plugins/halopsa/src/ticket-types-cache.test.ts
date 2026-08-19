import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  getClassifiedTypes,
  resetTicketTypeCache,
  resolveTicketTypeKeyword,
  classifyTicketTypes,
} from './ticket-types-cache.js'
import { resetClient } from './client.js'
import { fakeCtx } from './test-helpers.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

const TYPES = [
  { id: 1, name: 'Incident', use: 'tickets', project_type: 0 },
  { id: 2, name: 'Master Project', use: 'projects', project_type: 1 },
  { id: 3, name: 'Project Task', use: 'projects', project_type: 0 },
  { id: 4, name: 'Sales Opportunity', use: 'opps', project_type: 0 },
]

describe('classifyTicketTypes', () => {
  it('buckets ids by use + project_type', () => {
    const classified = classifyTicketTypes(TYPES)
    expect(classified.masterIds).toEqual([2])
    expect(classified.taskIds).toEqual([3])
    expect(classified.opportunityIds).toEqual([4])
  })
})

describe('resolveTicketTypeKeyword', () => {
  const classified = classifyTicketTypes(TYPES)

  it('matches "project task" to the task bucket before the bare "project" bucket', () => {
    expect(resolveTicketTypeKeyword('project task', classified)).toEqual({ category: 'task', ids: [3] })
  })

  it('matches "project" to the master bucket', () => {
    expect(resolveTicketTypeKeyword('project', classified)).toEqual({ category: 'master', ids: [2] })
  })

  it('matches "opportunity" to the opportunity bucket', () => {
    expect(resolveTicketTypeKeyword('opportunity', classified)).toEqual({ category: 'opportunity', ids: [4] })
  })

  it('falls back to substring match against type names', () => {
    expect(resolveTicketTypeKeyword('incident', classified)).toEqual({ category: 'name', ids: [1] })
  })

  it('returns null when nothing matches', () => {
    expect(resolveTicketTypeKeyword('nonexistent', classified)).toBeNull()
  })
})

describe('getClassifiedTypes cache', () => {
  beforeEach(() => {
    resetClient()
    resetTicketTypeCache()
  })

  it('fetches ticket types once and memoizes across calls (no ttl, process-lifetime)', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse(TYPES)
    })
    const ctx = fakeCtx()
    // getClient caches per-process too, so force our fetchFn in
    const { getClient } = await import('./client.js')
    await getClient(ctx, fetchFn)

    const first = await getClassifiedTypes(ctx)
    const second = await getClassifiedTypes(ctx)

    expect(first).toBe(second)
    const typeCalls = fetchFn.mock.calls.filter(([url]) => String(url).includes('/TicketType'))
    expect(typeCalls).toHaveLength(1)
  })

  it('resetTicketTypeCache forces a refetch', async () => {
    let callCount = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/token')) {
        return tokenResponse()
      }
      callCount++
      return jsonResponse(TYPES)
    })
    const ctx = fakeCtx()
    const { getClient } = await import('./client.js')
    await getClient(ctx, fetchFn)

    await getClassifiedTypes(ctx)
    resetTicketTypeCache()
    await getClassifiedTypes(ctx)

    expect(callCount).toBe(2)
  })
})
