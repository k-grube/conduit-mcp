import { sanitizeUpstreamBody, type PluginContext } from '@conduit-mcp/plugin-sdk'
import { OAuthError, refreshAccessToken, type TokenResult } from './oauth.js'
import { secretNamesFor, type QboEnvironment } from './secret-names.js'

export type { QboEnvironment }

export type QboErrorEnvelope =
  | { error: 'not_connected'; message: string; environment: QboEnvironment }
  | { error: 'reauth_required'; message: string; intuitTid?: string }
  | { error: 'kv_write_failed'; message: string }
  | { error: 'qbo_api_error'; status: number; code?: string; detail?: unknown; intuitTid?: string }
  | { error: 'halo_link_missing'; halo_client_id: number; message: string }
  | { error: 'report_range_too_large'; message: string }

export type QboResult<T> = T | QboErrorEnvelope

// per-environment state that plugins can't persist via ctx.getConfig (read-only), kept in ctx.store instead
export interface QboEnvState {
  realmId?: string
  connectedAt?: string
  refreshTokenRotatedAt?: string
  refreshTokenExpiresAt?: string
}

const SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com'
const PRODUCTION_API_BASE = 'https://quickbooks.api.intuit.com'

function apiBase(env: QboEnvironment): string {
  return env === 'sandbox' ? SANDBOX_API_BASE : PRODUCTION_API_BASE
}

export function stateKey(env: QboEnvironment): string {
  return `state:${env}`
}

type TokenOutcome = { ok: true; access: string } | { ok: false; envelope: QboErrorEnvelope }

export class QboClient {
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
  private inFlightRefresh: Promise<TokenOutcome> | null = null

  constructor(
    readonly environment: QboEnvironment,
    private readonly ctx: PluginContext,
    private readonly fetchFn: typeof fetch,
  ) {}

  private async realmId(): Promise<string | undefined> {
    const state = await this.ctx.store.get<QboEnvState>(stateKey(this.environment))
    return state?.realmId
  }

  private buildUrl(realmId: string, path: string): string {
    return `${apiBase(this.environment)}/v3/company/${realmId}/${path.replace(/^\//, '')}`
  }

  /** Returns either an access token or a structured error envelope. */
  private async ensureAccessToken(force = false): Promise<TokenOutcome> {
    const cachedToken = this.accessToken
    if (!force && cachedToken && this.accessTokenExpiresAt - 60_000 > Date.now()) {
      return { ok: true, access: cachedToken }
    }
    // if a refresh is already in flight, wait for it
    if (this.inFlightRefresh) {
      const result = await this.inFlightRefresh
      // caller forced a refresh but the in-flight result handed back the same token we were
      // trying to invalidate -- fall through to start a new refresh instead of reusing it
      if (!(force && result.ok && result.access === cachedToken)) {
        return result
      }
    }
    this.inFlightRefresh = this.doRefresh()
    try {
      return await this.inFlightRefresh
    } finally {
      this.inFlightRefresh = null
    }
  }

