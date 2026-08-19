import { defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'
import { getClient } from '../client.js'
import { haloDashboardUrls } from '../fields.js'

// type ints extracted from the halo ui react state
export const WIDGET_TYPES: Record<string, number> = {
  report_data: 0,
  report_chart: 1,
  report_counter: 2,
  feature_menu: 3,
  activity_feed: 4,
  custom_html: 5,
  ticket_list: 6,
  ticket_list_counter: 7,
  news_articles: 8,
  ticket_calendar: 9,
  ticket_kanban: 10,
  ticket_gantt: 11,
  iframe: 22,
  asset_list: 24,
}

export const WIDGET_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(WIDGET_TYPES).map(([name, id]) => [id, name]),
)

const WIDGET_CORE_FIELDS = ['id', 'i', 'type', 'title', 'x', 'y', 'w', 'h', 'style'] as const
const WIDGET_OPTIONAL_FIELDS = [
  'report_id',
  'custom_css',
  'custom_html',
  'ticketarea_id',
  'view_type',
  'filter_id',
  'columns_id',
  'tree_id',
  'page_size',
  'counter_type',
  'refresh_rate',
] as const

export function trimWidget(w: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of WIDGET_CORE_FIELDS) {
    out[key] = w[key]
  }
  out.type_name = WIDGET_TYPE_NAMES[w.type as number] ?? `unknown_${w.type}`
  for (const key of WIDGET_OPTIONAL_FIELDS) {
    const value = w[key]
    if (value !== undefined && value !== null && value !== '' && value !== 0) {
      out[key] = value
    }
  }
  return out
}

// sdk's OAuthCcClient throws `request failed: {status} {bodyText}`, not an axios-shaped error
export function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && /^request failed: 401\b/.test(err.message)
}

export function dashboardAccessError(id: number): string {
  return `The API application lacks access to dashboard ${id} (Halo returns 401 for restricted dashboards). Grant it access in Halo or pick another dashboard.`
}

export const dashboardTools: ToolDef[] = [
  defineTool({
    name: 'halopsa_list_dashboards',
    description:
      'List HaloPSA dashboards (id, name, use, in_app, is_published). Use halopsa_get_dashboard for widgets and layout.',
    keywords: ['halopsa', 'dashboard', 'list'],
    params: {},
    readOnly: true,
    handler: async (_params, ctx) => {
      const client = await getClient(ctx)
      const raw = (await client.getDashboards()) as Array<Record<string, unknown>>
      const dashboards = (Array.isArray(raw) ? raw : []).map((d) =>
        haloDashboardUrls(
          { id: d.id, name: d.name, use: d.use, in_app: d.in_app, is_published: d.is_published ?? false },
          client,
        ),
      )
      return { dashboards }
    },
  }),

  defineTool({
    name: 'halopsa_get_dashboard',
    description:
      'Get one HaloPSA dashboard with its widgets (id, i, type, title, source report) and raw grid layouts. Widget ids from here feed the widget write tools.',
    keywords: ['halopsa', 'dashboard', 'widget', 'get', 'detail'],
    params: { id: z.number().describe('Dashboard id (from halopsa_list_dashboards)') },
    readOnly: true,
    handler: async (params, ctx) => {
      const client = await getClient(ctx)
      let raw: Record<string, unknown>
      try {
        raw = (await client.getDashboardById(params.id, { includedetails: true })) as Record<string, unknown>
      } catch (err) {
        if (isUnauthorized(err)) {
          return { error: dashboardAccessError(params.id) }
        }
        throw err
      }
      const widgets = ((raw.widgets ?? []) as Array<Record<string, unknown>>).map(trimWidget)
      return haloDashboardUrls(
        {
          id: raw.id,
          name: raw.name,
          use: raw.use,
          rowheight: raw.rowheight,
          reportingperiod: raw.reportingperiod,
          layouts: raw.layouts,
          widgets,
        },
        client,
      )
    },
  }),
]
