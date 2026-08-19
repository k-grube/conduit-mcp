import { defineTool, z, stripHtml, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { CLIENT_DETAIL_FIELDS, haloClientUrl, pickFields } from '../fields.js'
import { executeListClients } from '../active-lists.js'

const HTML_NOTE_FIELDS = ['notes', 'popup_notes', 'callhandlingnotes'] as const

export const clientTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_clients',
    description:
      "Search and list HaloPSA clients. Returns ACTIVE clients by default: not inactive-flagged, plus the plugin's client-type include/exclude filters when configured (effective rule shown in active_rule; counts in active_count/total_in_system). Set include_inactive=true for everything. Fuzzy name matching built in.",
    keywords: ['halopsa', 'client', 'customer', 'company', 'account', 'list', 'search'],
    params: {
      search: z.string().optional().describe('Search by client name (fuzzy, punctuation-insensitive)'),
      toplevel_id: z.number().optional().describe('Filter by top-level client ID'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25, max 100)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
      include_inactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('true = ALL records regardless of the active rule (default false = active clients only)'),
    },
    readOnly: true,
    handler: async (params, ctx) => executeListClients(ctx, params),
  }),

  defineTool({
    name: 'halopsa_get_client',
    description:
      'Get one HaloPSA client by ID: type, primary tech and account manager, accounts contact details, notes (HTML stripped), custom fields, and a url deep link.',
    keywords: ['halopsa', 'client', 'customer', 'get', 'detail'],
    params: {
      id: z.number().describe('The client ID'),
      includedetails: z.boolean().optional().default(true).describe('Include full client details'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getClientById(params.id, { includedetails: params.includedetails })) as Record<
        string,
        unknown
      >
      for (const field of HTML_NOTE_FIELDS) {
        if (typeof result[field] === 'string') {
          result[field] = stripHtml(result[field] as string)
        }
      }
      const withUrl = haloClientUrl(result, client)
      return pickFields(withUrl, CLIENT_DETAIL_FIELDS)
    },
  }),
]
