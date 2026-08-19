import { defineTool, z, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError } from '../client.js'
import { qboCustomerUrl, qboInvoiceUrl } from '../urls.js'

interface HaloClientShape {
  id: number
  name?: string
  accountsid?: number | null
}

interface QboCustomer {
  Id: string
  DisplayName?: string
  Balance?: number
  Active?: boolean
}

interface QboInvoice {
  Id: string
  DocNumber?: string
  DueDate?: string
  Balance?: number
}

interface InvoiceListResponse {
  QueryResponse?: { Invoice?: QboInvoice[] }
}

type HaloLookupResult =
  | { halo: HaloClientShape; accountsid: number }
  | { error: 'halo_link_missing'; halo_client_id: number; message: string }

// halopsa_get_client throwing (unknown tool -- halopsa not installed, or a halo api error) and
// "linked but accountsid is 0/missing" both collapse to the same halo_link_missing envelope,
// there's no separate "halo unavailable" variant in QboErrorEnvelope
async function loadHaloAndAccountsid(ctx: PluginContext, haloClientId: number): Promise<HaloLookupResult> {
  let detail: HaloClientShape
  try {
    detail = await ctx.invokeTool<HaloClientShape>('halopsa_get_client', { id: haloClientId })
  } catch (err) {
    return {
      error: 'halo_link_missing',
      halo_client_id: haloClientId,
      message: `Could not look up HaloPSA client ${haloClientId}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const acc = Number(detail.accountsid ?? 0)
  if (!acc) {
    return {
      error: 'halo_link_missing',
      halo_client_id: haloClientId,
      message: `HaloPSA client ${haloClientId} (${detail.name ?? 'unnamed'}) is not synced to QuickBooks (accountsid is missing or 0).`,
    }
  }
  return { halo: detail, accountsid: acc }
}

function bucketByOverdue(daysOverdue: number, balance: number, buckets: Record<string, number>): void {
  if (daysOverdue <= 0) {
    buckets.current += balance
  } else if (daysOverdue <= 30) {
    buckets.days_1_30 += balance
  } else if (daysOverdue <= 60) {
    buckets.days_31_60 += balance
  } else if (daysOverdue <= 90) {
    buckets.days_61_90 += balance
  } else {
    buckets.days_over_90 += balance
  }
}

export const haloLinkTools: ToolDef[] = [
  defineTool({
    name: 'qbo_get_customer_for_halo_client',
    description:
      'Get the QBO customer linked to a HaloPSA client: calls halopsa_get_client for halo_client_id and uses its accountsid field as the QBO customer Id. Returns { halo: {id, name}, qbo: {id, displayName, balance, active, url} }. Returns a halo_link_missing error when the Halo lookup fails, accountsid is 0 or missing, or no QBO customer matches (wrong realm).',
    keywords: ['quickbooks', 'halopsa', 'halo', 'link', 'mapping', 'client', 'accountsid', 'sync'],
    params: { halo_client_id: z.number().describe('HaloPSA client id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const lookup = await loadHaloAndAccountsid(ctx, args.halo_client_id)
      if ('error' in lookup) {
        return lookup
      }
      const client = await getQboClient(ctx)
      const got = await client.get<{ Customer: QboCustomer }>(`customer/${lookup.accountsid}`)
      // direct entity read faults 610 object not found when the id isn't in this realm
      if (isQboError(got) && !(got.error === 'qbo_api_error' && got.code === '610')) {
        return got
      }
      if (isQboError(got) || !got.Customer?.Id) {
        return {
          error: 'halo_link_missing',
          halo_client_id: args.halo_client_id,
          message: `HaloPSA client ${args.halo_client_id} has accountsid=${lookup.accountsid} but no matching customer was returned from QuickBooks (active env: ${client.environment}). The accountsid may belong to a different QBO realm.`,
        }
      }
      const qboSummary = qboCustomerUrl(
        {
          id: got.Customer.Id,
          displayName: got.Customer.DisplayName ?? null,
          balance: got.Customer.Balance ?? 0,
          active: got.Customer.Active ?? true,
        },
        client.environment,
      )
      return {
        halo: { id: lookup.halo.id, name: lookup.halo.name ?? null },
        qbo: qboSummary,
      }
    },
  }),

  defineTool({
    name: 'qbo_get_customer_balance_for_halo_client',
    description:
      'Get the QBO receivable balance for a HaloPSA client. Resolves the linked customer via halopsa_get_client accountsid, then returns { halo, qbo: {id, balance, url}, aging: {current, days_1_30, days_31_60, days_61_90, days_over_90}, openInvoices }. openInvoices (Balance > 0, up to 200) each carry id, docNumber, dueDate, balance, daysOverdue, url. Aging buckets sum invoice balances by days past DueDate; invoices without a DueDate count as current. Returns halo_link_missing if the client is not synced to QuickBooks.',
    keywords: [
      'quickbooks',
      'halopsa',
      'halo',
      'invoice',
      'aging',
      'ar',
      'accounts receivable',
      'overdue',
      'owed',
      'outstanding',
    ],
    params: { halo_client_id: z.number().describe('HaloPSA client id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const lookup = await loadHaloAndAccountsid(ctx, args.halo_client_id)
      if ('error' in lookup) {
        return lookup
      }
      const client = await getQboClient(ctx)
      const customerResult = await client.get<{ Customer: QboCustomer }>(`customer/${lookup.accountsid}`)
      // direct entity read faults 610 object not found when the id isn't in this realm
      if (isQboError(customerResult) && !(customerResult.error === 'qbo_api_error' && customerResult.code === '610')) {
        return customerResult
      }
      if (isQboError(customerResult) || !customerResult.Customer?.Id) {
        return {
          error: 'halo_link_missing',
          halo_client_id: args.halo_client_id,
          message: `HaloPSA client ${args.halo_client_id} has accountsid=${lookup.accountsid} but no matching customer was returned from QuickBooks (active env: ${client.environment}). The accountsid may belong to a different QBO realm.`,
        }
      }
      const invoicesResult = await client.query<InvoiceListResponse>(
        `SELECT * FROM Invoice WHERE CustomerRef = '${String(lookup.accountsid).replace(/'/g, "''")}' AND Balance > '0' MAXRESULTS 200`,
      )
      if (isQboError(invoicesResult)) {
        return invoicesResult
      }
      const invoices = invoicesResult.QueryResponse?.Invoice ?? []
      const today = new Date()
      const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
      const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0 }
      const openInvoices = invoices.map((inv) => {
        const dueMs = inv.DueDate ? Date.parse(inv.DueDate) : todayMs
        const daysOverdue = Math.max(0, Math.floor((todayMs - dueMs) / 86_400_000))
        const balance = inv.Balance ?? 0
        bucketByOverdue(daysOverdue, balance, buckets)
        return qboInvoiceUrl(
          { id: inv.Id, docNumber: inv.DocNumber ?? null, dueDate: inv.DueDate ?? null, balance, daysOverdue },
          client.environment,
        )
      })
      const qboSummary = qboCustomerUrl(
        { id: customerResult.Customer.Id, balance: customerResult.Customer.Balance ?? 0 },
        client.environment,
      )
      return {
        halo: { id: lookup.halo.id, name: lookup.halo.name ?? null },
        qbo: qboSummary,
        aging: buckets,
        openInvoices,
      }
    },
  }),
]
