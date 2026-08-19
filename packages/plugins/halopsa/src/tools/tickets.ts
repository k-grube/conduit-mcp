import { defineTool, z, trimResponse, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import {
  trimList,
  pickFields,
  TICKET_LIST_FIELDS,
  TICKET_DETAIL_FIELDS,
  ATTACHMENT_FIELDS,
  haloTicketUrl,
} from '../fields.js'
import { buildAdvancedSearch, ADVANCED_SEARCH_PARAM_DESCRIPTIONS } from '../advanced-search.js'
import { getClassifiedTypes, resolveTicketTypeKeyword } from '../ticket-types-cache.js'

// process-lifetime memoized, no ttl; resettable for tests
let statusMap: Map<number, string> | undefined
let sourceMap: Map<number, string> | undefined

export function resetTicketCaches(): void {
  statusMap = undefined
  sourceMap = undefined
}

async function getStatusMap(ctx: PluginContext): Promise<Map<number, string>> {
  if (statusMap) {
    return statusMap
  }
  const client = await getClient(ctx)
  const result = await client.getStatuses()
  const statuses = (Array.isArray(result) ? result : (result as Record<string, unknown>)?.statuses || []) as Record<
    string,
    unknown
  >[]
  statusMap = new Map(statuses.map((s) => [Number(s.id), String(s.name || '')]))
  return statusMap
}

// lookup 22 = request source
async function getSourceMap(ctx: PluginContext): Promise<Map<number, string>> {
  if (sourceMap) {
    return sourceMap
  }
  const client = await getClient(ctx)
  const result = (await client.getLookup(22)) as { id: number; name: string }[]
  sourceMap = new Map(result.map((s) => [Number(s.id), String(s.name || '')]))
  return sourceMap
}

function enrichTicketFields(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data
  }
  const d = data as Record<string, unknown>

  const enrichItem = (item: Record<string, unknown>) => {
    if (item.status_id != null && !item.status_name) {
      item.status_name = statusMap?.get(Number(item.status_id)) || `Status ${item.status_id}`
    }
    if (item.source != null && sourceMap) {
      item.source_name = sourceMap.get(Number(item.source)) || `Source ${item.source}`
    }
    return item
  }

  for (const key of ['tickets', 'projects', 'opportunities']) {
    if (Array.isArray(d[key])) {
      d[key] = (d[key] as Record<string, unknown>[]).map((item) => enrichItem(item))
      return d
    }
  }

  if (d.status_id != null || d.source != null) {
    enrichItem(d)
  }

  return data
}

