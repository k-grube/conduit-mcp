import { defineTool, z, trimResponse, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { haloReportUrls } from '../fields.js'
import { formatListResult } from './format-result.js'

// field names get interpolated into `[${field}] IN (...)`; reject anything that could break out
// of the brackets even when it happens to match a known column (defense in depth) or when there's
// no available_columns list to check membership against (source-inherited gap, don't skip validation)
const SAFE_FIELD_NAME = /^[A-Za-z0-9_ .-]+$/

export interface RunReportParams {
  id: number
  filters?: Array<{ field: string; values: string[] }>
  includedetails?: boolean
  max_rows?: number
  offset?: number
  reportingperiod?: string
  reportingperiodstartdate?: string
  reportingperiodenddate?: string
}

export async function executeRunReport(params: RunReportParams, ctx: PluginContext): Promise<unknown> {
  const { id, filters, includedetails, max_rows, offset, ...rest } = params
  const client = await getClient(ctx)
  const rowLimit = Math.min(max_rows ?? 200, 1000)
  const rowOffset = offset ?? 0

  const sliceRows = (rows: unknown[]) => {
    const sliced = rows.slice(rowOffset, rowOffset + rowLimit)
    return {
      report: { rows: sliced },
      _report_meta: {
        total_rows: rows.length,
        returned_rows: sliced.length,
        offset: rowOffset,
        truncated: rows.length > rowOffset + sliced.length,
      },
    }
  }

  if (filters && filters.length > 0) {
    const saved = (await client.getReportById(id, { loadreport: false })) as Record<string, unknown>
    const sql = saved.sql as string
    if (!sql) {
      return { error: 'Report has no SQL' }
    }
    const bracketed = filters.filter((f) => f.field.includes(']'))
    if (bracketed.length > 0) {
      return { error: `Invalid filter field(s): ${bracketed.map((f) => f.field).join(', ')}` }
    }
    const availableCols = saved.available_columns as { name: string }[] | undefined
    if (availableCols) {
      const colNames = new Set(availableCols.map((c) => c.name.toLowerCase()))
      const invalid = filters.filter((f) => !colNames.has(f.field.toLowerCase()))
      if (invalid.length > 0) {
        return {
          error: `Invalid filter field(s): ${invalid.map((f) => f.field).join(', ')}`,
          available_fields: availableCols.map((c) => c.name),
        }
      }
    } else {
      const invalid = filters.filter((f) => !SAFE_FIELD_NAME.test(f.field))
      if (invalid.length > 0) {
        return { error: `Invalid filter field(s): ${invalid.map((f) => f.field).join(', ')}` }
      }
    }
    const whereClauses = filters.map((f) => {
      const escaped = f.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')
      return `[${f.field}] IN (${escaped})`
    })
    const wrappedSql = `SELECT * FROM (${sql}) _rpt WHERE ${whereClauses.join(' AND ')}`
    const result = await client.executeQuery(wrappedSql)
    const envelope = (Array.isArray(result) ? result[0] : result) as { report?: { rows?: unknown[] } } | undefined
    const rows = envelope?.report?.rows ?? []
    return trimResponse({ id, name: saved.name, ...sliceRows(rows) })
  }

  const raw = (await client.getReportById(id, {
    loadreport: true,
    includedetails: includedetails ?? false,
    ...rest,
  })) as Record<string, unknown>
  const cols = ((raw.available_columns ?? []) as Array<{ name?: string }>).map((c) => String(c.name))
  const rows = ((raw.report as { rows?: unknown[] } | undefined)?.rows ?? []) as unknown[]
  return trimResponse({ id: raw.id, name: raw.name, columns: cols, ...sliceRows(rows) })
}

export const reportTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_reports',
    description:
      'List available HaloPSA reports. Use this to discover report names and IDs before running a specific report. Rows include url (viewer) and config_url (editor) deep links.',
    keywords: ['halopsa', 'report', 'list'],
    params: {
      search: z.string().optional().describe('Search reports by name'),
      reportgroup_id: z.number().optional().describe('Filter by report group ID'),
      type: z.number().optional().describe('Filter by report type'),
      page_size: z.number().optional().default(50).describe('Results per page (default 50)'),
      page_no: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      const result = await client.getReports(params)
      return formatListResult(result, client, { collectionKey: 'reports', transformItem: haloReportUrls })
    },
  }),

  defineTool({
    name: 'halopsa_run_report',
    description:
      'Run a specific HaloPSA report by ID and return its data. Use halopsa_list_reports first to find the report ID. Supports optional date range filtering and filter overrides. Results are capped at max_rows (default 200), use offset to paginate.',
    keywords: ['halopsa', 'report', 'run', 'execute'],
    params: {
      id: z.number().describe('The report ID to run'),
      filters: z
        .array(
          z.object({
            field: z.string().describe('Column name to filter on (e.g., "Customer")'),
            values: z.array(z.string()).describe('Values to include (e.g., ["Acme Corp", "Widgets Inc"])'),
          }),
        )
        .optional()
        .describe(
          'Override the saved report filters. Each filter matches a column name to one or more allowed values. When set, the saved SQL runs directly and reportingperiod/reportingperiodstartdate/reportingperiodenddate are ignored.',
        ),
      reportingperiod: z
        .string()
        .optional()
        .describe("Reporting period preset (e.g., 'thismonth', 'lastmonth', 'thisweek', 'lastweek', 'thisyear')"),
      reportingperiodstartdate: z.string().optional().describe("Custom start date (ISO format, e.g., '2025-01-01')"),
      reportingperiodenddate: z.string().optional().describe("Custom end date (ISO format, e.g., '2025-12-31')"),
      includedetails: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include expanded sub-objects per row (default false, increases response size significantly)'),
      max_rows: z.number().optional().default(200).describe('Maximum rows to return (default 200)'),
      offset: z.number().optional().default(0).describe('Number of rows to skip for pagination (default 0)'),
    },
    readOnly: true,
    handler: async (params, ctx) => executeRunReport(params, ctx),
  }),

  defineTool({
    name: 'halopsa_get_report',
    description:
      "Fetch a saved HaloPSA report's definition including its SQL, without returning rows. Use to learn the tenant's SQL idioms or adapt an existing report before writing a new halopsa_query. The loads flag says whether the report currently runs: a broken or dynamic-SQL report is a starting point, not an answer. Use halopsa_run_report for the data.",
    keywords: ['halopsa', 'report', 'sql', 'definition', 'get'],
    params: {
      id: z.number().describe('The report ID (find via halopsa_list_reports)'),
    },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      // loadreport: true so halo attempts the run and fills report.loaded/load_error; rows are dropped below
      const raw = (await client.getReportById(params.id, { loadreport: true })) as Record<string, unknown>
      const run = (raw.report ?? {}) as { loaded?: boolean; load_error?: string }
      return trimResponse(
        haloReportUrls(
          {
            id: raw.id,
            name: raw.name,
            group: raw.group_name ?? null,
            group_id: raw.group_id,
            main_entity: raw.mainentity ?? null,
            sql: raw.sql ?? null,
            uses_dynamic_sql: Boolean(raw.usesdynamicsql),
            loads: { loaded: Boolean(run.loaded), error: run.load_error ?? null },
          },
          client,
        ),
      )
    },
  }),
]
