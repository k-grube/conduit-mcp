import { OAuthCcClient, assertEgressUrl, type PluginContext } from '@conduit-mcp/plugin-sdk'

// halo quirk: pageinate=true alone is not enough. without page_no halo ignores
// page_size and returns a 50-row default batch with record_count=50, breaking
// "how many" answers. spread before caller params so they get overridden if given.
const PAGINATE_DEFAULTS = { pageinate: true, page_no: 1, page_size: 50 } as const

// executeQuery times out slower than the rest of the api (sql reports can be heavy)
const QUERY_TIMEOUT_MS = 30_000

export interface HaloPSAClientOptions {
  companyUrl: string
  clientId: string
  clientSecret: string
  scope: string
  tenant?: string
  fetchFn?: typeof fetch
}

export class HaloPSAClient {
  readonly baseUrl: string
  private oauth: OAuthCcClient
  private fetchFn: typeof fetch

  constructor(opts: HaloPSAClientOptions) {
    this.baseUrl = assertEgressUrl(opts.companyUrl)
    this.fetchFn = opts.fetchFn ?? fetch
    this.oauth = new OAuthCcClient({
      tokenUrl: `${this.baseUrl}/auth/token`,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      scope: opts.scope,
      extraParams: opts.tenant ? { tenant: opts.tenant } : undefined,
      fetchFn: this.fetchFn,
    })
  }

  // healthCheck hook, confirms the client credentials actually mint a token
  async verifyAuth(): Promise<void> {
    await this.oauth.getToken()
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}/api${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    return url.toString()
  }

