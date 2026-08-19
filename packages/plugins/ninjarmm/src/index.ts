import { definePlugin } from '@conduit-mcp/plugin-sdk'
import { getClient } from './client.js'
import { organizationTools } from './tools/organizations.js'
import { deviceTools } from './tools/devices.js'
import { monitoringTools } from './tools/monitoring.js'
import { customFieldTools } from './tools/custom-fields.js'
import { policyTools } from './tools/policies.js'

export default definePlugin({
  tools: [...organizationTools, ...deviceTools, ...monitoringTools, ...customFieldTools, ...policyTools],
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
