import { defineTool, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'

interface HaloClient {
  id: unknown
  pritech?: unknown
  accountmanagertech?: unknown
}

function extractCollection(result: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[]
  }
  const obj = result as Record<string, unknown> | null | undefined
  return Array.isArray(obj?.[key]) ? (obj![key] as Record<string, unknown>[]) : []
}

const HALO_PAGE_SIZE = 100
const HALO_MAX_PAGES = 10

// halopsa_list_clients clamps page_size to 100 server-side, loop page_no until a short page
// (fewer than page_size returned) instead of assuming one page covers every client
async function loadManagedHaloClients(ctx: PluginContext): Promise<{ clients: HaloClient[]; truncated: boolean }> {
  const clients: HaloClient[] = []
  for (let pageNo = 1; pageNo <= HALO_MAX_PAGES; pageNo++) {
    // include_inactive:true routes halopsa_list_clients through its REST path, which is the
    // only path that returns pritech/accountmanagertech; the default active-only path is a
    // sql-report query that doesn't select those columns at all
    const haloResult = await ctx.invokeTool('halopsa_list_clients', {
      page_size: HALO_PAGE_SIZE,
      page_no: pageNo,
      include_inactive: true,
    })
    const page = extractCollection(haloResult, 'clients') as unknown as HaloClient[]
    clients.push(...page)
    if (page.length < HALO_PAGE_SIZE) {
      return { clients, truncated: false }
    }
  }
  return { clients, truncated: true }
}

// hudu companies cross-referenced with managed
// halopsa clients. degrades to all companies + a note when halopsa is unavailable
export const managedCompaniesTools: ToolDef[] = [
  defineTool({
    name: 'hudu_list_managed_companies',
    description:
      'List Hudu companies filtered to managed clients (those with a primary tech or account manager assigned in HaloPSA). Returns id, name, and halo_id (matching HaloPSA client id) per company; use it to map HaloPSA clients to Hudu company_id. No parameters. Falls back to all Hudu companies with a note when HaloPSA is unavailable. Use hudu_list_companies for the unfiltered list.',
    keywords: ['hudu', 'companies', 'managed', 'halopsa', 'clients', 'halo', 'mapping', 'active'],
    params: {},
    readOnly: true,
    handler: async (_args, ctx) => {
      const client = getClient(ctx)
      const huduResult = await client.getCompanies({ page_size: 1000 })
      const huduCompanies = extractCollection(huduResult, 'companies')

      let haloClients: HaloClient[]
      let truncated: boolean
      try {
        const loaded = await loadManagedHaloClients(ctx)
        haloClients = loaded.clients
        truncated = loaded.truncated
      } catch {
        return {
          companies: huduCompanies,
          note: 'halopsa plugin unavailable, returning all hudu companies unfiltered',
        }
      }

      const managedIds = new Set<number>()
      for (const c of haloClients) {
        if ((c.pritech && Number(c.pritech) > 0) || (c.accountmanagertech && Number(c.accountmanagertech) > 0)) {
          managedIds.add(Number(c.id))
        }
      }

      const filtered = huduCompanies
        .map((company) => {
          const integrations = (company.integrations as Record<string, unknown>[]) || []
          const haloLink = integrations.find((i) => managedIds.has(Number(i.sync_id)))
          if (!haloLink) {
            return null
          }
          return { id: company.id, name: company.name, halo_id: Number(haloLink.sync_id) }
        })
        .filter((c): c is { id: unknown; name: unknown; halo_id: number } => c !== null)

      if (truncated) {
        return {
          companies: filtered,
          note: `halopsa client list capped at ${HALO_MAX_PAGES * HALO_PAGE_SIZE} clients, some managed companies may be missing`,
        }
      }
      return { companies: filtered }
    },
  }),
]
