import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError } from '../client.js'
import { pickFields, QBO_RECURRING_LIST_FIELDS } from '../fields.js'

interface RecurringInfo {
  Name?: string
  RecurType?: string
  Active?: boolean
  ScheduleInfo?: {
    IntervalType?: string
    NumInterval?: number
    StartDate?: string
    NextDate?: string
  }
}

interface RecurringTxnBody {
  Id?: string
  TotalAmt?: number
  CustomerRef?: { value: string; name?: string }
  VendorRef?: { value: string; name?: string }
  RecurringInfo?: RecurringInfo
}

// each array element is a one-key wrapper: { Bill: {...} }, { Invoice: {...} }, etc.
type RecurringWrapper = Record<string, RecurringTxnBody>

interface ListResponse {
  QueryResponse?: { RecurringTransaction?: RecurringWrapper[] }
}

function unwrap(wrapper: RecurringWrapper): { type: string; body: RecurringTxnBody } {
  const type = Object.keys(wrapper)[0] ?? ''
  return { type, body: wrapper[type] ?? {} }
}

function toCamel(wrapper: RecurringWrapper): Record<string, unknown> {
  const { type, body } = unwrap(wrapper)
  const info = body.RecurringInfo ?? {}
  const sched = info.ScheduleInfo ?? {}
  return {
    id: body.Id ?? null,
    name: info.Name ?? null,
    type,
    scheduleType: info.RecurType ?? null,
    intervalType: sched.IntervalType ?? null,
    numInterval: sched.NumInterval ?? null,
    startDate: sched.StartDate ?? null,
    nextDate: sched.NextDate ?? null,
    customerRef: body.CustomerRef ?? null,
    vendorRef: body.VendorRef ?? null,
    totalAmt: body.TotalAmt ?? 0,
    active: info.Active ?? true,
  }
}

export const recurringTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_recurring_transactions',
    description:
      'List QBO recurring transaction templates (memorized transactions). Fetches up to 1000 templates in one pass, no pagination; transaction_type (template entity type, e.g. Bill, Invoice, JournalEntry) and active_only (default true) filter the result. Returns per template: id, name, type, scheduleType, intervalType, numInterval, startDate, nextDate, customerRef, vendorRef, totalAmt, active.',
    keywords: ['quickbooks', 'template', 'memorized', 'scheduled', 'subscription', 'schedule'],
    params: {
      transaction_type: z.string().optional().describe('Filter by template type, e.g. Bill, Invoice, JournalEntry'),
      active_only: z.boolean().optional().default(true).describe('Only include active templates (default true)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.query<ListResponse>('SELECT * FROM RecurringTransaction MAXRESULTS 1000')
      if (isQboError(result)) {
        return result
      }
      const wrappers = result.QueryResponse?.RecurringTransaction ?? []
      let rows = wrappers.map(toCamel)
      if (args.transaction_type) {
        rows = rows.filter((r) => r.type === args.transaction_type)
      }
      if (args.active_only !== false) {
        rows = rows.filter((r) => r.active === true)
      }
      return { recurringTransactions: rows.map((r) => pickFields(r, QBO_RECURRING_LIST_FIELDS)) }
    },
  }),

  defineTool({
    name: 'qbo_get_recurring_transaction',
    description:
      'Get one QBO recurring transaction template by recurring_transaction_id. Returns the raw RecurringTransaction object: the wrapped entity (e.g. Invoice, Bill) with full line items plus RecurringInfo schedule detail.',
    keywords: ['quickbooks', 'template', 'memorized', 'schedule'],
    params: { recurring_transaction_id: z.string().describe('QBO RecurringTransaction Id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.get<{ RecurringTransaction: Record<string, unknown> }>(
        `recurringtransaction/${encodeURIComponent(args.recurring_transaction_id)}`,
      )
      if (isQboError(result)) {
        return result
      }
      return result.RecurringTransaction
    },
  }),
]
