import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError } from '../client.js'

const REPORT_NAMES = [
  'AgedReceivables',
  'ProfitAndLoss',
  'BalanceSheet',
  'CustomerSales',
  'GeneralLedger',
  'TrialBalance',
  'JournalReport',
  'AgedPayables',
  'CashFlow',
  'TransactionDetailByAccount',
  'AccountList',
] as const
type ReportName = (typeof REPORT_NAMES)[number]

const POINT_IN_TIME: ReadonlySet<ReportName> = new Set(['BalanceSheet', 'AgedReceivables', 'AgedPayables'])

const SUMMARIZE_BY_VALID: Record<ReportName, ReadonlyArray<string>> = {
  AgedReceivables: [],
  BalanceSheet: ['Month', 'Quarter', 'Year'],
  ProfitAndLoss: ['Month', 'Quarter', 'Year', 'Customer', 'Class'],
  CustomerSales: ['Month', 'Quarter', 'Year'],
  GeneralLedger: [],
  TrialBalance: [],
  JournalReport: [],
  AgedPayables: [],
  CashFlow: ['Month', 'Quarter', 'Year'],
  TransactionDetailByAccount: [],
  AccountList: [],
}

const GENERAL_LEDGER_MAX_DAYS = 31

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return Number.POSITIVE_INFINITY
  }
  return Math.round((toMs - fromMs) / 86_400_000)
}

export const reportTools: ToolDef[] = [
  defineTool({
    name: 'qbo_get_report',
    description:
      'Run a QBO standard report and return the raw report JSON (Header, Columns, Rows). report_name: AgedReceivables | ProfitAndLoss | BalanceSheet | CustomerSales | GeneralLedger | TrialBalance | JournalReport | AgedPayables | CashFlow | TransactionDetailByAccount | AccountList. Point-in-time reports (BalanceSheet, AgedReceivables, AgedPayables) take as_of; the rest take date_from/date_to (ISO YYYY-MM-DD); AccountList needs no dates; omitted dates fall back to QBO defaults. summarize_by is valid for ProfitAndLoss (Month/Quarter/Year/Customer/Class) and for BalanceSheet, CustomerSales, CashFlow (Month/Quarter/Year). GeneralLedger requires date_from/date_to and is capped at 31 days.',
    keywords: [
      'quickbooks',
      'financial',
      'profit and loss',
      'p&l',
      'balance sheet',
      'aged receivables',
      'aging',
      'cash flow',
      'trial balance',
      'general ledger',
      'statement',
    ],
    params: {
      report_name: z.enum(REPORT_NAMES).describe('One of: ' + REPORT_NAMES.join(', ')),
      date_from: z
        .string()
        .optional()
        .describe('ISO date YYYY-MM-DD; range reports only, ignored for point-in-time reports'),
      date_to: z
        .string()
        .optional()
        .describe('ISO date YYYY-MM-DD; range reports only, ignored for point-in-time reports'),
      as_of: z
        .string()
        .optional()
        .describe('ISO date for point-in-time reports (BalanceSheet, AgedReceivables, AgedPayables)'),
      summarize_by: z.enum(['Month', 'Quarter', 'Year', 'Customer', 'Class']).optional(),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const name = args.report_name as ReportName

      if (args.summarize_by && !SUMMARIZE_BY_VALID[name].includes(args.summarize_by)) {
        return {
          error: 'qbo_api_error',
          status: 400,
          code: 'invalid_summarize_by',
          detail: `summarize_by '${args.summarize_by}' not allowed for ${name}; valid: ${SUMMARIZE_BY_VALID[name].join(', ') || '(none)'}`,
        }
      }

      if (name === 'GeneralLedger') {
        if (!args.date_from || !args.date_to) {
          return {
            error: 'qbo_api_error',
            status: 400,
            code: 'missing_date_range',
            detail: 'GeneralLedger requires date_from and date_to',
          }
        }
        if (daysBetween(args.date_from, args.date_to) > GENERAL_LEDGER_MAX_DAYS) {
          return {
            error: 'report_range_too_large',
            message: `GeneralLedger is limited to ${GENERAL_LEDGER_MAX_DAYS} days; narrow the range and try again.`,
          }
        }
      }

      const params: Record<string, string> = {}
      if (POINT_IN_TIME.has(name) && args.as_of) {
        params.as_of_date = args.as_of
      }
      if (!POINT_IN_TIME.has(name)) {
        if (args.date_from) {
          params.start_date = args.date_from
        }
        if (args.date_to) {
          params.end_date = args.date_to
        }
      }
      if (args.summarize_by) {
        params.summarize_column_by = args.summarize_by
      }

      const client = await getQboClient(ctx)
      const result = await client.get(`reports/${name}`, params)
      if (isQboError(result)) {
        return result
      }
      return result
    },
  }),
]
