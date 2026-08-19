import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { haloContractUrl } from '../fields.js'
import { executeListContracts } from '../active-lists.js'

export const contractTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_contracts',
    description:
      'List HaloPSA contracts (agreements). Returns LIVE, ACTIVE contracts by default; date-expired-but-not-deactivated ones are counted in expired_awaiting_action and listed only with include_inactive=true. Deactivated contracts are archived. Filter by client or search term.',
    keywords: ['halopsa', 'contract', 'agreement', 'list'],
    params: {
      client_id: z.number().optional().describe('Filter by client ID'),
      search: z.string().optional().describe('Search contracts by reference or description'),
      include_inactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('true = all contracts incl. expired and deactivated/archived (default false = Live + Active only)'),
      page_size: z.number().optional().default(50).describe('Results per page (default 50, max 100)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => executeListContracts(ctx, params),
  }),

  defineTool({
    name: 'halopsa_get_contract',
    description:
      'Get detailed information about a specific HaloPSA contract by ID, including covered users and billing details.',
    keywords: ['halopsa', 'contract', 'agreement', 'get', 'detail'],
    params: {
      id: z.number().describe('The contract ID'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getContractById(params.id)) as Record<string, unknown>
      return haloContractUrl(result, client)
    },
  }),
]
