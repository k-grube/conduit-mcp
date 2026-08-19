import { describe, expect, it } from 'vitest'
import { definePlugin, defineTool, parseManifest, z, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { ToolCatalog } from './catalog.js'
import { ToolSearch } from './search.js'

const stubCtx = {
  getSecret: async () => '',
  setSecret: async () => {},
  getConfig: async () => ({}),
  invokeTool: async () => undefined,
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  store: { get: async () => undefined, set: async () => {}, delete: async () => {} },
} as PluginContext

function seed(cat: ToolCatalog) {
  const halo = parseManifest({
    id: 'halopsa',
    name: 'HaloPSA',
    toolPrefix: 'halopsa_',
    entry: 'e',
    sdkVersion: '^0.1',
  })
  const qbo = parseManifest({ id: 'qbo', name: 'QuickBooks', toolPrefix: 'qbo_', entry: 'e', sdkVersion: '^0.1' })
  cat.registerPlugin(
    halo,
    definePlugin({
      tools: [
        defineTool({
          name: 'halopsa_list_tickets',
          description: 'list helpdesk tickets with filters',
          keywords: ['tickets', 'helpdesk', 'psa'],
          params: {},
          readOnly: true,
          handler: async () => [],
        }),
        defineTool({
          name: 'halopsa_get_client',
          description: 'get a client company record',
          keywords: ['client', 'company'],
          params: { id: z.number() },
          readOnly: true,
          handler: async () => ({}),
        }),
      ],
    }),
    stubCtx,
  )
  cat.registerPlugin(
    qbo,
    definePlugin({
      tools: [
        defineTool({
          name: 'qbo_list_invoices',
          description: 'list customer invoices and balances',
          keywords: ['invoices', 'billing', 'money owed'],
          params: {},
          readOnly: true,
          handler: async () => [],
        }),
      ],
    }),
    stubCtx,
  )
}

describe('ToolSearch', () => {
  it('matches on name tokens', () => {
    const cat = new ToolCatalog()
    seed(cat)
    const hits = new ToolSearch(cat).search('tickets')
    expect(hits[0].name).toBe('halopsa_list_tickets')
  })

  it('matches on description and keywords', () => {
    const cat = new ToolCatalog()
    seed(cat)
    const hits = new ToolSearch(cat).search('who owes money')
    expect(hits.map((h) => h.name)).toContain('qbo_list_invoices')
  })

  it('filters by integration', () => {
    const cat = new ToolCatalog()
    seed(cat)
    const hits = new ToolSearch(cat).search('list', { integration: 'qbo' })
    expect(hits.every((h) => h.pluginId === 'qbo')).toBe(true)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('respects limit', () => {
    const cat = new ToolCatalog()
    seed(cat)
    expect(new ToolSearch(cat).search('list', { limit: 1 })).toHaveLength(1)
  })

  it('reindexes after catalog changes', () => {
    const cat = new ToolCatalog()
    const search = new ToolSearch(cat)
    expect(search.search('tickets')).toEqual([])
    seed(cat)
    expect(search.search('tickets')).not.toEqual([])
    cat.removePlugin('halopsa')
    expect(search.search('tickets').map((h) => h.pluginId)).not.toContain('halopsa')
  })

  it('matches note text after setNotes', () => {
    const cat = new ToolCatalog()
    seed(cat)
    const search = new ToolSearch(cat)
    expect(search.search('custom field lookup').map((e) => e.name)).not.toContain('halopsa_list_tickets')
    cat.setNotes({ tools: { halopsa_list_tickets: 'custom field lookup via CFClientCode' }, integrations: {} })
    expect(search.search('custom field lookup').map((e) => e.name)).toContain('halopsa_list_tickets')
  })
})
