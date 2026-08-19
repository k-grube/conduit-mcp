import { OAuthCcClient, assertEgressUrl, type PluginContext } from '@conduit-mcp/plugin-sdk'

// SDK request() throws `request failed: {status} {bodyText}` (and the token path prefixes
// "oauth token "), re-normalize the body into CIPP's own shapes (plain string, JSON array of
// strings, or {error|message|Message|resultMessage}). unanchored so both variants match.
const SDK_ERROR_RE = /request failed: (\d+) ([\s\S]*)$/

function normalizeError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new Error(String(err))
  }
  const match = SDK_ERROR_RE.exec(err.message)
  if (!match) {
    return err
  }
  const [, status, bodyText] = match
  let detail: string | undefined
  try {
    const data = JSON.parse(bodyText)
    if (typeof data === 'string') {
      detail = data
    } else if (Array.isArray(data)) {
      detail = data.join('; ')
    } else if (data && typeof data === 'object') {
      const val = data.error || data.message || data.Message || data.resultMessage
      if (val) {
        detail = typeof val === 'string' ? val : JSON.stringify(val)
      }
    }
  } catch {
    if (bodyText) {
      detail = bodyText
    }
  }
  return new Error(detail ? `CIPP ${status}: ${detail}` : `CIPP ${status}`)
}

export class CippClient {
  readonly baseUrl: string
  private oauth: OAuthCcClient
  private fetchFn: typeof fetch

  constructor(opts: {
    baseUrl: string
    clientId: string
    clientSecret: string
    tenantId: string
    fetchFn?: typeof fetch
  }) {
    this.baseUrl = assertEgressUrl(opts.baseUrl)
    this.fetchFn = opts.fetchFn ?? fetch
    this.oauth = new OAuthCcClient({
      tokenUrl: `https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      scope: `api://${opts.clientId}/.default`,
      fetchFn: this.fetchFn,
    })
  }

