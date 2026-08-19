import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getQboClient, isQboError } from '../client.js'
import { pickFields, QBO_CUSTOMER_LIST_FIELDS } from '../fields.js'
import { qboCustomerUrl } from '../urls.js'

interface QboCustomer {
  Id: string
  DisplayName?: string
  CompanyName?: string
  Balance?: number
  Active?: boolean
}

interface ListResponse {
  QueryResponse?: {
    Customer?: QboCustomer[]
    maxResults?: number
    startPosition?: number
  }
}

function toCamel(c: QboCustomer): Record<string, unknown> {
  return {
    id: c.Id,
    displayName: c.DisplayName ?? null,
    companyName: c.CompanyName ?? null,
    balance: c.Balance ?? 0,
    active: c.Active ?? true,
  }
}

export const customerTools: ToolDef[] = [
  defineTool({
    name: 'qbo_list_customers',
    description:
      'List QBO customers, paged (page/page_size, default 25, hasMore flag). active_only defaults to true. Returns per customer: id, displayName, companyName, balance (open receivable), active, and a url deep link. For name lookup use qbo_search_customers; for the full record use qbo_get_customer.',
    keywords: ['quickbooks', 'client', 'company', 'accounts receivable', 'billing'],
    params: {
      active_only: z.boolean().optional().default(true).describe('Only include active customers (default true)'),
      page: z.number().optional().default(1).describe('1-indexed page number'),
      page_size: z.number().optional().default(25).describe('Page size 1-100, default 25'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const page = Math.max(1, Math.floor(args.page ?? 1))
      const pageSize = Math.min(100, Math.max(1, Math.floor(args.page_size ?? 25)))
      const startPosition = (page - 1) * pageSize + 1
      const whereClause = args.active_only === false ? '' : ' WHERE Active = true'
      const sql = `SELECT * FROM Customer${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`

      const client = await getQboClient(ctx)
      const result = await client.query<ListResponse>(sql)
      if (isQboError(result)) {
        return result
      }
      const customers = (result.QueryResponse?.Customer ?? []).map((c) =>
        pickFields(qboCustomerUrl(toCamel(c), client.environment), QBO_CUSTOMER_LIST_FIELDS),
      )
      return { customers, hasMore: customers.length === pageSize }
    },
  }),

  defineTool({
    name: 'qbo_get_customer',
    description:
      'Get one QBO customer by customer_id (the Intuit Customer Id, a numeric string). Returns the raw QBO Customer object plus a url deep link. Use qbo_search_customers first when only the name is known.',
    keywords: ['quickbooks', 'client', 'company', 'contact'],
    params: { customer_id: z.string().describe('QBO Customer Id') },
    readOnly: true,
    handler: async (args, ctx) => {
      const client = await getQboClient(ctx)
      const result = await client.get<{ Customer: Record<string, unknown> }>(
        `customer/${encodeURIComponent(args.customer_id)}`,
      )
      if (isQboError(result)) {
        return result
      }
      return qboCustomerUrl(result.Customer, client.environment)
    },
  }),

  defineTool({
    name: 'qbo_search_customers',
    description:
      'Search QBO customers by name substring, case-insensitive against DisplayName and CompanyName (not fuzzy: the string must appear verbatim). Scans up to 1000 customers in one pass, no pagination. Returns the same summary fields as qbo_list_customers (id, displayName, companyName, balance, active, url).',
    keywords: ['quickbooks', 'find', 'lookup', 'client', 'company', 'name'],
    params: {
      name: z.string().describe('Search string (matched against DisplayName and CompanyName, case-insensitive)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const needleRaw = String(args.name ?? '').trim()
      if (!needleRaw) {
        return { customers: [] }
      }
      const needle = needleRaw.toLowerCase()
      // QBO query language LIKE wildcard support is inconsistent across endpoints, and there's no
      // sql injection risk for user input either way. pull a wide page and filter client-side.
      // ~1000 customers is a realistic upper bound and well within QBO's MAXRESULTS cap.
      const client = await getQboClient(ctx)
      const result = await client.query<ListResponse>('SELECT * FROM Customer MAXRESULTS 1000')
      if (isQboError(result)) {
        return result
      }
      const all = result.QueryResponse?.Customer ?? []
      const filtered = all.filter((c) => {
        const display = (c.DisplayName ?? '').toLowerCase()
        const company = (c.CompanyName ?? '').toLowerCase()
        return display.includes(needle) || company.includes(needle)
      })
      return {
        customers: filtered.map((c) =>
          pickFields(qboCustomerUrl(toCamel(c), client.environment), QBO_CUSTOMER_LIST_FIELDS),
        ),
      }
    },
  }),
]
