import { createWriteGuard, defineTool, z, type PluginContext, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { haloDashboardUrls } from '../fields.js'
import { WIDGET_TYPES, trimWidget, isUnauthorized, dashboardAccessError } from './dashboards.js'
import {
  REPORT_BACKED_TYPES,
  parseLayouts,
  serializeLayouts,
  nextWidgetKey,
  autoPlace,
  layoutsWithAdded,
  layoutsWithGeometry,
  layoutsPruned,
  type Layouts,
} from './dashboard-widgets.js'

const DASHBOARD_FIELDS = ['name', 'use', 'rowheight', 'reportingperiod', 'list_item_height'] as const
const SHARE_FIELDS = ['share_with_org', 'org_id'] as const

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

// share_with_org true -> whole-org view grant, false -> clear all grants, absent -> undefined (leave untouched)
// user_access REPLACES the full grant set when present on the POST (verified against a live halo instance)
async function orgUserAccess(
  ctx: PluginContext,
  args: Record<string, unknown>,
): Promise<Array<Record<string, unknown>> | undefined> {
  if (args.share_with_org === undefined) {
    return undefined
  }
  if (args.share_with_org === false) {
    return []
  }
  const client = await getClient(ctx)
  const raw = await client.getOrganisations()
  const orgs = (Array.isArray(raw) ? raw : [raw]).filter(
    (o): o is Record<string, unknown> =>
      o !== null && typeof o === 'object' && typeof (o as Record<string, unknown>).id === 'number',
  )
  const names = orgs.map((o) => `${o.id}=${o.name}`).join(', ')
  let org: Record<string, unknown> | undefined
  if (args.org_id !== undefined) {
    org = orgs.find((o) => o.id === args.org_id)
    if (!org) {
      throw new Error(`org_id ${args.org_id} not found; organisations: ${names}`)
    }
  } else if (orgs.length === 1) {
    org = orgs[0]
  } else {
    throw new Error(`tenant has ${orgs.length} organisations, pass org_id; organisations: ${names}`)
  }
  return [{ type: 'O', data_id: org.id, data_name: org.name }]
}

interface DashboardState {
  raw: Record<string, unknown>
  widgets: Array<Record<string, unknown>>
  layouts: Layouts
}

async function fetchDashboardState(ctx: PluginContext, id: number): Promise<DashboardState> {
  const client = await getClient(ctx)
  let raw: Record<string, unknown>
  try {
    raw = (await client.getDashboardById(id, { includedetails: true })) as Record<string, unknown>
  } catch (err) {
    if (isUnauthorized(err)) {
      throw new Error(dashboardAccessError(id), { cause: err })
    }
    throw err
  }
  return {
    raw,
    widgets: (raw.widgets ?? []) as Array<Record<string, unknown>>,
    layouts: parseLayouts(raw.layouts),
  }
}

function widgetNotFound(widgets: Array<Record<string, unknown>>, widgetId: number): Record<string, unknown> {
  return {
    error: `widget ${widgetId} not found on this dashboard`,
    widgets: widgets.map((w) => ({ id: w.id, i: w.i, title: w.title })),
  }
}

// report_chart multi-series (verified against the DashboardLinks widget payload): each item is
// {seriestype, yaxis, seq}; seriestype 1 = line. Halo assigns id/widget_id server-side on save.
function normalizeSeries(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }
  return raw
    .filter(
      (s): s is Record<string, unknown> =>
        s !== null && typeof s === 'object' && typeof (s as Record<string, unknown>).yaxis === 'string',
    )
    .map((s, idx) => ({
      seriestype: typeof s.seriestype === 'number' ? s.seriestype : 1,
      yaxis: s.yaxis,
      seq: typeof s.seq === 'number' ? s.seq : idx + 1,
    }))
}

// keys the caller can never override via extra_fields
function mergeExtra(base: Record<string, unknown>, extra: unknown): Record<string, unknown> {
  if (extra === null || typeof extra !== 'object') {
    return base
  }
  const merged = { ...base, ...(extra as Record<string, unknown>) }
  merged.i = base.i
  if ('id' in base) {
    merged.id = base.id
  } else {
    delete merged.id
  }
  if ('guid' in base) {
    merged.guid = base.guid
  } else {
    delete merged.guid
  }
  return merged
}

