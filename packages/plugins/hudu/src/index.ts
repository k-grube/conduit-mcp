import { definePlugin } from '@conduit-mcp/plugin-sdk'
import { getClient } from './client.js'
import { companyTools } from './tools/companies.js'
import { articleTools } from './tools/articles.js'
import { articleWriteTools } from './tools/articles-write.js'
import { assetTools } from './tools/assets.js'
import { operationTools } from './tools/operations.js'
import { managedCompaniesTools } from './tools/managed-companies.js'

export default definePlugin({
  tools: [
    ...companyTools,
    ...articleTools,
    ...articleWriteTools,
    ...assetTools,
    ...operationTools,
    ...managedCompaniesTools,
  ],
  healthCheck: async (ctx) => {
    try {
      const client = getClient(ctx)
      await client.getCompanies({ page_size: 1 })
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  },
})
