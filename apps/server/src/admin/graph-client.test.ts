import { describe, expect, it, vi } from 'vitest'
import { GraphClient } from './graph-client.js'

const secrets = { writable: false, getSecret: async () => 'shhh', setSecret: async () => {} }

function fakeFetch(userPayload: unknown = { value: [] }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    return new Response(JSON.stringify(userPayload), { status: 200 })
  })
}

describe('GraphClient', () => {
  it('fetches a token once and reuses it', async () => {
    const f = fakeFetch()
    const g = new GraphClient({ tenantId: 't', clientId: 'c' }, secrets, f as unknown as typeof fetch)
    await g.searchUsers('ke')
    await g.searchUsers('vin')
    const tokenCalls = f.mock.calls.filter((c) => String(c[0]).includes('token'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('builds the user filter and maps hits', async () => {
    const f = fakeFetch({ value: [{ id: '1', displayName: 'Kevin', userPrincipalName: 'k@x.com' }] })
    const g = new GraphClient({ tenantId: 't', clientId: 'c' }, secrets, f as unknown as typeof fetch)
    const hits = await g.searchUsers("o'brien")
    expect(hits).toEqual([{ id: '1', displayName: 'Kevin', userPrincipalName: 'k@x.com' }])
    const searchUrl = String(f.mock.calls.find((c) => String(c[0]).includes('/users'))![0])
    expect(searchUrl).toContain("o''brien")
  })

  it('builds the group filter with a group-only select', async () => {
    const f = fakeFetch({ value: [{ id: '2', displayName: 'Accounting' }] })
    const g = new GraphClient({ tenantId: 't', clientId: 'c' }, secrets, f as unknown as typeof fetch)
    const hits = await g.searchGroups('acct')
    expect(hits).toEqual([{ id: '2', displayName: 'Accounting' }])
    const searchUrl = String(f.mock.calls.find((c) => String(c[0]).includes('/groups'))![0])
    expect(searchUrl).toContain('$select=id,displayName')
    expect(searchUrl).not.toContain('userPrincipalName')
  })

  it('throws on graph errors', async () => {
    const f = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('token')
        ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
        : new Response('nope', { status: 403 }),
    )
    const g = new GraphClient({ tenantId: 't', clientId: 'c' }, secrets, f as unknown as typeof fetch)
    await expect(g.searchUsers('ke')).rejects.toThrow(/403/)
  })
})
