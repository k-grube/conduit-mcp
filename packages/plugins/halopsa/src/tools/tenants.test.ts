import { describe, expect, it, vi, beforeEach } from 'vitest'
import { tenantTools } from './tenants.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listTenants = tenantTools.find((t) => t.name === 'halopsa_list_tenants')!
const getUserAzureId = tenantTools.find((t) => t.name === 'halopsa_get_user_azure_id')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function reportResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ report: { rows } }), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_tenants', () => {
  it('filters by client_id when provided', async () => {
    let capturedSql: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      capturedSql = String(JSON.parse(String(init?.body))[0].sql)
      return reportResponse([{ Aatareaid: 501 }])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await listTenants.handler({ client_id: 501 }, ctx)

    expect(capturedSql).toContain('Aatareaid = 501')
    expect(result).toEqual([{ Aatareaid: 501 }])
  })

  it('escapes single quotes in search', async () => {
    let capturedSql: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      capturedSql = String(JSON.parse(String(init?.body))[0].sql)
      return reportResponse([])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    await listTenants.handler({ search: "o'brien" }, ctx)

    expect(capturedSql).toContain("o''brien")
  })
})

describe('halopsa_get_user_azure_id', () => {
  it('requires email or name', async () => {
    const ctx = fakeCtx()
    await getClient(ctx, vi.fn())

    const result = await getUserAzureId.handler({}, ctx)

    expect(result).toBe('Either email or name is required.')
  })

  it('excludes inactive users by default', async () => {
    let capturedSql: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      capturedSql = String(JSON.parse(String(init?.body))[0].sql)
      return reportResponse([{ azure_oid: 'guid-1' }])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = await getUserAzureId.handler({ email: 'jane@acme.com' }, ctx)

    expect(capturedSql).toContain('AND uinactive = 0')
    expect(result).toEqual([{ azure_oid: 'guid-1' }])
  })
})