  private get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.oauth.request<T>(this.buildUrl(path, params))
  }

  private post<T = unknown>(path: string, body: unknown, init: RequestInit = {}): Promise<T> {
    return this.oauth.request<T>(this.buildUrl(path), {
      ...init,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  // Tickets
  async getTickets(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Tickets', { ...PAGINATE_DEFAULTS, ...params })
  }

  async getTicketById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/Tickets/${id}`, params)
  }

  // Clients
  async getClients(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Client', { ...PAGINATE_DEFAULTS, ...params })
  }

  async getClientById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/Client/${id}`, params)
  }

  // Users (end users/contacts)
  async getUsers(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Users', { ...PAGINATE_DEFAULTS, ...params })
  }

  // Assets
  async getAssets(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Asset', { ...PAGINATE_DEFAULTS, ...params })
  }

  async getAssetById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/Asset/${id}`, params)
  }

  // SQL Reporting query (POST /report with SQL body, halo misspells "pageinate" but this endpoint doesn't take it)
  // halo /report collapses a multi-object body to the last result, so batches post per statement
  async executeQuery(sql: string | string[]): Promise<unknown> {
    if (!Array.isArray(sql)) {
      return this.postQueryStatement(sql)
    }
    const results: unknown[] = []
    for (const statement of sql) {
      results.push(await this.postQueryStatement(statement))
    }
    return results
  }

  private async postQueryStatement(sql: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS)
    try {
      return await this.post('/report', [{ id: -1, _loadreportonly: true, sql }], { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  // Reports (halo uses lowercase /report and misspells "pageinate")
  async getReports(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/report', params)
  }

  async getReportById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/report/${id}`, params)
  }

  // POST semantics: no id = insert, id = merge
  async saveReport(payload: Record<string, unknown>): Promise<unknown> {
    return this.post('/report', [payload])
  }

  // Dashboards (DashboardLinks). list endpoint returns no widgets; detail needs includedetails
  async getDashboards(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/DashboardLinks', { showall: true, ...params })
  }

  async getDashboardById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/DashboardLinks/${id}`, params)
  }

  // POST semantics: no id = insert, id = merge. widgets array is a full replace, user_access too
  async saveDashboard(payload: Record<string, unknown>): Promise<unknown> {
    return this.post('/DashboardLinks', [payload])
  }

  async getOrganisations(): Promise<unknown> {
    return this.get('/Organisation')
  }

  // Ticket Actions
  async getTicketActions(ticketId: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Actions', { ticket_id: ticketId, ...params })
  }

  async addTicketAction(ticketId: number, action: Record<string, unknown>): Promise<unknown> {
    return this.post('/Actions', [{ ticket_id: ticketId, ...action }])
  }

  async createTicket(payload: Record<string, unknown>): Promise<unknown> {
    return this.post('/Tickets', [payload])
  }

  // CRM note = out-of-ticket activity against a client/user/site
  async createCrmNote(payload: Record<string, unknown>): Promise<unknown> {
    return this.post('/CRMNote', [payload])
  }

  // Outcomes (for actions) -- top-level /Outcome, there is no /Actions/Outcome route
  async getOutcomes(): Promise<unknown> {
    return this.get('/Outcome')
  }

  // Statuses -- type: 'ticket' filters to ticket statuses (others: 'opportunity', 'project', etc.)
  // this tenant's API rejects numeric type values as unknown and returns unfiltered/empty
  async getStatuses(): Promise<unknown> {
    return this.get('/Status', { type: 'ticket' })
  }

  // Agents
  async getAgents(): Promise<unknown> {
    return this.get('/Agent')
  }

  // Quotations
  async getQuotations(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Quotation', { ...PAGINATE_DEFAULTS, order: 'date', orderdesc: true, ...params })
  }

  async getQuotationById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/Quotation/${id}`, params)
  }

  // Lookups; report groups are lookupid=41, quote status is 39, request source is 22
  async getLookup(lookupId: number): Promise<unknown> {
    return this.get('/Lookup', { lookupid: lookupId })
  }

  // generic lookup list fetch, used by report group resolution
  async getLookups(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Lookup', params)
  }

  async saveLookup(payload: Record<string, unknown>): Promise<unknown> {
    return this.post('/Lookup', [payload])
  }

  // Ticket types
  async getTicketTypes(): Promise<unknown> {
    return this.get('/TicketType', { showall: true, showinactive: true })
  }

  // Opportunities (pre-filtered tickets)
  async getOpportunities(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Opportunities', { ...PAGINATE_DEFAULTS, ...params })
  }

  // Projects (pre-filtered tickets)
  async getProjects(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/Projects', { ...PAGINATE_DEFAULTS, ...params })
  }

  // Contracts
  async getContracts(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/ClientContract', { ...PAGINATE_DEFAULTS, order: 'id', orderdesc: true, ...params })
  }

  async getContractById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/ClientContract/${id}`, params)
  }

  // Invoices (generated/actual)
  async getInvoiceById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/Invoice/${id}`, { includedetails: true, ...params })
  }

  // Recurring Invoices
  async getRecurringInvoices(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/RecurringInvoice', { ...PAGINATE_DEFAULTS, order: 'id', orderdesc: true, ...params })
  }

  async getRecurringInvoiceById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/RecurringInvoice/${id}`, { includedetails: true, ...params })
  }

  // Software Licences (subscriptions: licence_type=1, licenses: licence_type=0)
  async getSoftwareLicences(params?: Record<string, unknown>): Promise<unknown> {
    return this.get('/SoftwareLicence', { ...PAGINATE_DEFAULTS, order: 'id', orderdesc: true, ...params })
  }

  async getSoftwareLicenceById(id: number, params?: Record<string, unknown>): Promise<unknown> {
    return this.get(`/SoftwareLicence/${id}`, params)
  }

  async getAttachments(params: Record<string, unknown>): Promise<unknown> {
    return this.get('/Attachment', params)
  }
}

// single config per plugin, module-scope holder cached across tool calls
let cached: HaloPSAClient | undefined

export async function getClient(ctx: PluginContext, fetchFn?: typeof fetch): Promise<HaloPSAClient> {
  if (!cached) {
    const cfg = await ctx.getConfig<{ companyUrl?: string; clientId?: string; oauthScope?: string; tenant?: string }>()
    if (!cfg.companyUrl || !cfg.clientId) {
      throw new Error('missing required halopsa setting: companyUrl or clientId')
    }
    const clientSecret = await ctx.getSecret('HALOPSA_CLIENT_SECRET')
    cached = new HaloPSAClient({
      companyUrl: cfg.companyUrl,
      clientId: cfg.clientId,
      clientSecret,
      // oauthScope optional, defaults to full access; tenant optional, single-tenant instances leave it blank
      scope: cfg.oauthScope || 'all',
      tenant: cfg.tenant || undefined,
      fetchFn,
    })
  }
  return cached
}

export function resetClient(): void {
  cached = undefined
}
