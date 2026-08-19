import { createWriteGuard, defineTool, z, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient, type HuduConfig } from '../client.js'
import { huduArticleUrl } from '../urls.js'

async function writesEnabled(ctx: PluginContext): Promise<boolean> {
  const cfg = await ctx.getConfig<HuduConfig>()
  return cfg.writesEnabled === true
}

async function archiveEnabled(ctx: PluginContext): Promise<boolean> {
  const cfg = await ctx.getConfig<HuduConfig>()
  return cfg.archiveEnabled === true
}

export const articleWriteTools: ToolDef[] = [
  defineTool({
    name: 'hudu_create_article',
    description:
      'Create a Hudu KB article. Two-step: call without confirm_token to receive a preview and confirm_token, then re-call with the token to commit. Articles land in the AI Drafts folder for the target company (created if missing). Pass central:true for the central KB, otherwise company_id is required. Returns the created article with url. Requires writesEnabled in hudu plugin settings.',
    keywords: ['hudu', 'article', 'create', 'write', 'kb', 'knowledge base', 'draft', 'documentation', 'new'],
    params: {
      name: z.string().describe('Article title'),
      content: z.string().describe('Article HTML content'),
      company_id: z.number().optional().describe('Target Hudu company id; omit + central:true for central KB'),
      central: z.boolean().optional().describe('Required true to write to central KB when company_id is omitted'),
      enable_sharing: z.boolean().optional().describe('Default false. True publishes a public share URL.'),
      confirm_token: z.string().optional().describe('Token from a prior preview call to commit the write'),
    },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return { error: 'writes disabled, enable writesEnabled in hudu plugin settings' }
      }
      const { name, content, company_id, central, enable_sharing, confirm_token } = args
      if (company_id === undefined && central !== true) {
        return { error: 'central KB writes require central:true; otherwise pass company_id' }
      }
      const client = getClient(ctx)
      const cfg = await ctx.getConfig<HuduConfig>()
      const folderId = await client.findOrCreateDraftFolder(company_id ?? null, cfg.draftFolderName || 'AI Drafts')
      const payload: Record<string, unknown> = {
        name,
        content,
        folder_id: folderId,
        enable_sharing: enable_sharing ?? false,
        ...(company_id !== undefined ? { company_id } : {}),
      }
      const guard = createWriteGuard(ctx.store)
      if (!confirm_token) {
        const { confirmToken, preview } = await guard.confirm('hudu_create_article', payload)
        return { preview, confirm_token: confirmToken }
      }
      await guard.commit('hudu_create_article', payload, confirm_token)
      const article = await client.createArticle(payload as never)
      return huduArticleUrl(article, client)
    },
  }),

  defineTool({
    name: 'hudu_update_article',
    description:
      'Update a Hudu KB article by ID. Two-step: call without confirm_token to receive a preview of the changes, then re-call with the token to commit. Partial update: only fields supplied are sent. Use hudu_get_article first if you need the current state. Returns the updated article with url. Requires writesEnabled in hudu plugin settings.',
    keywords: ['hudu', 'article', 'update', 'edit', 'write', 'kb', 'modify'],
    params: {
      id: z.number().describe('Article id'),
      name: z.string().optional(),
      content: z.string().optional(),
      enable_sharing: z.boolean().optional(),
      folder_id: z.number().optional().describe('Move article to a different folder. Rare; omit unless intentional.'),
      confirm_token: z.string().optional(),
    },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return { error: 'writes disabled, enable writesEnabled in hudu plugin settings' }
      }
      const { id, confirm_token, ...changes } = args
      if (Object.keys(changes).length === 0) {
        return { error: 'no fields to update' }
      }
      const payload = { id, changes }
      const guard = createWriteGuard(ctx.store)
      if (!confirm_token) {
        const { confirmToken, preview } = await guard.confirm('hudu_update_article', payload)
        return { preview, confirm_token: confirmToken }
      }
      await guard.commit('hudu_update_article', payload, confirm_token)
      const client = getClient(ctx)
      const updated = await client.updateArticle(id, changes)
      return huduArticleUrl(updated, client)
    },
  }),

  defineTool({
    name: 'hudu_archive_article',
    description:
      'Archive a Hudu KB article by ID (reversible via hudu_unarchive_article). One-shot, no preview. Closest available operation to deleting an article. Requires archiveEnabled in hudu plugin settings.',
    keywords: ['hudu', 'article', 'archive', 'delete', 'remove'],
    params: { id: z.number() },
    readOnly: false,
    handler: async ({ id }, ctx) => {
      if (!(await archiveEnabled(ctx))) {
        return { error: 'archive disabled, enable archiveEnabled in hudu plugin settings' }
      }
      const client = getClient(ctx)
      const result = await client.archiveArticle(id)
      return huduArticleUrl(result, client)
    },
  }),

  defineTool({
    name: 'hudu_unarchive_article',
    description:
      'Unarchive a previously archived Hudu KB article by ID. One-shot, no preview. Requires archiveEnabled in hudu plugin settings.',
    keywords: ['hudu', 'article', 'unarchive', 'restore'],
    params: { id: z.number() },
    readOnly: false,
    handler: async ({ id }, ctx) => {
      if (!(await archiveEnabled(ctx))) {
        return { error: 'archive disabled, enable archiveEnabled in hudu plugin settings' }
      }
      const client = getClient(ctx)
      const result = await client.unarchiveArticle(id)
      return huduArticleUrl(result, client)
    },
  }),
]
