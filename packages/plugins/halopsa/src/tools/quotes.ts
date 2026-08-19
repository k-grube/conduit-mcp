import { defineTool, z, trimResponse, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { buildAdvancedSearch, ADVANCED_SEARCH_PARAM_DESCRIPTIONS } from '../advanced-search.js'

// HaloPSA system lookup ID for quote statuses -- stable across instances
const QUOTE_STATUS_LOOKUP_ID = 39

// process-lifetime memoized, no ttl; resettable for tests
let closedQuoteStatuses: Set<number> | undefined

export function resetClosedQuoteStatusCache(): void {
  closedQuoteStatuses = undefined
}

async function getClosedQuoteStatuses(ctx: PluginContext): Promise<Set<number>> {
  if (closedQuoteStatuses) {
    return closedQuoteStatuses
  }
  const client = await getClient(ctx)
  const result = await client.getLookup(QUOTE_STATUS_LOOKUP_ID)
  const items = (Array.isArray(result) ? result : []) as Record<string, unknown>[]

  // value3_bool indicates "system use = closed" on quote status lookups
  const closed = new Set<number>()
  for (const item of items) {
    if (item.value3_bool === true) {
      closed.add(Number(item.id))
    }
  }
  closedQuoteStatuses = closed
  return closed
}

const haloQuoteUrl = (item: Record<string, unknown>, client: { baseUrl: string }) => ({
  ...item,
  url: `${client.baseUrl}/order?quoteid=${item.id}`,
})

export const quoteTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_quotes',
    description:
      'List HaloPSA quotations. Filter by client, status, or search. Use this when asked about quotes, proposals, or pricing. Results are sorted newest first by default. When asked about "recent" or "upcoming" work, pay attention to quote dates: quotes older than 30-60 days are not recent.',
    keywords: ['halopsa', 'quote', 'quotation', 'proposal', 'list'],
    params: {
      client_id: z.number().optional().describe('Filter by client ID'),
      search: z.string().optional().describe('Search quotes by name or description'),
      open_only: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'Show only open quotes (default true). Excludes statuses flagged as closed in the system; filtered after fetch, so a page may return fewer than page_size.',
        ),
      ticket_id: z.number().optional().describe('Filter by linked ticket ID'),
      date_from: z.string().optional().describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.date_from('quote date')),
      date_to: z.string().optional().describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.date_to('quote date')),
      advanced_search: z.string().optional().describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.advanced_search),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const { open_only, date_from, date_to, advanced_search, ...apiParams } = params as Record<string, unknown> & {
        open_only?: boolean
        date_from?: string
        date_to?: string
        advanced_search?: string
      }

      const built = buildAdvancedSearch('date', { date_from, date_to, advanced_search })
      if (built.error) {
        return built.error
      }
      if (built.advanced_search) {
        apiParams.advanced_search = built.advanced_search
      }

      const client = await getClient(ctx)
      const result = (await client.getQuotations(apiParams)) as Record<string, unknown>

      if (open_only !== false) {
        const closed = await getClosedQuoteStatuses(ctx)
        let key: 'quotations' | 'quotes' | null = null
        if (Array.isArray(result.quotations)) {
          key = 'quotations'
        } else if (Array.isArray(result.quotes)) {
          key = 'quotes'
        }
        if (key && Array.isArray(result[key])) {
          const filtered = (result[key] as Record<string, unknown>[]).filter(
            (q) => !closed.has(Number(q.status ?? q.quote_status ?? -1)),
          )
          // record_count stays the api total across pages, returned is the post-filter page count
          result[key] = filtered.map((q) => haloQuoteUrl(q, client))
          result.returned = filtered.length
        }
      }

      return trimResponse(result)
    },
  }),

  defineTool({
    name: 'halopsa_get_quote',
    description: 'Get detailed information about a specific HaloPSA quotation by ID, including line items.',
    keywords: ['halopsa', 'quote', 'quotation', 'get', 'detail'],
    params: {
      id: z.number().describe('The quotation ID'),
      includedetails: z.boolean().optional().default(true).describe('Include full quote details and line items'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getQuotationById(params.id, { includedetails: params.includedetails })) as Record<
        string,
        unknown
      >
      return haloQuoteUrl(result, client)
    },
  }),
]
