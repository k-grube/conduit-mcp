import { describe, expect, it, vi, beforeEach } from 'vitest'
import { contractTools } from './contracts.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listContracts = contractTools.find((t) => t.name === 'halopsa_list_contracts')!
const getContract = contractTools.find((t) => t.name === 'halopsa_get_contract')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_contracts', () => {
  it('delegates to executeListContracts (Live only by default)', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      const parsed = new URL(u)
      if (parsed.searchParams.get('includeinactive') === 'true') {
        return jsonResponse({ record_count: 1 })
      }
      return jsonResponse({ record_count: 1, contracts: [{ id: 1, status: 3 }] })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listContracts.handler({ page_size: 50, page_no: 1, include_inactive: false }, ctx)) as {
      contracts: unknown[]
    }

    expect(result.contracts).toHaveLength(1)
  })
})

describe('halopsa_get_contract', () => {
  it('fetches by id and adds a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 9, ref: 'C-9' })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getContract.handler({ id: 9 }, ctx)) as Record<string, unknown>

    expect(result.url).toContain('/contract?contractid=9')
  })
})
