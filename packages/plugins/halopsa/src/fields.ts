// field allow-lists + trimming utilities for HaloPSA API responses. raw responses
// carry 50-150+ fields per object; these lists keep only what's useful for AI consumption.

// Tickets
export const TICKET_LIST_FIELDS = [
  'id',
  'url',
  'summary',
  'status_id',
  'status_name',
  'tickettype_id',
  'client_id',
  'client_name',
  'site_id',
  'site_name',
  'user_id',
  'user_name',
  'user_email',
  'agent_id',
  'team',
  'priority_id',
  'category_1',
  'dateoccurred',
  'respondbydate',
  'fixbydate',
  'lastactiondate',
  'dateclosed',
  'onhold',
  'flagged',
  'slastate',
  'merged_into_id',
  'child_count',
  'parent_id',
  // opportunity/lead fields (present when ticket is an opportunity)
  'oppvalueadjusted',
  'targetdate',
  'pipeline_stage_id',
  'cost',
] as const

export const TICKET_DETAIL_FIELDS = [
  ...TICKET_LIST_FIELDS,
  'details',
  'sla_id',
  'department_id',
  'reportedby',
  'source',
  'source_name',
  'impact',
  'urgency',
  'dateassigned',
  'date_fully_closed',
  'merged_into_id',
  'child_count',
  'attachment_count',
  'workflow_id',
  'workflow_step',
] as const

// Clients
export const CLIENT_LIST_FIELDS = [
  'id',
  'url',
  'name',
  'toplevel_id',
  'toplevel_name',
  'inactive',
  'client_type',
  'pritech',
  'sectech',
  'accountmanagertech',
  'customertype',
  'is_vip',
  'ref',
] as const

export const CLIENT_DETAIL_FIELDS = [
  ...CLIENT_LIST_FIELDS,
  'main_site_name',
  'website',
  'accountsemailaddress',
  'accountsccemailaddress',
  'accountsfirstname',
  'accountslastname',
  'accountsid',
  'datecreated',
  'customfields',
  'notes',
  'popup_notes',
  'callhandlingnotes',
  'colour',
  'ninjarmmid',
  'itglue_id',
  'stopped',
] as const

// Users
export const USER_LIST_FIELDS = [
  'id',
  'url',
  'name',
  'emailaddress',
  'email2',
  'client_id',
  'client_name',
  'site_id',
  'site_name',
  'inactive',
  'isserviceaccount',
] as const

// Assets
export const ASSET_LIST_FIELDS = [
  'id',
  'url',
  'key_field',
  'key_field2',
  'key_field3',
  'client_id',
  'client_name',
  'site_id',
  'site_name',
  'assettype_id',
  'assettype_name',
  'status_id',
  'inactive',
  'device_number',
  'ninjarmm_id',
  'item_name',
  'sla_id',
  'priority_id',
] as const

export const ASSET_DETAIL_FIELDS = [
  ...ASSET_LIST_FIELDS,
  'business_owner_id',
  'business_owner_name',
  'technical_owner_id',
  'technical_owner_name',
  'username',
  'supplier_id',
  'manufacturer_id',
  'supplier_contract_id',
  'criticality',
  'datto_id',
  'datto_url',
  'itglue_url',
  'automate_id',
  'syncroid',
] as const

// Actions
export const ACTION_FIELDS = [
  'id',
  'ticket_id',
  'who',
  'who_agentid',
  'who_type',
  'datetime',
  'note',
  'outcome',
  'outcome_id',
  'old_status',
  'new_status',
  'new_status_name',
  'timetakendays',
  'timetakenadjusted',
  'actisbillable',
  'actionchargehours',
  'actionchargeamount',
  'hiddenfromuser',
  'important',
  'attachment_count',
] as const

// Attachments
export const ATTACHMENT_FIELDS = [
  'id',
  'filename',
  'desc',
  'filesize',
  'content_type',
  'datecreated',
  'isimage',
  'type',
  'unique_id',
  'ticket_id',
  'link',
] as const

// Contracts
export const CONTRACT_LIST_FIELDS = [
  'id',
  'ref',
  'client_id',
  'client_name',
  'start_date',
  'end_date',
  'contract_status',
  'active',
  'status',
  'expired',
  'contracttype_name',
  'next_invoice_date',
] as const

export const CONTRACT_DETAIL_FIELDS = [
  ...CONTRACT_LIST_FIELDS,
  'billingperiod',
  'billingdescription',
  'periodchargeamount',
  'numberofunitsfree',
  'site_name',
  'subtype',
  'status',
] as const

// Invoices (generated/actual)
export const INVOICE_DETAIL_FIELDS = [
  'id',
  'client_id',
  'client_name',
  'reference',
  'notes_1',
  'invoice_date',
  'duedate',
  'period_start_date',
  'period_end_date',
  'amountpaid',
  'amountdue',
  'posted',
  'paymentstatus',
  'recurring_invoice_id',
  'contract_id',
  'contract_ref',
  'lines',
] as const