const WIDGET_FIELD_KEYS = [
  'title',
  'report_id',
  'custom_html',
  'ticketarea_id',
  'view_type',
  'filter_id',
  'columns_id',
  'tree_id',
  'page_size',
  'counter_type',
  'count_format_type',
  'column_name',
  'initialcolour',
  'changedcolour',
  'thresholdvalue',
  'colourchangerule',
  'refresh_rate',
  'style',
  'custom_css',
  'charttype',
  'xaxis',
  'yaxis',
  'xaxiscaption',
  'multiseriestype',
  'graphorderby',
  'graphorder',
  'autosize',
  'sum',
  'x',
  'y',
  'w',
  'h',
] as const

const dashboardDetailParams = {
  use: z.number().optional().describe('0 = dashboard (default), 1 = tab dashboard'),
  rowheight: z.number().optional().describe('Grid row height px (default 100)'),
  reportingperiod: z.number().optional().describe('Reporting period override for report widgets'),
  list_item_height: z.number().optional(),
  share_with_org: z
    .boolean()
    .optional()
    .describe(
      'true = grant the whole organisation view access (REPLACES all existing grants with the org grant); false = remove all access grants. Omit to leave grants untouched.',
    ),
  org_id: z
    .number()
    .optional()
    .describe('Organisation id for share_with_org when the tenant has more than one (auto-resolved when single)'),
  confirm_token: z.string().optional().describe('Token from a prior preview call to commit the write'),
}

const widgetParams = {
  dashboard_id: z.number().describe('Dashboard id (from halopsa_list_dashboards)'),
  title: z.string().optional().describe('Widget title'),
  report_id: z.number().optional().describe('Source report id; REQUIRED for report_data/report_chart/report_counter'),
  custom_html: z.string().optional().describe('HTML body for custom_html widgets (max 10000 chars)'),
  ticketarea_id: z.number().optional().describe('Ticket area id for ticket_* widgets'),
  view_type: z.string().optional().describe("Ticket view scope, e.g. 'all'"),
  filter_id: z.number().optional().describe('Saved ticket filter id'),
  columns_id: z.number().optional().describe('Column profile id for ticket lists'),
  tree_id: z.number().optional(),
  page_size: z.number().optional(),
  counter_type: z.number().optional().describe('Counter aggregation: 0 = row count, 1 = sum of column'),
  count_format_type: z.number().optional(),
  column_name: z.string().optional().describe('Column a counter aggregates'),
  initialcolour: z.string().optional().describe("Counter colour hex, e.g. '#000000'"),
  changedcolour: z.string().optional().describe('Colour once thresholdvalue is crossed'),
  thresholdvalue: z.number().optional(),
  colourchangerule: z.number().optional(),
  refresh_rate: z.number().optional().describe('Seconds between widget refreshes'),
  style: z
    .number()
    .optional()
    .describe(
      'Appearance: presumed 0=default, 1=no border, 2=no border+hover, 3=compact no border no scroll, 4=compact no border, 5=compact with border, 6=bubble (dropdown order, unverified)',
    ),
  custom_css: z.string().optional().describe('Scoped by #widget-<i> selectors'),
  charttype: z
    .number()
    .optional()
    .describe('report_chart type: 5 = multi-series (line/bar), pair with xaxis + series[]. -1 = table.'),
  xaxis: z.string().optional().describe('Chart x-axis column (report column name)'),
  yaxis: z.string().optional().describe('Single-series y-axis column; leave empty and use series[] for multi-series'),
  xaxiscaption: z.string().optional().describe('X-axis title shown on the chart'),
  multiseriestype: z.number().optional().describe('Multi-series mode for charttype 5 (0 = default)'),
  graphorderby: z.string().optional().describe('Column the chart sorts by (usually the x-axis column)'),
  graphorder: z.number().optional().describe('Chart sort order: 0 = ascending, 1 = descending'),
  autosize: z.boolean().optional().describe('Auto-size the chart to fill the widget'),
  sum: z.boolean().optional().describe('Sum y-axis values across rows'),
  series: z
    .array(
      z.object({
        yaxis: z.string().describe('Report column plotted as this series'),
        seriestype: z
          .number()
          .optional()
          .describe('Series render type; 1 = line (default). Other ints = bar/area/etc (discover via the UI).'),
        seq: z.number().optional().describe('1-based series order; defaults to array position'),
      }),
    )
    .optional()
    .describe(
      'Multi-series chart definition for report_chart + charttype 5: each entry maps a report column to a plotted line/bar. Best set on halopsa_update_dashboard_widget after the chart widget exists.',
    ),
  x: z.number().optional().describe('Grid column (12-col grid)'),
  y: z.number().optional().describe('Grid row'),
  w: z.number().optional().describe('Width in grid columns (default 4)'),
  h: z.number().optional().describe('Height in grid rows (default 3)'),
  extra_fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Passthrough for Widget schema fields not listed here; cannot override id/guid/i'),
  confirm_token: z.string().optional().describe('Token from a prior preview call to commit the write'),
}

