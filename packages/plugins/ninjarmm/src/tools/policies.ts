import { defineTool, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'

export const policyTools: ToolDef[] = [
  defineTool({
    name: 'ninja_list_policies',
    description:
      'List all NinjaRMM policies: policy definitions and IDs, used for device configuration and compliance.',
    keywords: ['ninja', 'policies', 'list', 'compliance', 'configuration'],
    params: {},
    readOnly: true,
    handler: async (_params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getPolicies()
      return formatResult(result, client)
    },
  }),
]
