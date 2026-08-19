import { createWriteGuard, defineTool, z, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { haloReportUrls } from '../fields.js'
import { sqlGuardError } from './sql-guard.js'

export const REPORT_SQL_RULES =
  'Halo report SQL dialect: SELECT only, no CTEs (WITH), no outer ORDER BY (the reporting UI wraps the query), ' +
  'old SQL Server (no 2-arg LTRIM/RTRIM), bracket aliases like [Column Name]. Validate via preview before committing. ' +
  'Viewer-context variables auto-filter per viewer: $clientid/$siteid/$userid (logged-in portal user) and $agentid (agent app), case-insensitive. ' +
  'Preview validation substitutes API context ($agentid -> the API agent, portal vars -> 0), so viewer-filtered SQL legitimately previews 0 rows: expected, not a failure.'

const REPORT_FIELDS = [
  'name',
  'sql',
  'description',
  'group_id',
  'charttype',
  'xaxis',
  'yaxis',
  'xaxiscaption',
  'yaxiscaption',
  'reportingperioddatefield',
  'sqlhasdatefilter',
  'customise_table_html',
  'report_table_html',
  'report_table_row_html',
] as const

const REPORT_GROUP_LOOKUP_ID = 41

async function writesEnabled(ctx: PluginContext): Promise<boolean> {
  const cfg = await ctx.getConfig<{ writesEnabled?: boolean }>()
  return cfg.writesEnabled === true
}

function pickDefined(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (args[key] !== undefined) {
      out[key] = args[key]
    }
  }
  return out
}

function templateWarnings(payload: Record<string, unknown>): string[] | undefined {
  if (typeof payload.report_table_html === 'string' && !payload.report_table_html.includes('$REPORTROWS')) {
    return ['report_table_html has no $REPORTROWS placeholder; rows will not render']
  }
  return undefined
}

// report groups live in Lookup lookupid=41; exact name match, case-insensitive
export async function resolveReportGroup(
  ctx: PluginContext,
  name: string,
): Promise<{ group_id: number } | { group_create: string }> {
  const client = await getClient(ctx)
  const rows = (await client.getLookups({ lookupid: REPORT_GROUP_LOOKUP_ID })) as Array<Record<string, unknown>>
  const needle = name.trim().toLowerCase()
  const match = (Array.isArray(rows) ? rows : []).find(
    (r) =>
      String(r.name ?? '')
        .trim()
        .toLowerCase() === needle,
  )
  if (match) {
    return { group_id: match.id as number }
  }
  return { group_create: name }
}

const DEDUPE_STOPWORDS = new Set(['report', 'reports', 'dash', 'dashboard', 'this', 'that', 'with', 'from'])

export function dedupeTokens(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !DEDUPE_STOPWORDS.has(t))
  return [...new Set(tokens)].sort((a, b) => b.length - a.length).slice(0, 4)
}

// advisory dedupe: halo search matches name OR sql OR description; post-filter to name/description so sql-body noise drops
export async function findExistingReports(ctx: PluginContext, name: string): Promise<Array<Record<string, unknown>>> {
  const tokens = dedupeTokens(name)
  if (tokens.length === 0) {
    return []
  }
  const client = await getClient(ctx)
  const pages = await Promise.all(
    tokens.map((t) => client.getReports({ search: t, pageinate: true, page_no: 1, page_size: 50 })),
  )
  const hits = new Map<number, { row: Record<string, unknown>; count: number }>()
  for (const page of pages) {
    const rows = (page as { reports?: Array<Record<string, unknown>> }).reports ?? []
    for (const row of rows) {
      const id = row.id as number
      const hit = hits.get(id)
      if (hit) {
        hit.count += 1
      } else {
        hits.set(id, { row, count: 1 })
      }
    }
  }
  const matchable = [...hits.values()].filter(({ row }) => {
    const haystack = `${String(row.name ?? '')} ${String(row.description ?? '')}`.toLowerCase()
    return tokens.some((t) => haystack.includes(t))
  })
  matchable.sort((a, b) => b.count - a.count)
  return matchable.slice(0, 5).map(({ row }) =>
    haloReportUrls(
      {
        id: row.id,
        name: row.name,
        description: row.description,
        group_name: row.group_name,
        group_id: row.group_id,
      },
      client,
    ),
  )
}