  // healthCheck hook, confirms the client credentials actually mint a token
  async verifyAuth(): Promise<void> {
    await this.oauth.getToken()
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    opts: { params?: Record<string, unknown>; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${path}`)
    if (opts.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    const init: RequestInit = { method }
    if (opts.body !== undefined) {
      init.headers = { 'content-type': 'application/json' }
      init.body = JSON.stringify(opts.body)
    }
    try {
      return await this.oauth.request<T>(url.toString(), init)
    } catch (err) {
      throw normalizeError(err)
    }
  }

  private get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, { params })
  }

  private post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>('POST', path, { body })
  }

  // signin/CA endpoints filter by userId GUID only, a UPN silently returns []
  private async resolveUserId(tenantFilter: string, userId: string): Promise<string> {
    if (!userId.includes('@')) {
      return userId
    }
    const data = await this.get<unknown>('/ListUsers', { tenantFilter })
    const users = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.Results ?? [])
    const needle = userId.toLowerCase()
    const match = (users as Record<string, unknown>[]).find(
      (u) => typeof u.userPrincipalName === 'string' && (u.userPrincipalName as string).toLowerCase() === needle,
    )
    if (!match || typeof match.id !== 'string') {
      throw new Error(`CIPP: no user with UPN ${userId} in tenant ${tenantFilter}`)
    }
    return match.id
  }

  async listUserSigninLogs(params: { tenantFilter: string; userId: string }): Promise<unknown> {
    const userId = await this.resolveUserId(params.tenantFilter, params.userId)
    return this.get('/ListUserSigninLogs', { tenantFilter: params.tenantFilter, UserID: userId })
  }

  async listAuditLogs(params: { tenantFilter: string; StartDate?: string; EndDate?: string }): Promise<unknown> {
    return this.get('/ListAuditLogs', {
      tenantFilter: params.tenantFilter,
      StartDate: params.StartDate,
      EndDate: params.EndDate,
    })
  }

  // submits an async graph security auditLog query, returns a receipt with the search id
  async searchAuditLogs(params: { tenantFilter: string; StartTime: string; EndTime: string }): Promise<unknown> {
    return this.post('/ExecAuditLogSearch', {
      tenantFilter: params.tenantFilter,
      StartTime: params.StartTime,
      EndTime: params.EndTime,
    })
  }

  async getAuditLogSearchResults(params: { tenantFilter: string; searchId: string }): Promise<unknown> {
    return this.get('/ListAuditLogSearches', {
      tenantFilter: params.tenantFilter,
      SearchId: params.searchId,
      Type: 'SearchResults',
    })
  }

  async listMessageTrace(params: {
    tenantFilter: string
    sender?: string
    recipient?: string
    days?: number
  }): Promise<unknown> {
    return this.post('/ListMessageTrace', {
      tenantFilter: params.tenantFilter,
      sender: params.sender || '',
      recipient: params.recipient || '',
      days: params.days || 10,
    })
  }

  async listConditionalAccessPolicies(params: { tenantFilter: string }): Promise<unknown> {
    return this.get('/ListConditionalAccessPolicies', { tenantFilter: params.tenantFilter })
  }

  async listUserConditionalAccessPolicies(params: { tenantFilter: string; userId: string }): Promise<unknown> {
    const userId = await this.resolveUserId(params.tenantFilter, params.userId)
    return this.get('/ListUserConditionalAccessPolicies', { tenantFilter: params.tenantFilter, UserID: userId })
  }

  async getDomainHealth(params: {
    domain: string
    action: string
    selector?: string
    record?: string
  }): Promise<unknown> {
    return this.get('/ListDomainHealth', {
      Domain: params.domain,
      Action: params.action,
      Selector: params.selector,
      Record: params.record,
    })
  }

  // run all core email security checks in parallel
  async getDomainHealthFull(domain: string): Promise<Record<string, unknown>> {
    const actions = ['ReadSpfRecord', 'ReadDmarcPolicy', 'ReadDkimRecord', 'ReadMxRecord']
    const results = await Promise.all(
      actions.map(async (action) => {
        try {
          return { action, data: await this.getDomainHealth({ domain, action }) }
        } catch {
          return { action, data: { error: `Failed to fetch ${action}` } }
        }
      }),
    )
    return Object.fromEntries(results.map((r) => [r.action, r.data]))
  }

  // mfa registered methods per user, replaces legacy per-user mfa
  async listMFAUsers(params: { tenantFilter: string; includeDisabled?: boolean }): Promise<unknown> {
    const data = await this.get<unknown>('/ListMFAUsers', { tenantFilter: params.tenantFilter })
    if (!params.includeDisabled) {
      const results = Array.isArray(data) ? data : (data as Record<string, unknown>)?.Results
      if (Array.isArray(results)) {
        const filtered = (results as Record<string, unknown>[]).filter((u) => u.AccountEnabled !== false)
        return Array.isArray(data) ? filtered : { ...(data as Record<string, unknown>), Results: filtered }
      }
    }
    return data
  }
}

// single config per plugin, module-scope holder cached across tool calls, eager validation on first construction
let cached: CippClient | undefined

export async function getClient(ctx: PluginContext, fetchFn?: typeof fetch): Promise<CippClient> {
  if (!cached) {
    const cfg = await ctx.getConfig<{ baseUrl?: string; clientId?: string; tenantId?: string }>()
    if (!cfg.baseUrl || !cfg.clientId || !cfg.tenantId) {
      throw new Error('missing required cipp setting: baseUrl, clientId, or tenantId')
    }
    const clientSecret = await ctx.getSecret('CIPP_CLIENT_SECRET')
    if (!clientSecret) {
      throw new Error('missing required cipp setting: CIPP_CLIENT_SECRET')
    }
    cached = new CippClient({
      baseUrl: cfg.baseUrl,
      clientId: cfg.clientId,
      clientSecret,
      tenantId: cfg.tenantId,
      fetchFn,
    })
  }
  return cached
}

export function resetClient(): void {
  cached = undefined
}