// Recurring Invoices
export const RECURRING_INVOICE_LIST_FIELDS = [
  'id',
  'client_id',
  'client_name',
  'notes_1',
  'reference',
  'amountdue',
  'total',
  'contract_id',
  'contract_ref',
  'disabled',
  'lastcreated',
  'nextcreationdate',
  'period',
  'last_invoiced_revenue',
] as const

export const RECURRING_INVOICE_DETAIL_FIELDS = [...RECURRING_INVOICE_LIST_FIELDS, 'lines', 'invoices'] as const

// fields to keep on each generated invoice inside the recurring invoice detail
export const GENERATED_INVOICE_SUMMARY_FIELDS = [
  'id',
  'invoice_date',
  'amountpaid',
  'amountdue',
  'paymentstatus',
  'period_start_date',
  'period_end_date',
  'posted',
] as const

export const RECURRING_INVOICE_LINE_FIELDS = [
  'item_shortdescription',
  'item_longdescription',
  'qty_order',
  'unit_price',
  'unit_cost',
  'net_amount',
  'tax_amount',
  '_itemid',
  'nominal_code_item',
] as const

// Subscriptions & Software Licenses
export const SUBSCRIPTION_LIST_FIELDS = [
  'id',
  'name',
  'count',
  'client_id',
  'client_name',
  'price',
  'purchase_price',
  'monthly_price',
  'monthly_cost',
  'distributor',
  'billing_cycle',
  'status',
  'is_active',
  'product_sku',
  'start_date',
  'end_date',
  'term_duration',
] as const

export const SOFTWARE_LICENSE_LIST_FIELDS = [
  ...SUBSCRIPTION_LIST_FIELDS,
  'consumedcount',
  'manufacturer',
  'azure_connection_id',
  'vendor_product_sku',
] as const

// Deep link generators
type HaloClient = { baseUrl: string }

export const haloTicketUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/ticket?id=${item.id}`,
})

export const haloClientUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/customer?clientid=${item.id}`,
})

export const haloUserUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/customer?userid=${item.id}`,
})

export const haloAssetUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/assets?id=${item.id}`,
})

export const haloContractUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/contract?contractid=${item.id}`,
})

export const haloInvoiceUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/invoices?invoiceid=${item.id}&mainview=invoices`,
})

export const haloRecurringInvoiceUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/invoices?mainview=rinvoices&rinvoiceid=${item.id}`,
})

export const haloLicenceClientUrl = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/customer?clientid=${item.client_id}`,
})

export const haloDashboardUrls = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/dashboard?id=${item.id}`,
  config_url: `${client.baseUrl}/config/reports/dashboards?id=${item.id}`,
})

// two urls per entity: view page and config/editor page
export const haloReportUrls = (item: Record<string, unknown>, client: HaloClient) => ({
  ...item,
  url: `${client.baseUrl}/report?id=${item.id}`,
  config_url:
    item.group_id != null
      ? `${client.baseUrl}/reports?mainview=reportgroup&selid=${item.group_id}&sellevel=1&selparentid=all%20report%20groups&id=${item.id}`
      : `${client.baseUrl}/reports?id=${item.id}`,
})

// Trimming utilities
export function pickFields<T extends Record<string, unknown>>(obj: T, fields: readonly string[]): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const key of fields) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result as Partial<T>
}

// trim a paginated list response or single object. handles responses shaped as
// { record_count, <collection>: [...] } or plain objects. adds a summary string
// so the caller quotes the actual total instead of guessing from the page length.
export function trimList(data: unknown, collectionKey: string, fields: readonly string[]): unknown {
  if (data && typeof data === 'object' && collectionKey in data) {
    const d = data as Record<string, unknown>
    const items = Array.isArray(d[collectionKey]) ? (d[collectionKey] as Record<string, unknown>[]) : []
    const trimmed = items.map((item) => pickFields(item, fields))
    const total = Number(d.record_count ?? items.length)
    return {
      summary: `${total} total ${collectionKey} match this query. For "how many" questions, the answer is ${total}.`,
      page_no: d.page_no,
      page_size: d.page_size,
      record_count: d.record_count,
      [collectionKey]: trimmed,
    }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return pickFields(data as Record<string, unknown>, fields)
  }
  return data
}

// halo /report responses wrap as [{...envelope, report: {loaded, rows, base_link, table_html}}]
// table_html re-renders every row as html and the envelope carries ~40 chart-config fields; keep rows only
export function trimReportEnvelope(result: unknown): unknown {
  const trimOne = (env: unknown): unknown => {
    if (!env || typeof env !== 'object' || !('report' in (env as Record<string, unknown>))) {
      return env
    }
    const r = ((env as Record<string, unknown>).report ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = { rows: r.rows ?? [] }
    if (typeof r.load_error === 'string' && r.load_error.length > 0) {
      out.load_error = r.load_error
    }
    return { report: out }
  }
  return Array.isArray(result) ? result.map(trimOne) : trimOne(result)
}
