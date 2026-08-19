import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { ASSET_LIST_FIELDS, ASSET_DETAIL_FIELDS, haloAssetUrl, pickFields } from '../fields.js'
import { formatListResult } from './format-result.js'

export const assetTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_assets',
    description:
      'Search and list HaloPSA assets/configuration items. Supports filtering by client, site, type, and search.',
    keywords: ['halopsa', 'asset', 'configuration item', 'device', 'list', 'search'],
    params: {
      search: z.string().optional().describe('Free-text search across asset names'),
      client_id: z.number().optional().describe('Filter by client ID'),
      site_id: z.number().optional().describe('Filter by site ID'),
      assettype_id: z.number().optional().describe('Filter by asset type ID'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
      includeinactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include inactive client assets (default: false)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getAssets(params)
      return formatListResult(result, client, {
        collectionKey: 'assets',
        fields: ASSET_LIST_FIELDS,
        transformItem: haloAssetUrl,
      })
    },
  }),

  defineTool({
    name: 'halopsa_get_asset',
    description: 'Get detailed information about a specific HaloPSA asset by ID.',
    keywords: ['halopsa', 'asset', 'configuration item', 'get', 'detail'],
    params: {
      id: z.number().describe('The asset ID'),
      includedetails: z.boolean().optional().default(true).describe('Include full asset details'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getAssetById(params.id, { includedetails: params.includedetails })) as Record<
        string,
        unknown
      >
      return pickFields(haloAssetUrl(result, client), ASSET_DETAIL_FIELDS)
    },
  }),
]
