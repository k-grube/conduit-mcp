import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { ninjaOrgUrl, ninjaDeviceUrl } from '../urls.js'

export const organizationTools: ToolDef[] = [
  defineTool({
    name: 'ninja_list_organizations',
    description:
      'List NinjaRMM organizations with locations, policy mappings, and settings, plus a dashboard url per org. Paginate with pageSize and after (last org ID from previous page).',
    keywords: ['ninja', 'organizations', 'list', 'clients', 'customers', 'companies'],
    params: {
      pageSize: z.number().optional().default(50).describe('Results per page'),
      after: z.number().optional().describe('Last org ID from previous page for pagination'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getOrganizations(params)
      return formatResult(result, client, { transformItem: ninjaOrgUrl })
    },
  }),

  defineTool({
    name: 'ninja_get_organization',
    description: 'Get detailed information about a specific NinjaRMM organization by ID.',
    keywords: ['ninja', 'organization', 'get', 'client'],
    params: { id: z.number().describe('The organization ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getOrganizationById(id)
      return formatResult(result, client, { transformItem: ninjaOrgUrl })
    },
  }),

  defineTool({
    name: 'ninja_list_organization_devices',
    description:
      'List devices belonging to one NinjaRMM organization, with a dashboard url per device. Paginate with pageSize and after. For cross-org listing or filter expressions use ninja_list_devices with df="org = ID".',
    keywords: ['ninja', 'organization', 'devices', 'list'],
    params: {
      id: z.number().describe('The organization ID'),
      pageSize: z.number().optional().default(50).describe('Results per page'),
      after: z.number().optional().describe('Last device ID for pagination'),
    },
    readOnly: true,
    handler: async ({ id, ...rest }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getOrganizationDevices(id, rest)
      return formatResult(result, client, { transformItem: ninjaDeviceUrl })
    },
  }),
]
