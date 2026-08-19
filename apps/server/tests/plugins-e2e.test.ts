import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadRealPluginCatalog, type RealPluginCatalog } from './helpers/load-real-plugins.js'

let rip: RealPluginCatalog
let fetchSpy: ReturnType<typeof vi.fn>

beforeAll(async () => {
  // stubbed before load so bundling, importing, and registering all five real plugin
  // packages is proven network-free too, not just the tool invokes below
  fetchSpy = vi.fn(async () => {
    throw new Error('unexpected network call in test')
  })
  vi.stubGlobal('fetch', fetchSpy)
  rip = await loadRealPluginCatalog('E2e')
}, 60_000)

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('in-repo plugin boot', () => {
  it('loads all five real plugin packages to active', async () => {
    const records = await rip.registry.list()
    expect(records.map((r) => r.id).sort()).toEqual(['cipp', 'halopsa', 'hudu', 'ninjarmm', 'quickbooks'])
    for (const rec of records) {
      expect(rec.status).toBe('active')
    }
  })

  it('registers every loaded plugin as an integration with a non-empty catalog', () => {
    const integrationIds = rip.catalog
      .integrations()
      .map((i) => i.id)
      .sort()
    expect(integrationIds).toEqual(['cipp', 'halopsa', 'hudu', 'ninjarmm', 'quickbooks'])
    for (const id of integrationIds) {
      expect(rip.catalog.list(id).length).toBeGreaterThan(0)
    }
  })

  it('the manifest/bundle/import/register path never touched the network', () => {
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('representative tool invokes reach the client error path, never the network', () => {
  beforeEach(() => {
    fetchSpy.mockClear()
  })

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('halopsa_list_tickets fails fast on missing settings', async () => {
    await expect(rip.catalog.get('halopsa_list_tickets')!.invoke({})).rejects.toThrow(
      /missing required halopsa setting/,
    )
  })

  it('hudu_search_articles fails fast on missing settings', async () => {
    await expect(rip.catalog.get('hudu_search_articles')!.invoke({})).rejects.toThrow(/missing required hudu setting/)
  })

  it('cipp_list_signin_logs fails fast on missing settings', async () => {
    await expect(
      rip.catalog.get('cipp_list_signin_logs')!.invoke({ tenantFilter: 'contoso.onmicrosoft.com', userId: 'x' }),
    ).rejects.toThrow(/missing required cipp setting/)
  })

  it('ninja_query_os_patches fails fast on missing settings', async () => {
    await expect(rip.catalog.get('ninja_query_os_patches')!.invoke({})).rejects.toThrow(
      /missing required ninja setting/,
    )
  })

  it('qbo_list_invoices returns a not_connected error envelope, no realm configured', async () => {
    const result = await rip.catalog.get('qbo_list_invoices')!.invoke({})
    expect(result).toMatchObject({ error: 'not_connected', environment: 'sandbox' })
  })
})
