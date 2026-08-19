import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError, type QboErrorEnvelope } from '../client.js'
import { pickFields, QBO_INVOICE_LIST_FIELDS } from '../fields.js'
import { qboInvoiceUrl } from '../urls.js'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

interface QboInvoice {
  Id: string
  DocNumber?: string
  CustomerRef?: { value: string; name?: string }
  TxnDate?: string
  DueDate?: string
  TotalAmt?: number
  Balance?: number
}

interface ListResponse {
  QueryResponse?: { Invoice?: QboInvoice[] }
}

type StatusFilter = 'open' | 'paid' | 'overdue' | 'all'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function deriveStatus(inv: QboInvoice, today: string): 'paid' | 'open' | 'overdue' | 'unknown' {
  if (inv.Balance == null) {
    // absent balance is not proof of payment
    return 'unknown'
  }
  if (inv.Balance === 0) {
    return 'paid'
  }
  if (inv.DueDate && inv.DueDate < today) {
    return 'overdue'
  }
  return 'open'
}

function toCamel(inv: QboInvoice, today: string): Record<string, unknown> {
  return {
    id: inv.Id,
    docNumber: inv.DocNumber ?? null,
    customerRef: inv.CustomerRef ?? null,
    txnDate: inv.TxnDate ?? null,
    dueDate: inv.DueDate ?? null,
    totalAmt: inv.TotalAmt ?? 0,
    balance: inv.Balance ?? 0,
    status: deriveStatus(inv, today),
  }
}

export const invoiceTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_invoices',
    description:
      'List QBO customer invoices with optional customer_id, date range (date_from/date_to, ISO YYYY-MM-DD, bounds TxnDate), and status filters. status: "open" (Balance > 0), "paid" (Balance = 0), "overdue" (Balance > 0 and DueDate < today), "all" (default). Paged via page/page_size (default 25) with hasMore; the overdue filter applies after paging, so an overdue page can hold fewer rows than page_size. Returns per invoice: id, docNumber, customerRef, txnDate, dueDate, totalAmt, balance, derived status, and a url deep link.',
    keywords: ['quickbooks', 'invoice', 'customer', 'balance', 'billing', 'accounts receivable', 'ar', 'owed'],
    params: {
      customer_id: z.string().optional().describe('Filter to one customer Id'),
      status: z.enum(['open', 'paid', 'overdue', 'all']).optional().default('all'),
      date_from: z.string().optional().describe('ISO date, TxnDate >='),
      date_to: z.string().optional().describe('ISO date, TxnDate <='),
      page: z.number().optional().default(1).describe('1-indexed page number'),
      page_size: z.number().optional().default(25).describe('Page size 1-100, default 25'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      if (args.date_from && !isIsoDate(args.date_from)) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_date',
          detail: 'date_from must be ISO YYYY-MM-DD',
        }
        return envelope
      }
      if (args.date_to && !isIsoDate(args.date_to)) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_date',
          detail: 'date_to must be ISO YYYY-MM-DD',
        }
        return envelope
      }

      const page = Math.max(1, Math.floor(args.page ?? 1))
      const pageSize = Math.min(100, Math.max(1, Math.floor(args.page_size ?? 25)))
      const startPosition = (page - 1) * pageSize + 1
      const status = (args.status ?? 'all') as StatusFilter

      const where: string[] = []
      if (args.customer_id) {
        where.push(`CustomerRef = '${args.customer_id.replace(/'/g, "''")}'`)
      }
      if (args.date_from) {
        where.push(`TxnDate >= '${args.date_from}'`)
      }
      if (args.date_to) {
        where.push(`TxnDate <= '${args.date_to}'`)
      }
      if (status === 'open' || status === 'overdue') {
        where.push(`Balance > '0'`)
      } else if (status === 'paid') {
        where.push(`Balance = '0'`)
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const sql = `SELECT * FROM Invoice ${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
        .replace(/\s+/g, ' ')
        .trim()

      const client = await getQboClient(ctx)
      const result = await client.query<ListResponse>(sql)
      if (isQboError(result)) {
        return result
      }

      const today = todayIso()
      const raw = result.QueryResponse?.Invoice ?? []
      // pre-filter, server returned a full page so more may exist
      const hasMore = raw.length === pageSize
      let items = raw.map((i) =>
        pickFields(qboInvoiceUrl(toCamel(i, today), client.environment), QBO_INVOICE_LIST_FIELDS),
      )
      if (status === 'overdue') {
        items = items.filter((i) => i.status === 'overdue')
      }
      return { invoices: items, hasMore }
    },
  }),

  defineTool({
    name: 'qbo_get_invoice',
    description:
      'Get one QBO invoice by invoice_id. Returns the raw QBO Invoice object including line items and linked transactions, plus a url deep link.',
    keywords: ['quickbooks', 'billing', 'line items', 'balance'],
    params: { invoice_id: z.string().describe('QBO Invoice Id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.get<{ Invoice: Record<string, unknown> }>(
        `invoice/${encodeURIComponent(args.invoice_id)}`,
      )
      if (isQboError(result)) {
        return result
      }
      return qboInvoiceUrl(result.Invoice, client.environment)
    },
  }),
]
