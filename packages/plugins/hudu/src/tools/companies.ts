import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { huduCompanyUrl } from '../urls.js'

export const companyTools: ToolDef[] = [
  defineTool({
    name: 'hudu_list_companies',
    description:
      'Search and list Hudu companies. Filter by name, phone_number, website, city, state, slug, free-text search, or id_in_integration (PSA id, e.g. a HaloPSA client id). Returns company records with url and kb_url deep links. Use hudu_list_managed_companies to restrict to actively managed clients.',
    keywords: ['hudu', 'companies', 'clients', 'search', 'list', 'customers', 'organizations'],
    params: {
      name: z.string().optional().describe('Filter by company name'),
      phone_number: z.string().optional().describe('Filter by phone number'),
      website: z.string().optional().describe('Filter by website'),
      city: z.string().optional().describe('Filter by city'),
      state: z.string().optional().describe('Filter by state'),
      search: z.string().optional().describe('Free-text search'),
      slug: z.string().optional().describe('Filter by URL slug'),
      id_in_integration: z.number().optional().describe('Filter by integration ID (e.g., PSA ID)'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
      archived: z
        .boolean()
        .optional()
        .default(false)
        .describe('Set to true for the archived-only view (default false = active companies only)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getCompanies(args)
      return formatResult(result, client, { collectionKey: 'companies', transformItem: huduCompanyUrl })
    },
  }),

  defineTool({
    name: 'hudu_get_company',
    description:
      'Get a single Hudu company by ID. Returns the company record with url and kb_url (link to the company KB; use kb_url instead of constructing KB URLs).',
    keywords: ['hudu', 'company', 'get', 'detail', 'client', 'customer'],
    params: { id: z.number().describe('The company ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = getClient(ctx)
      const result = await client.getCompanyById(id)
      return formatResult(result, client, { transformItem: huduCompanyUrl })
    },
  }),
]
