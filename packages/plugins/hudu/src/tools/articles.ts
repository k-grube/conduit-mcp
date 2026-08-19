import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { formatResult } from '../format.js'
import { huduArticleUrl } from '../urls.js'

// article list excludes full content to reduce token usage, use hudu_get_article for full content
const ARTICLE_LIST_FIELDS = [
  'id',
  'name',
  'slug',
  'company_id',
  'company_name',
  'folder_id',
  'draft',
  'share_url',
  'created_at',
  'updated_at',
  'url',
] as const

export const articleTools: ToolDef[] = [
  defineTool({
    name: 'hudu_search_articles',
    description:
      'Search Hudu knowledge base articles. Returns metadata only, use hudu_get_article for full content. Pass company_id to get CLIENT-SPECIFIC articles for a company. Omit company_id to search the CENTRAL KB (general articles). Always search client KB first when investigating a client issue. Search does not match full email addresses or exact multi-token strings (tokenized index); retry with single broad keywords ("procurement", "email connectors") before concluding no article exists. Resolve a HaloPSA client to a Hudu company_id with hudu_list_managed_companies (returns halo_id per company) or hudu_list_companies id_in_integration. To link to a company KB, use the kb_url from hudu_get_company, never construct KB URLs manually.',
    keywords: ['hudu', 'articles', 'kb', 'knowledge base', 'search', 'documentation', 'docs', 'wiki', 'it glue'],
    params: {
      name: z.string().optional().describe('Filter by article name'),
      slug: z.string().optional().describe('Filter by URL slug (the hex ID from Hudu URLs like /kba/{slug})'),
      company_id: z
        .number()
        .optional()
        .describe('Hudu company ID: pass to get client-specific articles, omit for central KB'),
      draft: z.boolean().optional().describe('Filter by draft status'),
      search: z.string().optional().describe('Free-text search'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
      page_size: z.number().optional().default(25).describe('Results per page (default 25)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = getClient(ctx)
      const result = await client.getArticles(args)
      return formatResult(result, client, {
        collectionKey: 'articles',
        transformItem: huduArticleUrl,
        fields: ARTICLE_LIST_FIELDS,
      })
    },
  }),

  defineTool({
    name: 'hudu_get_article',
    description:
      'Get a Hudu knowledge base article by numeric ID, including full HTML content. Find IDs with hudu_search_articles; use hudu_get_article_by_slug when you only have the URL slug.',
    keywords: ['hudu', 'article', 'kb', 'knowledge base', 'get', 'content', 'documentation'],
    params: { id: z.number().describe('The article ID') },
    readOnly: true,
    handler: async ({ id }, ctx) => {
      const client = getClient(ctx)
      const result = await client.getArticleById(id)
      return formatResult(result, client, { transformItem: huduArticleUrl })
    },
  }),

  defineTool({
    name: 'hudu_get_article_by_slug',
    description:
      'Look up a Hudu knowledge base article by its URL slug, including full content. Use to fetch articles from Hudu URLs like /kba/{slug} (the trailing hex segment). Paginates through the article list to find the match (scans up to 2000 articles, slower than hudu_get_article). Returns null when no article matches.',
    keywords: ['hudu', 'article', 'kb', 'slug', 'lookup', 'url', 'kba', 'link'],
    params: { slug: z.string().describe('The article slug from the Hudu URL (e.g. f08788dda973)') },
    readOnly: true,
    handler: async ({ slug }, ctx) => {
      const client = getClient(ctx)
      const result = await client.getArticleBySlug(slug)
      if (!result) {
        return null
      }
      return formatResult(result, client, { transformItem: huduArticleUrl })
    },
  }),
]