// runs the sql through the no-persist preview. returns {columns, sample} or throws with halo's error
async function validateSql(ctx: PluginContext, sql: string): Promise<{ columns: string[]; sample: unknown[] }> {
  const guardError = sqlGuardError(sql)
  if (guardError) {
    throw new Error(guardError)
  }
  const client = await getClient(ctx)
  const result = await client.executeQuery(sql)
  const first = (Array.isArray(result) ? result[0] : result) as Record<string, unknown> | undefined
  const report = (first?.report ?? {}) as Record<string, unknown>
  // bad sql comes back 200 with report.load_error, http errors throw via the oauth client
  const loadError = report.load_error ?? report.error
  if (typeof loadError === 'string' && loadError.length > 0) {
    throw new Error(loadError)
  }
  const cols = (report.available_columns ?? []) as Array<{ name?: string }>
  const rows = (report.rows ?? []) as unknown[]
  return { columns: cols.map((c) => String(c.name)), sample: rows.slice(0, 5) }
}

const createReportParams = {
  name: z.string().describe('Report name'),
  sql: z.string().describe(`Report SQL. ${REPORT_SQL_RULES}`),
  description: z
    .string()
    .min(1)
    .describe('REQUIRED: what the report shows and what it was built for; stored on the report and searchable'),
  customise_table_html: z.boolean().optional().describe('Enable the report HTML template fields'),
  report_table_html: z
    .string()
    .optional()
    .describe(
      'Table shell HTML: own header <tr> + $REPORTROWS placeholder; carry a <style> block here for styling (opaque backgrounds + !important text colors if it must look right in both halo themes)',
    ),
  report_table_row_html: z.string().optional().describe('Per-row template with $ColumnAlias placeholders'),
  group_id: z
    .number()
    .optional()
    .describe(
      'Report group id. Create: omitted -> the configured default group (auto-created). Update: omitted -> unchanged',
    ),
  charttype: z.number().optional().describe('Chart type int; -1/omitted = table only'),
  xaxis: z.string().optional().describe('Chart x-axis column'),
  yaxis: z.string().optional().describe('Chart y-axis column'),
  xaxiscaption: z.string().optional(),
  yaxiscaption: z.string().optional(),
  reportingperioddatefield: z.string().optional().describe('Column the reporting-period date filter applies to'),
  sqlhasdatefilter: z.boolean().optional(),
  confirm_token: z.string().optional().describe('Token from a prior preview call to commit the write'),
}

const disabledError = { error: 'writes disabled, enable writesEnabled in halopsa plugin settings' }

