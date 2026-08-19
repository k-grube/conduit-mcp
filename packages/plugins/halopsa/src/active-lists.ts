// shared list executions for the active-entity tools (list_clients, list_users, list_contracts,
// list_recurring_invoices). these default to ACTIVE records via halo sql reports (executeQuery),
// falling back to the plain REST list endpoint only when include_inactive/include_disabled is set.
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { getClient } from './client.js'
import {
  clientActivity,
  clientActivityFromConfig,
  userActivity,
  contractIsLive,
  contractDescribe,
  recurringInvoiceActivity,
  DEFAULT_USER_ACTIVITY,
  DEFAULT_RECURRING_INVOICE_ACTIVITY,
  type HaloActivitySettings,
} from './activity.js'
import {
  pickFields,
  CLIENT_LIST_FIELDS,
  haloClientUrl,
  USER_LIST_FIELDS,
  haloUserUrl,
  CONTRACT_LIST_FIELDS,
  haloContractUrl,
  RECURRING_INVOICE_LIST_FIELDS,
  haloRecurringInvoiceUrl,
} from './fields.js'

interface HaloLike {
  baseUrl: string
  executeQuery(sql: string): Promise<unknown>
  getClients(params?: Record<string, unknown>): Promise<unknown>
  getUsers(params?: Record<string, unknown>): Promise<unknown>
  getContracts(params?: Record<string, unknown>): Promise<unknown>
  getRecurringInvoices(params?: Record<string, unknown>): Promise<unknown>
}

const MAX_PAGE_SIZE = 100 // halo caps page_size at 100

function clamp(n: unknown, fallback: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 1) {
    return fallback
  }
  return Math.min(Math.floor(v), max)
}