  private async doRefresh(): Promise<TokenOutcome> {
    const names = secretNamesFor(this.environment)
    let existing: string
    try {
      existing = await this.ctx.getSecret(names.refreshToken)
    } catch {
      return {
        ok: false,
        envelope: {
          error: 'not_connected',
          message: `No refresh token stored for ${this.environment}. Connect from the admin UI.`,
          environment: this.environment,
        },
      }
    }

    let clientId: string
    let clientSecret: string
    try {
      const creds = await Promise.all([this.ctx.getSecret(names.clientId), this.ctx.getSecret(names.clientSecret)])
      clientId = creds[0]
      clientSecret = creds[1]
    } catch (err) {
      return {
        ok: false,
        envelope: {
          error: 'not_connected',
          message: `Missing client credentials: ${err instanceof Error ? sanitizeUpstreamBody(err.message) : String(err)}`,
          environment: this.environment,
        },
      }
    }

    let token: TokenResult
    try {
      token = await refreshAccessToken({ refreshToken: existing, clientId, clientSecret }, this.fetchFn)
    } catch (err) {
      const isOAuth = err instanceof OAuthError
      const intuitTid = isOAuth ? err.intuitTid : undefined
      if (isOAuth) {
        this.ctx.logger.warn('refresh_failed', { environment: this.environment, code: err.code, intuitTid })
      }
      if (isOAuth && (err.code === 'invalid_grant' || err.status === 400)) {
        return {
          ok: false,
          envelope: {
            error: 'reauth_required',
            message: 'QuickBooks refresh token expired or revoked. Reconnect from the admin UI.',
            ...(intuitTid ? { intuitTid } : {}),
          },
        }
      }
      return {
        ok: false,
        envelope: {
          error: 'qbo_api_error',
          status: isOAuth ? (err.status ?? 0) : 0,
          code: isOAuth ? err.code : undefined,
          detail: err instanceof Error ? sanitizeUpstreamBody(err.message) : err,
          ...(intuitTid ? { intuitTid } : {}),
        },
      }
    }

    // persist the rotated refresh token before the new access token is ever used
    try {
      await this.ctx.setSecret(names.refreshToken, token.refreshToken)
    } catch (err) {
      this.ctx.logger.error('refresh_token_persist_failed', {
        environment: this.environment,
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        ok: false,
        envelope: {
          error: 'kv_write_failed',
          message: `Failed to persist refresh token: ${err instanceof Error ? sanitizeUpstreamBody(err.message) : String(err)}`,
        },
      }
    }

    // status bookkeeping only (rotatedAt/expiresAt) -- the refresh token itself is already
    // durably persisted above, never fail the refresh over a transient store write here
    try {
      const now = new Date().toISOString()
      const prev = (await this.ctx.store.get<QboEnvState>(stateKey(this.environment))) ?? {}
      await this.ctx.store.set(stateKey(this.environment), {
        ...prev,
        refreshTokenRotatedAt: now,
        refreshTokenExpiresAt: new Date(token.refreshTokenExpiresAt).toISOString(),
      })
    } catch (err) {
      this.ctx.logger.error('rotation_bookkeeping_failed', {
        environment: this.environment,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    this.accessToken = token.accessToken
    this.accessTokenExpiresAt = token.accessTokenExpiresAt
    return { ok: true, access: token.accessToken }
  }

  /** Run a QBO query. Returns parsed JSON or an error envelope. */
  async query<T = unknown>(sql: string, extraParams?: Record<string, string>): Promise<QboResult<T>> {
    const params = new URLSearchParams({ query: sql, ...(extraParams ?? {}) })
    return this.request<T>('GET', `query?${params.toString()}`)
  }

  /** Generic GET against a QBO entity endpoint (e.g. customer/123, reports/AgedReceivables). */
  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<QboResult<T>> {
    const search = params ? `?${new URLSearchParams(params).toString()}` : ''
    return this.request<T>('GET', `${path}${search}`)
  }

  private async request<T>(method: 'GET', path: string, retried = false): Promise<QboResult<T>> {
    const realmId = await this.realmId()
    if (!realmId) {
      return {
        error: 'not_connected',
        message: `No realmId configured for ${this.environment}. Connect from the admin UI.`,
        environment: this.environment,
      }
    }
    const tokenResult = await this.ensureAccessToken()
    if (!tokenResult.ok) {
      return tokenResult.envelope
    }
    let response: Response
    try {
      response = await this.fetchFn(this.buildUrl(realmId, path), {
        method,
        headers: {
          authorization: `Bearer ${tokenResult.access}`,
          accept: 'application/json',
        },
        // never follow a redirect, a cross-origin hop would leak the bearer token to another host
        redirect: 'error',
      })
    } catch (err) {
      return {
        error: 'qbo_api_error',
        status: 0,
        detail: err instanceof Error ? sanitizeUpstreamBody(err.message) : err,
      }
    }

    const intuitTid = response.headers.get('intuit_tid') ?? undefined

    if (response.status === 401 && !retried) {
      this.ctx.logger.warn('forced_refresh_retry', { environment: this.environment, intuitTid })
      const refreshed = await this.ensureAccessToken(true)
      if (!refreshed.ok) {
        return refreshed.envelope
      }
      return this.request<T>(method, path, true)
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = { _raw: text }
    }

    if (!response.ok) {
      const fault = (parsed as { Fault?: { Error?: Array<{ code?: string; Message?: string }> } }).Fault
      const code = fault?.Error?.[0]?.code
      this.ctx.logger.warn('qbo_api_error', { environment: this.environment, status: response.status, code })
      return {
        error: 'qbo_api_error',
        status: response.status,
        code,
        detail: parsed,
        ...(intuitTid ? { intuitTid } : {}),
      }
    }
    return parsed as T
  }
}

// module-scope holder, one client per environment, reset on disconnect / between tests
const clients = new Map<QboEnvironment, QboClient>()

export async function getQboClient(ctx: PluginContext, fetchFn: typeof fetch = fetch): Promise<QboClient> {
  const cfg = await ctx.getConfig<{ environment?: string }>()
  const env: QboEnvironment = cfg.environment === 'production' ? 'production' : 'sandbox'
  let client = clients.get(env)
  if (!client) {
    client = new QboClient(env, ctx, fetchFn)
    clients.set(env, client)
  }
  return client
}

/** Test helper / disconnect handler -- drops cached clients so a stale token doesn't linger. */
export function resetQboClient(): void {
  clients.clear()
}

export function isQboError(value: unknown): value is QboErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}
