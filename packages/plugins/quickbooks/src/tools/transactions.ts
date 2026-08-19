import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError, type QboErrorEnvelope } from '../client.js'
import { pickFields, QBO_TRANSACTION_LIST_FIELDS } from '../fields.js'
import { qboTransactionUrl } from '../urls.js'

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// canonical QBO entity names, used by qbo_get_transaction and as each row's entityType.
// NOT the same vocabulary as the report filter enum below.
export const TRANSACTION_TYPES = [
  'Invoice',
  'Bill',
  'JournalEntry',
  'Deposit',
  'Purchase',
  'Transfer',
  'CreditMemo',
  'VendorCredit',
  'Payment',
  'BillPayment',
  'SalesReceipt',
  'RefundReceipt',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

// QBO's TransactionDetailByAccount transaction_type filter enum, probe-verified.
// Distinct from the entity names: QBO has no single filter value for the Purchase or Payment entities.
const REPORT_TXN_TYPES = [
  'Bill',
  'BillPaymentCheck',
  'BillPaymentCreditCard',
  'CashPurchase',
  'Check',
  'CreditCardCharge',
  'CreditCardCredit',
  'CreditMemo',
  'Deposit',
  'Estimate',
  'InventoryQuantityAdjustment',
  'Invoice',
  'JournalEntry',
  'PurchaseOrder',
  'SalesReceipt',
  'TimeActivity',
  'Transfer',
  'VendorCredit',
] as const

const CLEARED_STATUSES = ['Reconciled', 'Cleared', 'Uncleared'] as const

// the report labels rows with display names; the per-type REST endpoints used by
// qbo_get_transaction key off canonical entity names.
const DISPLAY_TO_ENTITY: Record<string, TransactionType> = {
  Invoice: 'Invoice',
  Payment: 'Payment',
  Bill: 'Bill',
  'Bill Payment (Check)': 'BillPayment',
  'Bill Payment (Credit Card)': 'BillPayment',
  Cheque: 'Purchase',
  Expense: 'Purchase',
  'Credit Card Expense': 'Purchase',
  'Cash Expense': 'Purchase',
  Deposit: 'Deposit',
  Transfer: 'Transfer',
  'Journal Entry': 'JournalEntry',
  'Credit Memo': 'CreditMemo',
  'Vendor Credit': 'VendorCredit',
  'Sales Receipt': 'SalesReceipt',
  Refund: 'RefundReceipt',
}

export function displayToEntity(displayType: string): TransactionType | null {
  return DISPLAY_TO_ENTITY[displayType] ?? null
}

const COLTYPE_TO_KEY: Record<string, string> = {
  tx_date: 'date',
  txn_type: 'type',
  doc_num: 'docNum',
  name: 'name',
  memo: 'memo',
  split_acc: 'splitAccount',
  subt_nat_amount: 'amount',
  rbal_nat_amount: 'balance',
}

interface ReportColumn {
  ColTitle?: string
  ColType?: string
}
interface ColDatum {
  value?: string
  id?: string
}
export interface ReportRow {
  ColData?: ColDatum[]
  type?: string
  Header?: { ColData?: ColDatum[] }
  Rows?: { Row?: ReportRow[] }
}
interface TransactionDetailReport {
  Header?: { StartPeriod?: string; EndPeriod?: string }
  Columns?: { Column?: ReportColumn[] }
  Rows?: { Row?: ReportRow[] }
}

export interface FlatRow {
  row: ReportRow
  account: string | null
  accountId: string | null
}

// TransactionDetailByAccount groups rows into per-account sections, which can nest into
// sub-account sections. Walk the tree, carrying the nearest enclosing section's account down
// to every Data leaf. Summary-only rows have no Rows and are skipped.
export function flattenSections(
  rows: ReportRow[],
  account: string | null = null,
  accountId: string | null = null,
): FlatRow[] {
  const out: FlatRow[] = []
  for (const row of rows) {
    if (row.type === 'Data') {
      out.push({ row, account, accountId })
    } else if (row.Rows?.Row) {
      const cell = row.Header?.ColData?.[0]
      // a section's own header defines its account; when the header carries no id (QBO omits it
      // for some sub-accounts) accountId is null, not the parent's id, which would be a wrong pairing
      const sectionAccountId = cell ? (cell.id ?? null) : accountId
      out.push(...flattenSections(row.Rows.Row, cell?.value || account, sectionAccountId))
    }
  }
  return out
}

function mapRow(flat: FlatRow, columns: ReportColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const cols = flat.row.ColData ?? []
  for (let i = 0; i < columns.length; i++) {
    const colType = columns[i]?.ColType ?? ''
    const key = COLTYPE_TO_KEY[colType]
    if (!key) {
      continue
    }
    const datum = cols[i] ?? {}
    out[key] = datum.value === '' || datum.value === undefined ? null : datum.value
    if (colType === 'txn_type') {
      out.txnId = datum.id || null
    } else if (colType === 'name') {
      out.nameId = datum.id || null
    }
  }
  out.account = flat.account
  out.accountId = flat.accountId
  const displayType = typeof out.type === 'string' ? out.type : ''
  out.entityType = displayToEntity(displayType)
  return out
}

const TYPE_TO_ENDPOINT: Record<TransactionType, string> = {
  Invoice: 'invoice',
  Payment: 'payment',
  Bill: 'bill',
  JournalEntry: 'journalentry',
  Deposit: 'deposit',
  Purchase: 'purchase',
  Transfer: 'transfer',
  CreditMemo: 'creditmemo',
  VendorCredit: 'vendorcredit',
  SalesReceipt: 'salesreceipt',
  RefundReceipt: 'refundreceipt',
  BillPayment: 'billpayment',
}

export const transactionTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_transactions',
    description:
      "List QBO transactions of every type for a required date range (date_from/date_to, ISO YYYY-MM-DD), built from the TransactionDetailByAccount report (the account-register view). account_id, transaction_type, and cleared_status push down to QBO as server-side filters. transaction_type uses QBO's report enum (Bill, BillPaymentCheck, BillPaymentCreditCard, CashPurchase, Check, CreditCardCharge, CreditCardCredit, CreditMemo, Deposit, Estimate, InventoryQuantityAdjustment, Invoice, JournalEntry, PurchaseOrder, SalesReceipt, TimeActivity, Transfer, VendorCredit), which differs from the canonical entity names. Each row carries date, type, docNum, name, account, splitAccount, amount, balance, plus txnId and entityType (the canonical name): pass those two to qbo_get_transaction for full detail. The report does not paginate; max_rows (default 500) caps output and hasMore flags truncation.",
    keywords: ['quickbooks', 'register', 'ledger', 'activity', 'history', 'bank', 'expense'],
    params: {
      date_from: z.string().describe('ISO date YYYY-MM-DD, start of the range (required)'),
      date_to: z.string().describe('ISO date YYYY-MM-DD, end of the range (required)'),
      account_id: z.string().optional().describe('Filter to one QBO Account Id'),
      transaction_type: z.enum(REPORT_TXN_TYPES).optional().describe('Filter by QBO report transaction type'),
      cleared_status: z.enum(CLEARED_STATUSES).optional().describe('Filter by bank-reconciliation status'),
      max_rows: z.number().optional().default(500).describe('Cap on returned rows, 1-5000, default 500'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      if (!isIsoDate(args.date_from)) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_date',
          detail: 'date_from is required and must be ISO YYYY-MM-DD',
        }
        return envelope
      }
      if (!isIsoDate(args.date_to)) {
        const envelope: QboErrorEnvelope = {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_date',
          detail: 'date_to is required and must be ISO YYYY-MM-DD',
        }
        return envelope
      }
      const maxRows = Math.min(5000, Math.max(1, Math.floor(args.max_rows ?? 500)))

      // TransactionDetailByAccount honors account, transaction_type, and cleared as server-side
      // filters (probe-verified), so all three push down.
      const params: Record<string, string> = { start_date: args.date_from, end_date: args.date_to }
      if (args.account_id) {
        params.account = args.account_id
      }
      if (args.transaction_type) {
        params.transaction_type = args.transaction_type
      }
      if (args.cleared_status) {
        params.cleared = args.cleared_status
      }

      const client = await getQboClient(ctx)
      const result = await client.get<TransactionDetailReport>('reports/TransactionDetailByAccount', params)
      if (isQboError(result)) {
        return result
      }
      const columns = result.Columns?.Column ?? []
      const allRows = flattenSections(result.Rows?.Row ?? [])
      const hasMore = allRows.length > maxRows
      const sliced = hasMore ? allRows.slice(0, maxRows) : allRows
      const transactions = sliced.map((r) => pickFields(mapRow(r, columns), QBO_TRANSACTION_LIST_FIELDS))
      return {
        transactions,
        reportPeriod: {
          from: result.Header?.StartPeriod ?? args.date_from,
          to: result.Header?.EndPeriod ?? args.date_to,
        },
        returnedRows: transactions.length,
        hasMore,
      }
    },
  }),

  defineTool({
    name: 'qbo_get_transaction',
    description:
      'Get one QBO transaction by canonical entity type and Id. transaction_type is one of Invoice, Bill, JournalEntry, Deposit, Purchase, Transfer, CreditMemo, VendorCredit, Payment, BillPayment, SalesReceipt, RefundReceipt (the entityType field on qbo_list_transactions rows; transaction_id is the row txnId). Returns the raw QBO object including line items and LinkedTxn refs, plus a url deep link.',
    keywords: ['quickbooks', 'bill', 'deposit', 'journal entry', 'expense', 'line items'],
    params: {
      transaction_type: z.enum(TRANSACTION_TYPES).describe('Canonical QBO transaction entity name'),
      transaction_id: z.string().describe('QBO transaction Id'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.get<Record<string, unknown>>(
        `${TYPE_TO_ENDPOINT[args.transaction_type]}/${encodeURIComponent(args.transaction_id)}`,
      )
      if (isQboError(result)) {
        return result
      }
      // QBO wraps the entity under a PascalCase key matching the canonical type name; the
      // fallback returns the raw result for any anomalous bare-entity response.
      const entity = (result[args.transaction_type] as Record<string, unknown> | undefined) ?? result
      return qboTransactionUrl(args.transaction_type, entity, client.environment)
    },
  }),
]