export const reportWriteTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_create_report',
    description: `Create a HaloPSA report. Two-step by default: first call validates the SQL and returns a preview + confirm_token + any similar existing reports (reuse those instead of duplicating); re-call with the token to commit. Reports land in the configured default group unless group_id is set. ${REPORT_SQL_RULES}`,
    keywords: ['halopsa', 'report', 'create', 'write', 'sql'],
    params: createReportParams,
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      // proxy surface has no schema enforcement, enforce here for both surfaces
      if (typeof args.description !== 'string' || args.description.trim() === '') {
        return { error: 'description is required: say what the report shows and what it was built for' }
      }
      const payload = pickDefined(args, REPORT_FIELDS)
      let validation: { columns: string[]; sample: unknown[] }
      try {
        validation = await validateSql(ctx, String(payload.sql))
      } catch (err) {
        return { error: `SQL validation failed: ${err instanceof Error ? err.message : String(err)}` }
      }
      const cfg = await ctx.getConfig<{ defaultReportGroupName?: string }>()
      if (payload.group_id === undefined && cfg.defaultReportGroupName) {
        Object.assign(payload, await resolveReportGroup(ctx, cfg.defaultReportGroupName))
      }
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const warnings = templateWarnings(payload)
        let candidates: Record<string, unknown> = {}
        try {
          const existing = await findExistingReports(ctx, String(payload.name))
          if (existing.length > 0) {
            candidates = {
              existing_reports: existing,
              reuse_hint:
                'similar reports already exist; consider halopsa_update_report on one of them or halopsa_run_report to inspect before committing a duplicate',
            }
          }
        } catch (err) {
          candidates = { existing_reports_error: err instanceof Error ? err.message : String(err) }
        }
        const { confirmToken } = await guard.confirm('halopsa_create_report', payload)
        return {
          preview: {
            action: 'create_report',
            ...payload,
            columns: validation.columns,
            row_sample: validation.sample,
            ...(typeof payload.group_create === 'string' && {
              group_note: `report group '${payload.group_create}' does not exist; committing will create it`,
            }),
            ...(warnings && { warnings }),
          },
          ...candidates,
          confirm_token: confirmToken,
        }
      }
      await guard.commit('halopsa_create_report', payload, args.confirm_token)
      const client = await getClient(ctx)
      const savePayload = { ...payload }
      if (typeof savePayload.group_create === 'string') {
        const group = (await client.saveLookup({
          lookupid: REPORT_GROUP_LOOKUP_ID,
          name: savePayload.group_create,
        })) as Record<string, unknown>
        delete savePayload.group_create
        savePayload.group_id = group.id
      }
      const created = (await client.saveReport(savePayload)) as Record<string, unknown>
      return haloReportUrls(
        { id: created.id, name: created.name, group_id: created.group_id ?? savePayload.group_id },
        client,
      )
    },
  }),

  defineTool({
    name: 'halopsa_update_report',
    description:
      'Update a HaloPSA report by id. Merge semantics: only supplied fields change, everything else survives. Two-step by default: preview shows current vs new values; re-call with confirm_token to commit. SQL changes are validated before anything persists.',
    keywords: ['halopsa', 'report', 'update', 'write', 'sql'],
    params: {
      id: z.number().describe('Report id'),
      ...createReportParams,
      name: z.string().optional().describe('Report name'),
      sql: z.string().optional().describe(`Report SQL. ${REPORT_SQL_RULES}`),
      description: z.string().optional().describe('What the report shows; stored on the report and searchable'),
    },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      // proxy surface has no schema enforcement, an absent id would serialize away and insert
      if (typeof args.id !== 'number') {
        return { error: 'id must be a number' }
      }
      const { id } = args
      const changes = pickDefined(args, REPORT_FIELDS)
      if (Object.keys(changes).length === 0) {
        return { error: 'no fields to update' }
      }
      if (changes.sql !== undefined) {
        try {
          await validateSql(ctx, String(changes.sql))
        } catch (err) {
          return { error: `SQL validation failed: ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      const payload = { id, ...changes }
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const client = await getClient(ctx)
        const current = (await client.getReportById(id, { loadreport: false })) as Record<string, unknown>
        const diff: Record<string, { current: unknown; new: unknown }> = {}
        for (const [key, value] of Object.entries(changes)) {
          diff[key] = { current: current[key], new: value }
        }
        const links = haloReportUrls({ id, group_id: current.group_id }, client)
        const warnings = templateWarnings(changes)
        const { confirmToken } = await guard.confirm('halopsa_update_report', payload)
        return {
          preview: {
            action: 'update_report',
            id,
            name: current.name,
            url: links.url,
            config_url: links.config_url,
            changes: diff,
            ...(warnings && { warnings }),
          },
          confirm_token: confirmToken,
        }
      }
      await guard.commit('halopsa_update_report', payload, args.confirm_token)
      const client = await getClient(ctx)
      const updated = (await client.saveReport(payload)) as Record<string, unknown>
      return haloReportUrls({ id: updated.id, name: updated.name, group_id: updated.group_id }, client)
    },
  }),
]
