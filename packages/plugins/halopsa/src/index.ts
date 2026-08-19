import { definePlugin } from '@conduit-mcp/plugin-sdk'
import { getClient } from './client.js'
import { ticketTools } from './tools/tickets.js'
import { clientTools } from './tools/clients.js'
import { userTools } from './tools/users.js'
import { assetTools } from './tools/assets.js'
import { actionTools } from './tools/actions.js'
import { quoteTools } from './tools/quotes.js'
import { contractTools } from './tools/contracts.js'
import { billingTools } from './tools/billing.js'
import { agentTools } from './tools/agents.js'
import { tenantTools } from './tools/tenants.js'
import { dashboardTools } from './tools/dashboards.js'
import { queryTools } from './tools/query.js'
import { reportTools } from './tools/reports.js'
import { reportWriteTools } from './tools/report-writes.js'
import { dashboardWriteTools } from './tools/dashboard-writes.js'
import { ticketWriteTools } from './tools/ticket-writes.js'

export default definePlugin({
  tools: [
    ...ticketTools,
    ...clientTools,
    ...userTools,
    ...assetTools,
    ...actionTools,
    ...quoteTools,
    ...contractTools,
    ...billingTools,
    ...agentTools,
    ...tenantTools,
    ...dashboardTools,
    ...queryTools,
    ...reportTools,
    ...reportWriteTools,
    ...dashboardWriteTools,
    ...ticketWriteTools,
  ],
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
