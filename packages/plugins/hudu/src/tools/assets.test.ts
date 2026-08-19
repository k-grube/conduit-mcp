import { describe, expect, it, vi } from 'vitest'
import { assetTools } from './assets.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listAssets = assetTools.find((t) => t.name === 'hudu_list_assets')!
const listLayouts = assetTools.find((t) => t.name === 'hudu_list_asset_layouts')!

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('hudu_list_assets', () => {
  it('applies huduAssetUrl to items inside the assets envelope, not the envelope itself', async () => {
    resetClient()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        assets: [
          { id: 1, name: 'Adam PC', slug: 'adam-pc' },
          { id: 2, name: 'Beta Server', slug: 'beta-server' },
        ],
      }),
    )
    const ctx = fakeCtx()
    getClient(ctx, fetchFn)

    const result = (await listAssets.handler({}, ctx)) as {
      url?: string
      returned: number
      assets: Array<{ id: number; url: string }>
    }

    expect(result.url).toBeUndefined()
    expect(result.returned).toBe(2)
    expect(result.assets.map((a) => a.url)).toEqual([
      'https://hudu.example.com/a/adam-pc',
      'https://hudu.example.com/a/beta-server',
    ])
  })

  it('caps envelope items at 100 and flags truncation', async () => {
    resetClient()
    const assets = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, slug: `asset-${i + 1}` }))
    const fetchFn = vi.fn(async () => jsonResponse({ assets }))
    const ctx = fakeCtx()
    getClient(ctx, fetchFn)

    const result = (await listAssets.handler({}, ctx)) as {
      returned: number
      truncated?: boolean
      total_in_page?: number
      assets: unknown[]
    }

    expect(result.assets).toHaveLength(100)
    expect(result.returned).toBe(100)
    expect(result.truncated).toBe(true)
    expect(result.total_in_page).toBe(101)
  })
})

// representative for the envelope tools without transformItem (asset_layouts, folders, procedures)
describe('hudu_list_asset_layouts', () => {
  it('caps envelope items at 100 and flags truncation', async () => {
    resetClient()
    const asset_layouts = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, name: `layout-${i + 1}` }))
    const fetchFn = vi.fn(async () => jsonResponse({ asset_layouts }))
    const ctx = fakeCtx()
    getClient(ctx, fetchFn)

    const result = (await listLayouts.handler({}, ctx)) as {
      returned: number
      truncated?: boolean
      asset_layouts: unknown[]
    }

    expect(result.asset_layouts).toHaveLength(100)
    expect(result.returned).toBe(100)
    expect(result.truncated).toBe(true)
  })
})
