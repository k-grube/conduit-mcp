import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { huduAssetUrl } from '../urls.js'

export const assetTools: ToolDef[] = [
  defineTool({
    name: 'hudu_list_assets',
    description:
      'Search and list Hudu assets (documented devices, configurations, and other layout-based records). Filter by company_id, asset_layout_id, serial, or free-text search. Returns active assets by default; set archived to true for the archived-only view.',
    keywords: ['hudu', 'assets', 'search', 'list', 'devices', 'configurations', 'hardware', 'inventory', 'serial'],
    params: {
      company_id: z.number().optional().describe('Filter by company ID'),
      asset_layout_id: z.number().optional().describe('Filter by asset layout ID'),
      serial: z.string().optional().describe('Filter by serial number'),
      search: z.string().optional().describe('Free-text search'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
      archived: z
        .boolean()
        .optional()
        .default(false)
        .describe('false (default) = active assets only, true = archived assets only'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getAssets(args)

      return formatResult(result, client, { collectionKey: 'assets', transformItem: huduAssetUrl })
    },
  }),

  defineTool({
    name: 'hudu_get_asset',
    description: 'Get a single Hudu asset by ID. Find IDs with hudu_list_assets.',
    keywords: ['hudu', 'asset', 'get', 'device', 'configuration', 'hardware'],
    params: { id: z.number().describe('The asset ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = getClient(ctx)
      const result = await client.getAssetById(id)
      return formatResult(result, client, { transformItem: huduAssetUrl })
    },
  }),

  defineTool({
    name: 'hudu_list_asset_layouts',
    description:
      'List Hudu asset layouts, the templates that define asset types and their fields. Use to discover asset_layout_id values for filtering hudu_list_assets.',
    keywords: ['hudu', 'asset layouts', 'templates', 'list', 'asset types', 'fields', 'schema'],
    params: {
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getAssetLayouts(args)
      return formatResult(result, client, { collectionKey: 'asset_layouts' })
    },
  }),
]