const disabledError = { error: 'writes disabled, enable writesEnabled in halopsa plugin settings' }

export const dashboardWriteTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_create_dashboard',
    description:
      'Create an empty HaloPSA dashboard. Two-step by default: preview then re-call with confirm_token. Add widgets afterwards with halopsa_add_dashboard_widget. New dashboards are visible only to the creating API agent until shared - pass share_with_org: true to grant the whole organisation view access.',
    keywords: ['halopsa', 'dashboard', 'create', 'write'],
    params: { name: z.string().describe('Dashboard name'), ...dashboardDetailParams },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      const payload = {
        use: 0,
        in_app: true,
        display_type: '3',
        rowheight: 100,
        ...pickDefined(args, DASHBOARD_FIELDS),
      }
      const guardPayload = { ...payload, ...pickDefined(args, SHARE_FIELDS) }
      // resolves at preview too, so a multi-org tenant errors before anything persists
      const userAccess = await orgUserAccess(ctx, args)
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const { confirmToken } = await guard.confirm('halopsa_create_dashboard', guardPayload)
        return {
          preview: { ...guardPayload, ...(userAccess !== undefined ? { user_access: userAccess } : {}) },
          confirm_token: confirmToken,
        }
      }
      await guard.commit('halopsa_create_dashboard', guardPayload, args.confirm_token)
      const client = await getClient(ctx)
      const created = (await client.saveDashboard(payload)) as Record<string, unknown>
      // grants ride a second partial POST against the new id; create payload itself is untested with user_access
      if (userAccess !== undefined) {
        await client.saveDashboard({ id: created.id, use: payload.use, user_access: userAccess })
      }
      return {
        ...haloDashboardUrls({ id: created.id, name: created.name }, client),
        ...(userAccess !== undefined ? { user_access: userAccess } : {}),
      }
    },
  }),

  defineTool({
    name: 'halopsa_update_dashboard',
    description:
      'Update HaloPSA dashboard details (name, row height, reporting period) and sharing (share_with_org grants/revokes whole-organisation view access). Never touches widgets or layout; use the widget tools for those. Two-step by default.',
    keywords: ['halopsa', 'dashboard', 'update', 'share', 'write'],
    params: {
      id: z.number().describe('Dashboard id'),
      name: z.string().optional().describe('Dashboard name'),
      ...dashboardDetailParams,
    },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      const { id } = args
      // details only, widgets/layouts stay untouched (top-level merge is safe, verified against a live halo instance)
      const changes = pickDefined(args, DASHBOARD_FIELDS)
      if (Object.keys(changes).length === 0 && args.share_with_org === undefined) {
        return { error: 'no fields to update' }
      }
      const guardPayload = { id, ...changes, ...pickDefined(args, SHARE_FIELDS) }
      const userAccess = await orgUserAccess(ctx, args)
      const payload = { id, ...changes, ...(userAccess !== undefined ? { user_access: userAccess } : {}) }
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const client = await getClient(ctx)
        let current: Record<string, unknown>
        try {
          current = (await client.getDashboardById(id)) as Record<string, unknown>
        } catch (err) {
          if (isUnauthorized(err)) {
            return { error: dashboardAccessError(id) }
          }
          throw err
        }
        const diff: Record<string, { current: unknown; new: unknown }> = {}
        for (const [key, value] of Object.entries(changes)) {
          diff[key] = { current: current[key], new: value }
        }
        if (userAccess !== undefined) {
          diff.user_access = { current: current.user_access ?? [], new: userAccess }
        }
        const { confirmToken } = await guard.confirm('halopsa_update_dashboard', guardPayload)
        return { preview: { action: 'update_dashboard', id, changes: diff }, confirm_token: confirmToken }
      }
      await guard.commit('halopsa_update_dashboard', guardPayload, args.confirm_token)
      const client = await getClient(ctx)
      const updated = (await client.saveDashboard(payload)) as Record<string, unknown>
      return haloDashboardUrls({ id: updated.id, name: updated.name }, client)
    },
  }),

  defineTool({
    name: 'halopsa_add_dashboard_widget',
    description: `Add a widget to a HaloPSA dashboard. Types: ${Object.keys(WIDGET_TYPES).join(', ')}. report_data/report_chart/report_counter need report_id. Auto-placed at the bottom unless x/y/w/h given. For a multi-series line/bar chart use report_chart + charttype 5 + xaxis + series[] (each {yaxis, seriestype:1=line}). Two-step by default. Existing widgets are never affected.`,
    keywords: ['halopsa', 'dashboard', 'widget', 'add', 'write'],
    params: {
      type: z.enum(Object.keys(WIDGET_TYPES) as [string, ...string[]]).describe('Widget type'),
      ...widgetParams,
    },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      const typeName = args.type
      const typeInt = WIDGET_TYPES[typeName]
      if (typeInt === undefined) {
        return { error: `unknown widget type '${typeName}'. valid: ${Object.keys(WIDGET_TYPES).join(', ')}` }
      }
      if (REPORT_BACKED_TYPES.has(typeName) && typeof args.report_id !== 'number') {
        return { error: `widget type '${typeName}' requires report_id (see halopsa_list_reports)` }
      }
      const series = normalizeSeries(args.series)
      const fields = { ...pickDefined(args, WIDGET_FIELD_KEYS), ...(series ? { series } : {}) }
      const guardPayload = {
        dashboard_id: args.dashboard_id,
        type: typeName,
        fields,
        extra_fields: args.extra_fields ?? null,
      }
      const state = await fetchDashboardState(ctx, args.dashboard_id)
      const i = nextWidgetKey(state.widgets)
      const w = args.w ?? 4
      const h = args.h ?? 3
      const placed = autoPlace(state.layouts, w, h)
      const x = args.x ?? placed.x
      const y = args.y ?? placed.y
      let widget: Record<string, unknown> = {
        ...pickDefined(args, WIDGET_FIELD_KEYS),
        ...(series ? { series } : {}),
        type: typeInt,
        i,
        x,
        y,
        w,
        h,
      }
      widget = mergeExtra(widget, args.extra_fields)
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const { confirmToken } = await guard.confirm('halopsa_add_dashboard_widget', guardPayload)
        return {
          preview: {
            action: 'add_widget',
            dashboard: state.raw.name,
            widget,
            layout_breakpoints_gaining_entry:
              Object.keys(state.layouts).length > 0 ? Object.keys(state.layouts) : ['lg'],
          },
          confirm_token: confirmToken,
        }
      }
      await guard.commit('halopsa_add_dashboard_widget', guardPayload, args.confirm_token)
      const keep = new Set([...state.widgets.map((sw) => String(sw.i)), i])
      const layouts = layoutsWithAdded(layoutsPruned(state.layouts, keep), i, { x, y, w, h })
      const client = await getClient(ctx)
      const saved = (await client.saveDashboard({
        id: args.dashboard_id,
        widgets: [...state.widgets, widget],
        layouts: serializeLayouts(layouts),
      })) as Record<string, unknown>
      const savedWidgets = (saved.widgets ?? []) as Array<Record<string, unknown>>
      return { dashboard_id: saved.id, added: trimWidget(savedWidgets[savedWidgets.length - 1] ?? widget) }
    },
  }),

  defineTool({
    name: 'halopsa_update_dashboard_widget',
    description:
      'Update one widget on a HaloPSA dashboard by widget id (from halopsa_get_dashboard). Only supplied fields change; geometry changes update the grid layout in every breakpoint. Pass series[] to (re)configure a report_chart multi-series chart (charttype 5). Two-step by default.',
    keywords: ['halopsa', 'dashboard', 'widget', 'update', 'write'],
    params: { widget_id: z.number().describe('Widget id from halopsa_get_dashboard'), ...widgetParams },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      const widgetId = args.widget_id
      const series = normalizeSeries(args.series)
      const changes = { ...pickDefined(args, WIDGET_FIELD_KEYS), ...(series ? { series } : {}) }
      const guardPayload = {
        dashboard_id: args.dashboard_id,
        widget_id: widgetId,
        changes,
        extra_fields: args.extra_fields ?? null,
      }
      const state = await fetchDashboardState(ctx, args.dashboard_id)
      const target = state.widgets.find((w) => w.id === widgetId)
      if (!target) {
        return widgetNotFound(state.widgets, widgetId)
      }
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const diff: Record<string, { current: unknown; new: unknown }> = {}
        for (const [key, value] of Object.entries(changes)) {
          diff[key] = { current: target[key], new: value }
        }
        const { confirmToken } = await guard.confirm('halopsa_update_dashboard_widget', guardPayload)
        return {
          preview: {
            action: 'update_widget',
            dashboard: state.raw.name,
            widget: { id: target.id, i: target.i, title: target.title },
            changes: diff,
            extra_fields: args.extra_fields ?? undefined,
          },
          confirm_token: confirmToken,
        }
      }
      await guard.commit('halopsa_update_dashboard_widget', guardPayload, args.confirm_token)
      // target keeps id+guid (verified against a live halo instance), others round-trip verbatim
      let updated: Record<string, unknown> = { ...target, ...changes }
      updated = mergeExtra(updated, args.extra_fields)
      const widgets = state.widgets.map((w) => (w.id === widgetId ? updated : w))
      const geom = pickDefined(args, ['x', 'y', 'w', 'h']) as Partial<{ x: number; y: number; w: number; h: number }>
      const keep = new Set(widgets.map((w) => String(w.i)))
      let layouts = layoutsPruned(state.layouts, keep)
      if (Object.keys(geom).length > 0) {
        layouts = layoutsWithGeometry(layouts, String(target.i), geom)
      }
      const client = await getClient(ctx)
      const saved = (await client.saveDashboard({
        id: args.dashboard_id,
        widgets,
        layouts: serializeLayouts(layouts),
      })) as Record<string, unknown>
      return { dashboard_id: saved.id, updated: { id: widgetId, i: target.i } }
    },
  }),

  defineTool({
    name: 'halopsa_remove_dashboard_widget',
    description:
      'Remove one widget from a HaloPSA dashboard by widget id. Other widgets and the rest of the layout are untouched. Two-step by default.',
    keywords: ['halopsa', 'dashboard', 'widget', 'remove', 'delete', 'write'],
    params: {
      dashboard_id: z.number().describe('Dashboard id'),
      widget_id: z.number().describe('Widget id from halopsa_get_dashboard'),
      confirm_token: z.string().optional().describe('Token from a prior preview call to commit the write'),
    },
    readOnly: false,
    handler: async (args, ctx) => {
      if (!(await writesEnabled(ctx))) {
        return disabledError
      }
      const widgetId = args.widget_id
      const guardPayload = { dashboard_id: args.dashboard_id, widget_id: widgetId }
      const state = await fetchDashboardState(ctx, args.dashboard_id)
      const target = state.widgets.find((w) => w.id === widgetId)
      if (!target) {
        return widgetNotFound(state.widgets, widgetId)
      }
      const guard = createWriteGuard(ctx.store)
      if (!args.confirm_token) {
        const { confirmToken } = await guard.confirm('halopsa_remove_dashboard_widget', guardPayload)
        return {
          preview: {
            action: 'remove_widget',
            dashboard: state.raw.name,
            removing: { id: target.id, i: target.i, title: target.title, type: target.type },
            remaining_count: state.widgets.length - 1,
          },
          confirm_token: confirmToken,
        }
      }
      await guard.commit('halopsa_remove_dashboard_widget', guardPayload, args.confirm_token)
      const widgets = state.widgets.filter((w) => w.id !== widgetId)
      const keep = new Set(widgets.map((w) => String(w.i)))
      const layouts = layoutsPruned(state.layouts, keep)
      const client = await getClient(ctx)
      const saved = (await client.saveDashboard({
        id: args.dashboard_id,
        widgets,
        layouts: serializeLayouts(layouts),
      })) as Record<string, unknown>
      return { dashboard_id: saved.id, removed: { id: widgetId, i: target.i }, remaining: widgets.length }
    },
  }),
]
