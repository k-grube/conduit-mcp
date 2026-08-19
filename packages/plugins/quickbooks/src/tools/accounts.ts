import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError } from '../client.js'
import { pickFields, QBO_ACCOUNT_LIST_FIELDS } from '../fields.js'
import { qboAccountUrl } from '../urls.js'

interface QboAccount {
  Id: string
  Name?: string
  FullyQualifiedName?: string
  AccountType?: string
  AccountSubType?: string
  Classification?: string
  CurrentBalance?: number
  Active?: boolean
  ParentRef?: { value: string; name?: string }
}

interface ListResponse {
  QueryResponse?: { Account?: QboAccount[] }
}

function toCamel(a: QboAccount): Record<string, unknown> {
  return {
    id: a.Id,
    name: a.Name ?? null,
    fullyQualifiedName: a.FullyQualifiedName ?? null,
    accountType: a.AccountType ?? null,
    accountSubType: a.AccountSubType ?? null,
    classification: a.Classification ?? null,
    currentBalance: a.CurrentBalance ?? 0,
    active: a.Active ?? true,
    parentRef: a.ParentRef ?? null,
  }
}

export const accountTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_accounts',
    description:
      'List QBO chart-of-accounts entries, paged (page/page_size, default 25, hasMore flag). Optional account_type/account_subtype filters take QBO AccountType values (e.g. Expense, Income, Bank); active_only defaults to true. Returns per account: id, name, fullyQualifiedName, accountType, accountSubType, classification, currentBalance, active, parentRef, and a url deep link to the account register.',
    keywords: ['quickbooks', 'chart of accounts', 'general ledger', 'gl', 'accounting', 'balance'],
    params: {
      account_type: z.string().optional().describe('Filter by QBO AccountType (e.g. Expense, Income, Bank)'),
      account_subtype: z.string().optional().describe('Filter by QBO AccountSubType'),
      active_only: z.boolean().optional().default(true).describe('Only include active accounts (default true)'),
      page: z.number().optional().default(1).describe('1-indexed page number'),
      page_size: z.number().optional().default(25).describe('Page size 1-100, default 25'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const page = Math.max(1, Math.floor(args.page ?? 1))
      const pageSize = Math.min(100, Math.max(1, Math.floor(args.page_size ?? 25)))
      const startPosition = (page - 1) * pageSize + 1

      const where: string[] = []
      if (args.active_only !== false) {
        where.push('Active = true')
      }
      if (args.account_type) {
        where.push(`AccountType = '${args.account_type.replace(/'/g, "''")}'`)
      }
      if (args.account_subtype) {
        where.push(`AccountSubType = '${args.account_subtype.replace(/'/g, "''")}'`)
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const sql = `SELECT * FROM Account ${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
        .replace(/\s+/g, ' ')
        .trim()

      const client = await getQboClient(ctx)
      const result = await client.query<ListResponse>(sql)
      if (isQboError(result)) {
        return result
      }
      const raw = result.QueryResponse?.Account ?? []
      const hasMore = raw.length === pageSize
      return {
        accounts: raw.map((a) => pickFields(qboAccountUrl(toCamel(a), client.environment), QBO_ACCOUNT_LIST_FIELDS)),
        hasMore,
      }
    },
  }),

  defineTool({
    name: 'qbo_get_account',
    description:
      'Get one QBO account by account_id. Returns the raw QBO Account object (type, classification, CurrentBalance, currency, parent) plus a url deep link to its register.',
    keywords: ['quickbooks', 'chart of accounts', 'general ledger', 'gl', 'accounting', 'balance'],
    params: { account_id: z.string().describe('QBO Account Id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.get<{ Account: Record<string, unknown> }>(
        `account/${encodeURIComponent(args.account_id)}`,
      )
      if (isQboError(result)) {
        return result
      }
      return qboAccountUrl(result.Account, client.environment)
    },
  }),
]
