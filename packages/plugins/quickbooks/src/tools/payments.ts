import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError, type QboErrorEnvelope } from '../client.js'
import { pickFields, QBO_PAYMENT_LIST_FIELDS } from '../fields.js'
import { qboPaymentUrl } from '../urls.js'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

interface QboPayment {
  Id: string
  CustomerRef?: { value: string; name?: string }
  TxnDate?: string
  TotalAmt?: number
  UnappliedAmt?: number
  PaymentMethodRef?: { value: string }
}

interface ListResponse {
  QueryResponse?: { Payment?: QboPayment[] }
}

function toCamel(p: QboPayment): Record<string, unknown> {
  return {
    id: p.Id,
    customerRef: p.CustomerRef ?? null,
    txnDate: p.TxnDate ?? null,
    totalAmt: p.TotalAmt ?? 0,
    unappliedAmt: p.UnappliedAmt ?? 0,
    paymentMethodRef: p.PaymentMethodRef ?? null,
  }
}

export const paymentTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_payments',
    description:
      'List QBO customer payments (money received, the Payment entity; vendor bill payments are a transaction type, see qbo_list_transactions). Optional customer_id and date range (date_from/date_to, ISO YYYY-MM-DD, bounds TxnDate) filters. Paged via page/page_size (default 25) with hasMore. Returns per payment: id, customerRef, txnDate, totalAmt, unappliedAmt, paymentMethodRef, and a url deep link.',
    keywords: ['quickbooks', 'received', 'receipt', 'accounts receivable', 'ar', 'remittance', 'customer'],
    params: {
      customer_id: z.string().optional().describe('Filter to one customer Id'),
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
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const sql = `SELECT * FROM Payment ${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
        .replace(/\s+/g, ' ')
        .trim()

      const client = await getQboClient(ctx)
      const result = await client.query<ListResponse>(sql)
      if (isQboError(result)) {
        return result
      }
      const raw = result.QueryResponse?.Payment ?? []
      const hasMore = raw.length === pageSize
      const items = raw.map((p) => pickFields(qboPaymentUrl(toCamel(p), client.environment), QBO_PAYMENT_LIST_FIELDS))
      return { payments: items, hasMore }
    },
  }),

  defineTool({
    name: 'qbo_get_payment',
    description:
      'Get one QBO customer payment by payment_id. Returns the raw QBO Payment object including lines with LinkedTxn refs to the invoices it was applied against, plus a url deep link.',
    keywords: ['quickbooks', 'receipt', 'received', 'applied', 'remittance'],
    params: { payment_id: z.string().describe('QBO Payment Id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.get<{ Payment: Record<string, unknown> }>(
        `payment/${encodeURIComponent(args.payment_id)}`,
      )
      if (isQboError(result)) {
        return result
      }
      return qboPaymentUrl(result.Payment, client.environment)
    },
  }),
]
