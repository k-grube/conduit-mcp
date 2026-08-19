import { describe, expect, it, vi, beforeEach } from 'vitest'
import { assetTools } from './assets.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listAssets = assetTools.find((t) => t.name === 'halopsa_list_assets')!
const getAsset = assetTools.find((t) => t.name === 'halopsa_get_asset')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_assets', () => {
  it('trims to ASSET_LIST_FIELDS and adds a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        page_no: 1,
        page_size: 25,
        record_count: 1,
        assets: [{ id: 1, key_field: 'PC-01', secret_field_not_allowlisted: 'x' }],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listAssets.handler({ page_size: 25, page_no: 1, includeinactive: false }, ctx)) as {
      assets: Array<Record<string, unknown>>
    }

    expect(result.assets[0].url).toContain('/assets?id=1')
    expect(result.assets[0]).not.toHaveProperty('secret_field_not_allowlisted')
  })

  it('caps an oversized page at 100 items with total_in_page/truncated markers, not a mid-json slice', async () => {
    const assets = Array.from({ length: 142 }, (_, i) => ({ id: i, key_field: `PC-${i}` }))
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ page_no: 1, page_size: 200, record_count: 142, assets })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listAssets.handler({ page_size: 200, page_no: 1, includeinactive: false }, ctx)) as {
      assets: Array<Record<string, unknown>>
      returned: number
      total_in_page: number
      truncated: boolean
    }

    expect(result.assets).toHaveLength(100)
    expect(result.returned).toBe(100)
    expect(result.total_in_page).toBe(142)
    expect(result.truncated).toBe(true)
    expect(result.assets[99].id).toBe(99)
  })
})

describe('halopsa_get_asset', () => {
  it('fetches by id and trims to detail fields', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 7, key_field: 'SRV-01', criticality: 'high' })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getAsset.handler({ id: 7, includedetails: true }, ctx)) as Record<string, unknown>

    expect(result.criticality).toBe('high')
    expect(result.url).toContain('/assets?id=7')
  })
})
