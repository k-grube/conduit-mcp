import { definePlugin } from '@conduit-mcp/plugin-sdk'
import { getClient } from './client.js'
import { logTools } from './tools/logs.js'
import { serviceHealthTools } from './tools/service-health.js'

export default definePlugin({
  tools: [...logTools, ...serviceHealthTools],
  healthCheck: async (ctx) => {
    try {
      const client = await getClient(ctx)
      await client.verifyAuth()
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  },
})
