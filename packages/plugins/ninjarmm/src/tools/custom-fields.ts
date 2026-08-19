import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { DF_DESCRIPTION } from '../filters.js'

export const customFieldTools: ToolDef[] = [
  defineTool({
    name: 'ninja_list_custom_field_definitions',
    description:
      'List all custom field definitions in NinjaRMM: field names, types, definition scopes (NODE, LOCATION, ORGANIZATION), and possible values. Use this first to learn what custom fields exist.',
    keywords: ['ninja', 'custom fields', 'definitions', 'list', 'schema'],
    params: {
      scopes: z
        .string()
        .optional()
        .describe("Comma-separated scope filter, values: 'all', 'node', 'location', 'organization'"),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getCustomFieldDefinitions(params)
      return formatResult(result, client)
    },
  }),

  defineTool({
    name: 'ninja_query_custom_fields',
    description:
      'Query custom field values across ALL NinjaRMM devices. Returns deviceId plus a fields map per device. Use ninja_list_custom_field_definitions first to know field names, then narrow with fields or df.',
    keywords: ['ninja', 'query', 'custom fields'],
    params: {
      df: z.string().optional().describe(DF_DESCRIPTION),
      fields: z
        .string()
        .optional()
        .describe('Comma-separated list of custom field names to include (returns all if omitted)'),
      updatedAfter: z.string().optional().describe('Only return fields updated after this ISO datetime'),
      showSecureValues: z.boolean().optional().describe('Show secure/password field values (default false)'),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryCustomFields(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_query_scoped_custom_fields',
    description:
      'Query custom field values by scope across NinjaRMM. Returns scope (NODE, LOCATION, ORGANIZATION), entityId, and a fields map per row. Use for organization- or location-level custom fields not tied to a device.',
    keywords: ['ninja', 'query', 'scoped custom fields', 'organization fields', 'location fields'],
    params: {
      scopes: z.string().optional().describe("Comma-separated scopes: 'all', 'node', 'location', 'organization'"),
      fields: z.string().optional().describe('Comma-separated list of custom field names to include'),
      updatedAfter: z.string().optional().describe('Only return fields updated after this ISO datetime'),
      showSecureValues: z.boolean().optional().describe('Show secure/password field values (default false)'),
      pageSize: z.number().optional().default(25).describe('Results per page'),
      cursor: z.string().optional().describe('Pagination cursor from previous response'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.queryScopedCustomFields(params)
      return formatResult(result, client, { collectionKey: 'results' })
    },
  }),

  defineTool({
    name: 'ninja_get_organization_custom_fields',
    description: 'Get custom field values for a specific NinjaRMM organization.',
    keywords: ['ninja', 'organization', 'custom fields'],
    params: { id: z.number().describe('The organization ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getOrganizationCustomFields(id)
      return formatResult(result, client)
    },
  }),
]
