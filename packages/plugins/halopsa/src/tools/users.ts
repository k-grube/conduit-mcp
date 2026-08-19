import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { executeListUsers } from '../active-lists.js'

export const userTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_users',
    description:
      'Search and list HaloPSA end users/contacts. Returns ACTIVE users by default (not inactive, not service accounts; see active_rule; counts in active_count/total_in_system). Pages are filtered after fetch, so returned can be less than page_size. Set include_inactive=true for all users.',
    keywords: ['halopsa', 'user', 'contact', 'list', 'search'],
    params: {
      search: z.string().optional().describe('Search by name or email'),
      client_id: z.number().optional().describe('Filter by client ID'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25, max 100)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
      include_inactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('true = all users incl. inactive and service accounts (default false)'),
    },
    readOnly: true,
    handler: async (params, ctx) => executeListUsers(ctx, params),
  }),
]
