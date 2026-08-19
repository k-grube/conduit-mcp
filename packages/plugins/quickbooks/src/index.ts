import { definePlugin } from '@conduit-mcp/plugin-sdk'
import { customerTools } from './tools/customers.js'
import { invoiceTools } from './tools/invoices.js'
import { paymentTools } from './tools/payments.js'
import { accountTools } from './tools/accounts.js'
import { transactionTools } from './tools/transactions.js'
import { changeTools } from './tools/changes.js'
import { recurringTools } from './tools/recurring.js'
import { reportTools } from './tools/reports.js'
import { haloLinkTools } from './tools/halo-link.js'
import { registerRoutes } from './routes.js'
import { stateKey, type QboEnvState } from './client.js'
import { secretNamesFor } from './secret-names.js'

export default definePlugin({
  tools: [
    ...customerTools,
    ...invoiceTools,
    ...paymentTools,
    ...accountTools,
    ...transactionTools,
    ...changeTools,
    ...recurringTools,
    ...reportTools,
    ...haloLinkTools,
  ],
  routes: (router, ctx) => registerRoutes(router, ctx),
  // connection state only, no network call: realmId comes from a completed oauth callback,
  // the refresh token check catches a disconnect that cleared the secret but left state.realmId
  healthCheck: async (ctx) => {
    const cfg = await ctx.getConfig<{ environment?: string }>()
    const environment = cfg.environment === 'production' ? 'production' : 'sandbox'
    const state = (await ctx.store.get<QboEnvState>(stateKey(environment))) ?? {}
    if (!state.realmId) {
      return { ok: false, detail: 'not connected' }
    }
    try {
      await ctx.getSecret(secretNamesFor(environment).refreshToken)
    } catch {
      return { ok: false, detail: 'not connected' }
    }
    return { ok: true, detail: environment }
  },
})
