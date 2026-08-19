import { describe, expect, it, vi, beforeEach } from 'vitest'
import { agentTools } from './agents.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const agentAvailability = agentTools.find((t) => t.name === 'halopsa_agent_availability')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function reportResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ report: { rows } }), { status: 200 })
}

function reportFetch(rows: unknown[], sentSql: string[]): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/auth/token')) {
      return tokenResponse()
    }
    const body = JSON.parse(String(init?.body ?? '[]')) as Array<{ sql?: string }>
    if (body[0]?.sql) {
      sentSql.push(body[0].sql)
    }
    return reportResponse(rows)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_agent_availability', () => {
  it('returns a no-agents message when nobody is out', async () => {
    const ctx = fakeCtx()
    await getClient(ctx, reportFetch([], []))

    const result = (await agentAvailability.handler({}, ctx)) as { message: string; agents: unknown[] }

    expect(result.message).toMatch(/No agents/)
    expect(result.agents).toEqual([])
  })

  it('returns agents and a count when someone is out', async () => {
    const ctx = fakeCtx()
    await getClient(ctx, reportFetch([{ Uname: 'Jane', Usection: 'Tier 1', reason: 'Scheduled Absence' }], []))

    const result = (await agentAvailability.handler({}, ctx)) as { count: number; agents: unknown[] }

    expect(result.count).toBe(1)
  })

  it('omits the section filter when serviceTeams is unset', async () => {
    const sentSql: string[] = []
    const ctx = fakeCtx()
    await getClient(ctx, reportFetch([], sentSql))

    await agentAvailability.handler({}, ctx)

    expect(sentSql[0]).not.toContain('Usection IN')
  })

  it('filters by serviceTeams from config with quotes escaped', async () => {
    const sentSql: string[] = []
    const ctx = fakeCtx({ config: { serviceTeams: "Tier 1, O'Brien Team" } })
    await getClient(ctx, reportFetch([], sentSql))

    await agentAvailability.handler({}, ctx)

    expect(sentSql[0]).toContain(`u.Usection IN ('Tier 1','O''Brien Team')`)
  })

  it('accepts serviceTeams as a string array from the tags field', async () => {
    const sentSql: string[] = []
    const ctx = fakeCtx({ config: { serviceTeams: ['Tier 1', "O'Brien Team"] } })
    await getClient(ctx, reportFetch([], sentSql))

    await agentAvailability.handler({}, ctx)

    expect(sentSql[0]).toContain(`u.Usection IN ('Tier 1','O''Brien Team')`)
  })

  it('ignores non-string entries in a serviceTeams array', async () => {
    const sentSql: string[] = []
    const ctx = fakeCtx({ config: { serviceTeams: ['Tier 1', 7, null] } })
    await getClient(ctx, reportFetch([], sentSql))

    await agentAvailability.handler({}, ctx)

    expect(sentSql[0]).toContain(`u.Usection IN ('Tier 1')`)
  })
})
