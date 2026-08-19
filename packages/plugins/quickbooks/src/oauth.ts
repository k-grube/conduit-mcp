// intuit oauth client, fetch + Basic auth directly, no sdk dependency

export const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const INTUIT_SCOPE = 'com.intuit.quickbooks.accounting'

export interface TokenResult {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
}

export class OAuthError extends Error {
  override readonly name = 'OAuthError'
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly detail?: unknown,
    readonly intuitTid?: string,
  ) {
    super(message)
  }
}

interface IntuitTokenShape {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}

interface IntuitErrorShape {
  error?: string
  error_description?: string
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

async function postToken(
  params: URLSearchParams,
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch,
): Promise<TokenResult> {
  const res = await fetchFn(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(clientId, clientSecret),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: params,
    // never follow a redirect, a cross-origin hop would replay the client secret to another host
    redirect: 'error',
  })
  const intuitTid = res.headers.get('intuit_tid') ?? undefined
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { _raw: text }
  }
  if (!res.ok) {
    const body = parsed as IntuitErrorShape
    throw new OAuthError(
      body.error_description || 'Intuit OAuth request failed',
      body.error || 'request_failed',
      res.status,
      parsed,
      intuitTid,
    )
  }
  const token = parsed as Partial<IntuitTokenShape>
  if (!token.access_token || !token.refresh_token) {
    throw new OAuthError('Intuit token response missing fields', 'invalid_response', res.status, parsed, intuitTid)
  }
  const now = Date.now()
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: now + (token.expires_in ?? 0) * 1000,
    refreshTokenExpiresAt: now + (token.x_refresh_token_expires_in ?? 0) * 1000,
  }
}

export async function exchangeCode(
  input: { code: string; redirectUri: string; clientId: string; clientSecret: string },
  fetchFn: typeof fetch = fetch,
): Promise<TokenResult> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  })
  return postToken(params, input.clientId, input.clientSecret, fetchFn)
}

export async function refreshAccessToken(
  input: { refreshToken: string; clientId: string; clientSecret: string },
  fetchFn: typeof fetch = fetch,
): Promise<TokenResult> {
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: input.refreshToken })
  return postToken(params, input.clientId, input.clientSecret, fetchFn)
}
