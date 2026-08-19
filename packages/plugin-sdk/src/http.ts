export interface OAuthCcOptions {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope?: string
  extraParams?: Record<string, string>
  fetchFn?: typeof fetch
}

interface TokenResponse {
  access_token: string
  expires_in: number
}

// refresh this many ms before actual expiry
const REFRESH_SKEW_MS = 60_000

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

const MAX_UPSTREAM_BODY_CHARS = 200

// caps the upstream-body portion of thrown error messages before they reach tool results,
// usage log rows, and the admin activity feed -- none of those sinks redact
export function sanitizeUpstreamBody(text: string): string {
  const flat = text.replace(/[\r\n]+/g, ' ')
  return flat.length > MAX_UPSTREAM_BODY_CHARS ? `${flat.slice(0, MAX_UPSTREAM_BODY_CHARS)}...` : flat
}

// client-credentials oauth token client with cached refresh
export class OAuthCcClient {
  private tokenUrl: string
  private clientId: string
  private clientSecret: string
  private scope?: string
  private extraParams?: Record<string, string>
  private fetchFn: typeof fetch
  private token?: string
  private expiresAt = 0

  constructor(opts: OAuthCcOptions) {
    this.tokenUrl = opts.tokenUrl
    this.clientId = opts.clientId
    this.clientSecret = opts.clientSecret
    this.scope = opts.scope
    this.extraParams = opts.extraParams
    this.fetchFn = opts.fetchFn ?? fetch
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) {
      return this.token
    }
    return this.refreshToken()
  }

  private async refreshToken(): Promise<string> {
    const params = new URLSearchParams()
    params.set('grant_type', 'client_credentials')
    params.set('client_id', this.clientId)
    params.set('client_secret', this.clientSecret)
    if (this.scope) {
      params.set('scope', this.scope)
    }
    for (const [key, value] of Object.entries(this.extraParams ?? {})) {
      params.set(key, value)
    }

    const res = await this.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
      // never follow a redirect, a cross-origin hop would replay the client secret to another host
      redirect: 'error',
    })
    if (!res.ok) {
      throw new Error(`oauth token request failed: ${res.status} ${sanitizeUpstreamBody(await safeText(res))}`)
    }
    const data = (await res.json()) as TokenResponse
    this.token = data.access_token
    this.expiresAt = Date.now() + data.expires_in * 1000 - REFRESH_SKEW_MS
    return this.token
  }

  async request<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken()
    let res = await this.authedFetch(url, init, token)
    if (res.status === 401) {
      const freshToken = await this.refreshToken()
      res = await this.authedFetch(url, init, freshToken)
    }
    if (!res.ok) {
      throw new Error(`request failed: ${res.status} ${sanitizeUpstreamBody(await safeText(res))}`)
    }
    return (await res.json()) as T
  }

  private authedFetch(url: string, init: RequestInit, token: string): Promise<Response> {
    // Headers() normalizes plain objects, Headers instances, and tuple arrays alike
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    // never follow a redirect, a cross-origin hop would leak the bearer token to another host
    return this.fetchFn(url, { ...init, headers, redirect: 'error' })
  }
}