async function runCount(client: HaloLike, sql: string): Promise<number | undefined> {
  try {
    const raw = (await client.executeQuery(sql)) as { report?: { rows?: Array<Record<string, unknown>> } }
    const n = Number(raw?.report?.rows?.[0]?.n)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

// counts degrade to undefined on failure, lists don't: a bad report sql comes back as 200 loaded:false, not a rejection
async function runListQuery(client: HaloLike, sql: string): Promise<Array<Record<string, unknown>>> {
  const raw = (await client.executeQuery(sql)) as {
    report?: { loaded?: boolean; load_error?: string; rows?: Array<Record<string, unknown>> }
  }
  if (raw?.report?.loaded === false) {
    throw new Error(`halo report query failed: ${raw.report.load_error || 'unknown error'}`)
  }
  return raw?.report?.rows || []
}

// "acme & co" -> "%acme%co%", punctuation-insensitive on both sides
export function buildFuzzyPattern(search: string): string {
  const tokens = search
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) {
    return `%${search.toLowerCase()}%`
  }
  return `%${tokens.join('%')}%`
}

const STRIPPED_NAME = `LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(Aareadesc, '-', ''), ' ', ''), '.', ''), ',', ''), '&', ''), '''', ''))`

export interface ListClientsArgs {
  search?: string
  toplevel_id?: number
  page_size?: number
  page_no?: number
  include_inactive?: boolean
}

export async function executeListClients(ctx: PluginContext, args: ListClientsArgs): Promise<Record<string, unknown>> {
  const client = (await getClient(ctx)) as HaloLike
  const pageSize = clamp(args.page_size, 25, MAX_PAGE_SIZE)
  const pageNo = clamp(args.page_no, 1, 100000)

  if (args.include_inactive === true) {
    const result = (await client.getClients({
      search: args.search,
      toplevel_id: args.toplevel_id,
      page_size: pageSize,
      page_no: pageNo,
      includeinactive: true,
    })) as Record<string, unknown>
    const items = ((result?.clients as Record<string, unknown>[]) || []).map((c) =>
      pickFields(haloClientUrl(c, client) as Record<string, unknown>, [...CLIENT_LIST_FIELDS]),
    )
    return {
      page_no: result.page_no,
      page_size: result.page_size,
      returned: items.length,
      total_in_system: result.record_count,
      clients: items,
    }
  }

  const activity = clientActivityFromConfig(await ctx.getConfig<HaloActivitySettings>())
  const rule = clientActivity(activity)
  // CFType is a custom field, absent on stock instances; only reference it when type settings are set
  const withType = rule.usesTypeField
  const where: string[] = [rule.sqlWhere]
  if (args.toplevel_id !== undefined) {
    where.push(`Atreeid = ${Number(args.toplevel_id)}`)
  }
  if (args.search) {
    where.push(`${STRIPPED_NAME} LIKE '${buildFuzzyPattern(args.search).replace(/'/g, "''")}'`)
  }
  const whereSql = where.join(' AND ')
  const offset = (pageNo - 1) * pageSize
  const listSql =
    `SELECT Aarea AS id, Aareadesc AS name, Aisinactive AS inactive, Atreeid AS toplevel_id` +
    (withType ? `, CFType AS client_type ` : ` `) +
    `FROM Area WHERE ${whereSql} ORDER BY Aareadesc OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`

  const rows = await runListQuery(client, listSql)
  const items = rows.map((r) =>
    haloClientUrl(
      {
        id: Number(r.id),
        name: r.name,
        inactive: r.inactive === 'True' || r.inactive === true,
        toplevel_id: Number(r.toplevel_id),
        ...(withType ? { client_type: r.client_type ?? null } : {}),
      },
      client,
    ),
  )

  // total_in_system scopes to the caller's own filters (toplevel_id/search), not the activity rule
  const scopeParts = where.slice(1)
  const totalSql = `SELECT COUNT(*) AS n FROM Area` + (scopeParts.length ? ` WHERE ${scopeParts.join(' AND ')}` : '')
  const [activeCount, total] = await Promise.all([
    runCount(client, `SELECT COUNT(*) AS n FROM Area WHERE ${whereSql}`),
    runCount(client, totalSql),
  ])

  return {
    page_no: pageNo,
    page_size: pageSize,
    returned: items.length,
    active_count: activeCount,
    total_in_system: total,
    active_rule: rule.describe(),
    clients: items,
  }
}

export interface ListUsersArgs {
  search?: string
  client_id?: number
  page_size?: number
  page_no?: number
  include_inactive?: boolean
}

export async function executeListUsers(ctx: PluginContext, args: ListUsersArgs): Promise<Record<string, unknown>> {
  const client = (await getClient(ctx)) as HaloLike
  const pageSize = clamp(args.page_size, 25, MAX_PAGE_SIZE)
  const pageNo = clamp(args.page_no, 1, 100000)
  const rule = userActivity(DEFAULT_USER_ACTIVITY)

  const result = (await client.getUsers({
    search: args.search,
    client_id: args.client_id,
    page_size: pageSize,
    page_no: pageNo,
    includeinactive: true,
  })) as Record<string, unknown>

  let items = (result?.users as Record<string, unknown>[]) || []
  if (args.include_inactive !== true) {
    items = items.filter(rule.predicate)
  }
  const trimmed = items.map((u) => pickFields(haloUserUrl(u, client) as Record<string, unknown>, [...USER_LIST_FIELDS]))

  let activeCount: number | undefined
  if (args.include_inactive !== true && !args.search) {
    const clientFilter = args.client_id !== undefined ? ` AND Uarea = ${Number(args.client_id)}` : ''
    activeCount = await runCount(client, `SELECT COUNT(*) AS n FROM Users WHERE ${rule.sqlWhere}${clientFilter}`)
  }

  return {
    page_no: pageNo,
    page_size: pageSize,
    returned: trimmed.length,
    ...(activeCount !== undefined ? { active_count: activeCount } : {}),
    total_in_system: result.record_count,
    ...(args.include_inactive !== true ? { active_rule: rule.describe() } : {}),
    users: trimmed,
  }
}

const SWEEP_MAX_PAGES = 5 // 500 rows; populations are ~100-300 today

async function sweep(
  fetchPage: (pageNo: number) => Promise<{ rows: Record<string, unknown>[]; recordCount: number }>,
): Promise<{ rows: Record<string, unknown>[]; recordCount: number; complete: boolean }> {
  const rows: Record<string, unknown>[] = []
  let recordCount = 0
  for (let pageNo = 1; pageNo <= SWEEP_MAX_PAGES; pageNo++) {
    const page = await fetchPage(pageNo)
    recordCount = page.recordCount
    rows.push(...page.rows)
    if (rows.length >= recordCount || page.rows.length === 0) {
      return { rows, recordCount, complete: true }
    }
  }
  return { rows, recordCount, complete: false }
}

export interface ListContractsArgs {
  client_id?: number
  search?: string
  page_size?: number
  page_no?: number
  include_inactive?: boolean
}

export async function executeListContracts(
  ctx: PluginContext,
  args: ListContractsArgs,
): Promise<Record<string, unknown>> {
  const client = (await getClient(ctx)) as HaloLike
  const pageSize = clamp(args.page_size, 50, MAX_PAGE_SIZE)
  const pageNo = clamp(args.page_no, 1, 100000)
  const baseParams: Record<string, unknown> = {}
  if (args.client_id !== undefined) {
    baseParams.client_id = args.client_id
  }
  if (args.search) {
    baseParams.search = args.search
  }

  const trim = (c: Record<string, unknown>) =>
    pickFields(haloContractUrl(c, client) as Record<string, unknown>, [...CONTRACT_LIST_FIELDS, 'url'])

  if (args.include_inactive === true) {
    const result = (await client.getContracts({
      ...baseParams,
      includeinactive: true,
      page_size: pageSize,
      page_no: pageNo,
    })) as Record<string, unknown>
    const items = ((result?.contracts as Record<string, unknown>[]) || []).map(trim)
    return {
      page_no: result.page_no,
      page_size: result.page_size,
      returned: items.length,
      total_in_system: result.record_count,
      contracts: items,
    }
  }

  // api default is chactive=1; sweep it, split live vs expired locally
  const swept = await sweep(async (p) => {
    const r = (await client.getContracts({ ...baseParams, page_size: MAX_PAGE_SIZE, page_no: p })) as Record<
      string,
      unknown
    >
    return { rows: (r?.contracts as Record<string, unknown>[]) || [], recordCount: Number(r?.record_count) || 0 }
  })
  const live = swept.rows.filter(contractIsLive)
  const pageItems = live.slice((pageNo - 1) * pageSize, pageNo * pageSize).map(trim)

  let total: unknown
  try {
    const totalResult = (await client.getContracts({
      ...baseParams,
      includeinactive: true,
      page_size: 1,
      page_no: 1,
    })) as Record<string, unknown>
    total = totalResult.record_count
  } catch {
    total = undefined
  }

  return {
    page_no: pageNo,
    page_size: pageSize,
    returned: pageItems.length,
    ...(swept.complete
      ? { active_count: live.length, expired_awaiting_action: swept.rows.length - live.length }
      : {
          counts_note: `counts partial: only first ${SWEEP_MAX_PAGES * MAX_PAGE_SIZE} of ${swept.recordCount} rows swept`,
        }),
    ...(total !== undefined ? { total_in_system: total } : {}),
    active_rule: contractDescribe(),
    contracts: pageItems,
  }
}

export interface ListRecurringInvoicesArgs {
  client_id?: number
  search?: string
  page_size?: number
  page_no?: number
  include_disabled?: boolean
}

export async function executeListRecurringInvoices(
  ctx: PluginContext,
  args: ListRecurringInvoicesArgs,
): Promise<Record<string, unknown>> {
  const client = (await getClient(ctx)) as HaloLike
  const pageSize = clamp(args.page_size, 50, MAX_PAGE_SIZE)
  const pageNo = clamp(args.page_no, 1, 100000)
  const rule = recurringInvoiceActivity(DEFAULT_RECURRING_INVOICE_ACTIVITY)
  const baseParams: Record<string, unknown> = {}
  if (args.client_id !== undefined) {
    baseParams.client_id = args.client_id
  }
  if (args.search) {
    baseParams.search = args.search
  }

  const swept = await sweep(async (p) => {
    const r = (await client.getRecurringInvoices({ ...baseParams, page_size: MAX_PAGE_SIZE, page_no: p })) as Record<
      string,
      unknown
    >
    return { rows: (r?.invoices as Record<string, unknown>[]) || [], recordCount: Number(r?.record_count) || 0 }
  })

  const kept = args.include_disabled === true ? swept.rows : swept.rows.filter(rule.predicate)
  const pageItems = kept
    .slice((pageNo - 1) * pageSize, pageNo * pageSize)
    .map((inv) =>
      pickFields(haloRecurringInvoiceUrl(inv, client) as Record<string, unknown>, [
        ...RECURRING_INVOICE_LIST_FIELDS,
        'url',
      ]),
    )

  return {
    page_no: pageNo,
    page_size: pageSize,
    returned: pageItems.length,
    ...(args.include_disabled !== true && swept.complete ? { active_count: kept.length } : {}),
    ...(swept.complete
      ? {}
      : {
          counts_note: `counts partial: only first ${SWEEP_MAX_PAGES * MAX_PAGE_SIZE} of ${swept.recordCount} rows swept`,
        }),
    total_in_system: swept.recordCount,
    ...(args.include_disabled !== true ? { active_rule: rule.describe() } : {}),
    invoices: pageItems,
  }
}
