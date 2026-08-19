import { defineTool, z, trimResponse, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { executeListRecurringInvoices } from '../active-lists.js'
import {
  pickFields,
  INVOICE_DETAIL_FIELDS,
  RECURRING_INVOICE_DETAIL_FIELDS,
  RECURRING_INVOICE_LINE_FIELDS,
  GENERATED_INVOICE_SUMMARY_FIELDS,
  SUBSCRIPTION_LIST_FIELDS,
  SOFTWARE_LICENSE_LIST_FIELDS,
  haloInvoiceUrl,
  haloRecurringInvoiceUrl,
  haloLicenceClientUrl,
} from '../fields.js'

// shared by list_subscriptions (licence_type=1) and list_software_licenses (licence_type=0)
async function listLicences(
  ctx: PluginContext,
  params: Record<string, unknown>,
  licenceType: number,
  fields: readonly string[],
) {
  const { include_inactive, ...apiParams } = params
  const client = await getClient(ctx)
  const result = (await client.getSoftwareLicences({ ...apiParams, licence_type: licenceType })) as Record<
    string,
    unknown
  >

  const key = Array.isArray(result.licences) ? 'licences' : null
  if (key && Array.isArray(result[key])) {
    let items = result[key] as Record<string, unknown>[]
    if (!include_inactive) {
      items = items.filter((lic) => lic.is_active !== false)
    }
    const trimmed = items.map((lic) => pickFields(haloLicenceClientUrl(lic, client), [...fields, 'url']))
    return trimResponse({
      page_no: result.page_no,
      page_size: result.page_size,
      record_count: result.record_count,
      returned: trimmed.length,
      licences: trimmed,
    })
  }

  return trimResponse(result)
}

export const billingTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_recurring_invoices',
    description:
      'List HaloPSA recurring invoice templates. Returns ENABLED templates by default (counts in active_count/total_in_system; the active rule rides in active_rule). Set include_disabled=true to include disabled templates. Filter by client or search reference/notes; use get-by-ID for line item details.',
    keywords: ['halopsa', 'recurring invoice', 'billing', 'list'],
    params: {
      client_id: z.number().optional().describe('Filter by client ID'),
      search: z.string().optional().describe('Search by reference or notes'),
      include_disabled: z.boolean().optional().default(false).describe('Include disabled invoices (default false)'),
      page_size: z.number().optional().default(50).describe('Results per page (default 50, max 100)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => executeListRecurringInvoices(ctx, params),
  }),

  defineTool({
    name: 'halopsa_get_recurring_invoice',
    description:
      'Get a HaloPSA recurring invoice template by ID (negative number). This is a billing template: the "lines" array shows current line items with cost/sell prices. The "invoices" array contains the actual generated invoices with real amounts billed each month. Use the invoices array to analyze billing history and trends.',
    keywords: ['halopsa', 'recurring invoice', 'billing', 'get', 'detail'],
    params: {
      id: z.number().describe('The recurring invoice ID (negative number)'),
      include_inactive_lines: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include inactive/completed line items such as prior one-time charges (default false)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getRecurringInvoiceById(params.id)) as Record<string, unknown>
      const item = haloRecurringInvoiceUrl(result, client) as Record<string, unknown>

      if (Array.isArray(item.lines)) {
        let lines = item.lines as Record<string, unknown>[]
        if (!params.include_inactive_lines) {
          // halo uses two different fields/polarities: isinactive (true=inactive) and isActive (false=inactive)
          lines = lines.filter((line) => line.isinactive !== true && line.isActive !== false)
        }
        item.lines = lines.map((line) => pickFields(line, RECURRING_INVOICE_LINE_FIELDS))
      }

      if (Array.isArray(item.invoices)) {
        item.invoices = (item.invoices as Record<string, unknown>[]).map((inv) =>
          pickFields(inv, GENERATED_INVOICE_SUMMARY_FIELDS),
        )
      }

      return trimResponse(pickFields(item, [...RECURRING_INVOICE_DETAIL_FIELDS, 'url']))
    },
  }),

  defineTool({
    name: 'halopsa_get_invoice',
    description:
      'Get a specific HaloPSA generated invoice by ID (positive number). These are actual invoices sent to clients, with real amounts, payment status, and billing period. Includes line items with cost/sell prices.',
    keywords: ['halopsa', 'invoice', 'billing', 'get', 'detail'],
    params: {
      id: z.number().describe('The invoice ID (positive number)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getInvoiceById(params.id)) as Record<string, unknown>
      const item = haloInvoiceUrl(result, client) as Record<string, unknown>

      if (Array.isArray(item.lines)) {
        item.lines = (item.lines as Record<string, unknown>[]).map((line) =>
          pickFields(line, RECURRING_INVOICE_LINE_FIELDS),
        )
      }

      return trimResponse(pickFields(item, [...INVOICE_DETAIL_FIELDS, 'url']))
    },
  }),

  defineTool({
    name: 'halopsa_list_subscriptions',
    description:
      'List HaloPSA subscriptions (e.g. Microsoft 365, Acronis, Pax8 products). Filter by client, search, or active status. Shows quantity, sell price, and cost.',
    keywords: ['halopsa', 'subscription', 'billing', 'list'],
    params: {
      client_id: z.number().optional().describe('Filter by client ID'),
      search: z.string().optional().describe('Search by subscription name'),
      include_inactive: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include inactive subscriptions (default false)'),
      page_size: z.number().optional().default(50).describe('Results per page (default 50)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => listLicences(ctx, params, 1, SUBSCRIPTION_LIST_FIELDS),
  }),

  defineTool({
    name: 'halopsa_get_subscription',
    description: 'Get detailed information about a specific HaloPSA subscription by ID.',
    keywords: ['halopsa', 'subscription', 'billing', 'get', 'detail'],
    params: {
      id: z.number().describe('The subscription ID'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getSoftwareLicenceById(params.id)) as Record<string, unknown>
      // /SoftwareLicence/{id} serves both kinds, record type mirrors licence_type (1=subscription, 0=license)
      if (Number(result.type) === 0) {
        return `Record ${params.id} is a software license, not a subscription. Use halopsa_get_software_license.`
      }
      return haloLicenceClientUrl(result, client)
    },
  }),

  defineTool({
    name: 'halopsa_list_software_licenses',
    description:
      'List HaloPSA software licenses (e.g. Microsoft 365 license assignments synced from Azure AD). Filter by client, search, or active status. Includes consumed count and manufacturer.',
    keywords: ['halopsa', 'software license', 'billing', 'list'],
    params: {
      client_id: z.number().optional().describe('Filter by client ID'),
      search: z.string().optional().describe('Search by license name'),
      include_inactive: z.boolean().optional().default(false).describe('Include inactive licenses (default false)'),
      page_size: z.number().optional().default(50).describe('Results per page (default 50)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => listLicences(ctx, params, 0, SOFTWARE_LICENSE_LIST_FIELDS),
  }),

  defineTool({
    name: 'halopsa_get_software_license',
    description: 'Get detailed information about a specific HaloPSA software license by ID.',
    keywords: ['halopsa', 'software license', 'billing', 'get', 'detail'],
    params: {
      id: z.number().describe('The software license ID'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = (await client.getSoftwareLicenceById(params.id)) as Record<string, unknown>
      // /SoftwareLicence/{id} serves both kinds, record type mirrors licence_type (1=subscription, 0=license)
      if (Number(result.type) === 1) {
        return `Record ${params.id} is a subscription, not a software license. Use halopsa_get_subscription.`
      }
      return haloLicenceClientUrl(result, client)
    },
  }),
]