function injectUrls(
  data: unknown,
  key: string,
  transform: (item: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (data && typeof data === 'object' && key in data) {
    const d = data as Record<string, unknown>
    if (Array.isArray(d[key])) {
      return { ...d, [key]: (d[key] as Record<string, unknown>[]).map(transform) }
    }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return transform(data as Record<string, unknown>)
  }
  return data
}

export const ticketTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_tickets',
    description:
      "Search and list HaloPSA tickets. To find a person's tickets, use agent_name (preferred) or agent_id. Use ticket_type to filter by type (e.g. 'project', 'opportunity', 'problem', 'change'); an unmatched type returns an error listing the available type names. Only use search for keyword matching on ticket summary/details text. Set open_only to true (default) to exclude closed tickets. Results include merged_into_id (>0 means merged into another ticket), parent_id (>0 means this is a child ticket), and child_count. When asked to exclude merged/child/deleted tickets, filter on these fields. For 'how many' questions, read record_count (total across all pages), NOT tickets.length, which is just the current page.",
    keywords: ['halopsa', 'ticket', 'list', 'search', 'issues', 'helpdesk', 'psa', 'open', 'customer'],
    params: {
      search: z
        .string()
        .optional()
        .describe(
          'Keyword search on ticket summary/details text only. Do NOT use this to find tickets by person name, use agent_name instead.',
        ),
      client_id: z.number().optional().describe('Filter by client ID'),
      agent_name: z
        .string()
        .optional()
        .describe(
          'Filter by agent name (e.g. "Jane Smith"). The tool resolves the name to an agent ID automatically. Use this when asked for "my tickets" or tickets belonging to a specific person.',
        ),
      agent_id: z
        .number()
        .optional()
        .describe('Filter by assigned agent ID directly. Use agent_name instead if you have a name.'),
      ticket_type: z
        .string()
        .optional()
        .describe(
          'Filter by ticket type. Keyword buckets resolve via Halo\'s own type metadata (use + project_type): "project" / "master project" -> master projects only (project_type=1); "project task" / "phase" / "task" -> project tasks/phases (project_type=0, use=projects); "opportunity" -> opportunities (use=opps). Any other string falls back to substring match against the live ticket type names; on no match the error lists the available type names.',
        ),
      status_id: z
        .number()
        .optional()
        .describe('Filter by a single specific status ID. Only use when asked for tickets in one exact status.'),
      open_only: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "When true (default), restricts to open tickets via the configured open-tickets view, or Halo's native open filter when no view is set. Ignored when status_id or ticket_type is set. Set to false to include closed tickets.",
        ),
      date_from: z
        .string()
        .optional()
        .describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.date_from('ticket creation (dateoccurred)')),
      date_to: z
        .string()
        .optional()
        .describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.date_to('ticket creation (dateoccurred)')),
      close_date_from: z
        .string()
        .optional()
        .describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.date_from('ticket close date (datecleared)')),
      close_date_to: z
        .string()
        .optional()
        .describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.date_to('ticket close date (datecleared)')),
      top_level_only: z
        .boolean()
        .optional()
        .describe(
          'When true, excludes child tickets (parent_id > 0). Applied client-side post-fetch, so the returned page may contain fewer than page_size results.',
        ),
      advanced_search: z.string().optional().describe(ADVANCED_SEARCH_PARAM_DESCRIPTIONS.advanced_search),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const {
        open_only,
        agent_name,
        ticket_type,
        date_from,
        date_to,
        close_date_from,
        close_date_to,
        top_level_only,
        advanced_search,
        ...apiParams
      } = params as Record<string, unknown> & {
        open_only?: boolean
        agent_name?: string
        ticket_type?: string
        date_from?: string
        date_to?: string
        close_date_from?: string
        close_date_to?: string
        top_level_only?: boolean
        advanced_search?: string
      }

      const built = buildAdvancedSearch('dateoccurred', {
        date_from,
        date_to,
        advanced_search,
        extra_dates: [{ field: 'datecleared', from: close_date_from, to: close_date_to }],
      })
      if (built.error) {
        return built.error
      }
      if (built.advanced_search) {
        apiParams.advanced_search = built.advanced_search
      }
      const client = await getClient(ctx)

      if (agent_name && !apiParams.agent_id) {
        const agents = await client.getAgents()
        const agentList = (
          Array.isArray(agents) ? agents : (agents as Record<string, unknown>)?.agents || []
        ) as Record<string, unknown>[]
        const needle = agent_name.toLowerCase()
        const match = agentList.find((a) => {
          const name = String(a.name || '').toLowerCase()
          return name === needle || name.includes(needle)
        })
        if (match) {
          apiParams.agent_id = Number(match.id)
        } else {
          return `No agent found matching "${agent_name}". Use halopsa_get_schema with section 'live_data' to list valid agent names.`
        }
      }

      // standard tickets only (not when filtering by ticket_type): the configured view is the
      // instance's curated definition of open, halo's native open filter otherwise
      if (open_only !== false && !apiParams.status_id && !ticket_type) {
        const cfg = await ctx.getConfig<{ openTicketsViewId?: number | string }>()
        const viewId = Number(cfg.openTicketsViewId)
        if (Number.isFinite(viewId) && viewId > 0) {
          apiParams.view_id = viewId
        } else {
          apiParams.open_only = true
        }
      }

      let postFilterTypeIds: Set<number> | undefined
      let result: unknown
      if (ticket_type) {
        const classified = await getClassifiedTypes(ctx)
        const resolved = resolveTicketTypeKeyword(ticket_type, classified)
        if (!resolved || resolved.ids.length === 0) {
          const names = classified.all
            .filter((t) => t.visible !== false && t.name)
            .map((t) => t.name)
            .slice(0, 40)
          return `No ticket type found matching "${ticket_type}". Available types: ${names.join(', ')}`
        }
        if (resolved.ids.length === 1) {
          apiParams.ticketarea_id = resolved.ids[0]
          result = await client.getTickets(apiParams)
        } else {
          // multiple matching type ids: use the module endpoint (projects or opps) as the widest
          // superset available, then filter in memory by tickettype_id
          postFilterTypeIds = new Set(resolved.ids)
          if (resolved.category === 'opportunity') {
            result = await client.getOpportunities(apiParams)
          } else {
            // master or task category, both sit under /Projects
            result = await client.getProjects(apiParams)
          }
        }
      } else {
        result = await client.getTickets(apiParams)
      }

      if (postFilterTypeIds && result && typeof result === 'object') {
        const container = result as Record<string, unknown>
        for (const key of ['tickets', 'projects', 'opportunities']) {
          if (Array.isArray(container[key])) {
            container[key] = (container[key] as Record<string, unknown>[]).filter((item) =>
              postFilterTypeIds!.has(Number(item.tickettype_id)),
            )
          }
        }
      }

      if (top_level_only && result && typeof result === 'object') {
        const container = result as Record<string, unknown>
        for (const key of ['tickets', 'projects', 'opportunities']) {
          if (Array.isArray(container[key])) {
            container[key] = (container[key] as Record<string, unknown>[]).filter(
              (item) => Number(item.parent_id ?? 0) === 0,
            )
          }
        }
      }

      await getStatusMap(ctx)
      enrichTicketFields(result)

      const withUrls = injectUrls(result, 'tickets', (item) => haloTicketUrl(item, client))
      return trimList(withUrls, 'tickets', TICKET_LIST_FIELDS)
    },
  }),

  defineTool({
    name: 'halopsa_get_ticket',
    description:
      'Get detailed information about a specific HaloPSA ticket by ID. Actions/notes are excluded by default to reduce response size, set includeactions: true or use halopsa_list_actions with pagination for large tickets.',
    keywords: ['halopsa', 'ticket', 'get', 'detail'],
    params: {
      id: z.number().describe('The ticket ID'),
      includedetails: z.boolean().optional().default(true).describe('Include full ticket details'),
      includeactions: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include ticket actions/notes (can be large, use halopsa_list_actions for paginated access)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const { id, ...rest } = params
      const client = await getClient(ctx)
      const result = await client.getTicketById(id, rest)
      await Promise.all([getStatusMap(ctx), getSourceMap(ctx)])
      enrichTicketFields(result)
      const withUrls = injectUrls(result, 'tickets', (item) => haloTicketUrl(item, client))
      return trimList(withUrls, 'tickets', TICKET_DETAIL_FIELDS)
    },
  }),

  defineTool({
    name: 'halopsa_list_attachments',
    description:
      'List attachments on a HaloPSA object. Supports tickets, opportunities, quotes, sales orders, and contracts. For quotes, returns both generated PDFs and signed/accepted documents.',
    keywords: ['halopsa', 'attachments', 'files', 'documents'],
    params: {
      object_type: z
        .enum(['ticket', 'opportunity', 'quote', 'sales_order', 'contract'])
        .describe('Type of object to get attachments for'),
      object_id: z.number().describe('The object ID (ticket ID, quote ID, etc.)'),
      search: z.string().optional().describe('Filter attachments by filename (case-insensitive substring match)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const { object_type, object_id, search } = params

      const fetchAttachments = async (apiParams: Record<string, unknown>) => {
        const result = await client.getAttachments(apiParams)
        return (Array.isArray(result) ? result : (result as Record<string, unknown>)?.attachments || []) as Record<
          string,
          unknown
        >[]
      }

      let attachments: Record<string, unknown>[]
      switch (object_type) {
        case 'ticket':
        case 'opportunity':
          attachments = await fetchAttachments({ ticket_id: object_id })
          break
        case 'quote': {
          const [pdfs, signed] = await Promise.all([
            fetchAttachments({ type: 50, unique_id: object_id }),
            fetchAttachments({ type: 66, unique_id: object_id }),
          ])
          attachments = [...pdfs, ...signed]
          break
        }
        case 'sales_order':
          attachments = await fetchAttachments({ type: 52, unique_id: object_id })
          break
        case 'contract':
          attachments = await fetchAttachments({ type: 8, unique_id: object_id })
          break
      }

      if (search) {
        const needle = search.toLowerCase()
        attachments = attachments.filter((a) => {
          const name = String(a.filename || a.desc || '').toLowerCase()
          return name.includes(needle)
        })
      }

      const parentPaths: Record<string, string> = {
        ticket: `/ticket?id=${object_id}`,
        opportunity: `/ticket?id=${object_id}`,
        quote: `/order?quoteid=${object_id}`,
        sales_order: `/order?salesorderid=${object_id}`,
        contract: `/contract?contractid=${object_id}`,
      }
      const parentUrl = `${client.baseUrl}${parentPaths[object_type]}`

      const trimmed = attachments.map((a) => ({ ...pickFields(a, ATTACHMENT_FIELDS), url: parentUrl }))
      return trimResponse({ attachments: trimmed, count: trimmed.length })
    },
  }),

  defineTool({
    name: 'halopsa_search_attachments',
    description:
      'Search attachment filenames and descriptions across HaloPSA tickets, quotes, sales orders, and contracts, newest first. Each match includes object_type and unique_id (the parent object ID). Use halopsa_list_attachments instead when you already know the parent object.',
    keywords: ['halopsa', 'attachments', 'search', 'files'],
    params: {
      search: z.string().describe('Filename search term (case-insensitive, partial match)'),
      object_type: z
        .enum(['ticket', 'quote', 'sales_order', 'contract'])
        .optional()
        .describe('Limit search to a specific object type'),
      page_size: z.number().optional().describe('Max results (default 25, max 100)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      // escape single quotes for sql LIKE
      const search = params.search.replace(/'/g, "''")
      const pageSize = Math.min(params.page_size ?? 25, 100)

      const typeMap: Record<string, string> = {
        ticket: '0',
        quote: '50, 66',
        sales_order: '52',
        contract: '8',
      }
      const typeFilter = params.object_type ? `AND a.atType IN (${typeMap[params.object_type]})` : ''

      const sql = `SELECT TOP ${pageSize} a.ATid as id, a.ATFilename as filename, a.ATDesc as [desc], a.atfilesize as filesize, a.ATContentType as content_type, a.ATDateCreated as datecreated, a.atType as type, a.atUniqueID as unique_id FROM ATTACHMENT a WHERE (a.ATFilename LIKE '%${search}%' OR a.ATDesc LIKE '%${search}%') ${typeFilter} AND a.atType IN (0, 8, 50, 52, 66) ORDER BY a.ATDateCreated DESC`

      const result = (await client.executeQuery(sql)) as { report?: { rows?: unknown[] } }
      const rows = (result?.report?.rows || []) as Record<string, unknown>[]

      const typeLabels: Record<number, string> = {
        0: 'ticket',
        8: 'contract',
        50: 'quote',
        52: 'sales_order',
        66: 'quote',
      }
      const enriched = rows.map((r) => ({
        ...r,
        object_type: typeLabels[Number(r.type)] || 'unknown',
      }))

      return { attachments: enriched, count: enriched.length }
    },
  }),
]
