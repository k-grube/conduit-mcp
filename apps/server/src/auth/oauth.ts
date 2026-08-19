import { Router, type Response } from 'express'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { logEvent } from '../logger.js'
import type { EntraValidator } from './entra.js'

export interface OAuthConfig {
  tenantId: string
  clientId: string
  serverUrl: string
}

export function resourceMetadataUrlFor(serverUrl: string): string {
  return `${serverUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`
}

// loopback callbacks match entra's public client platform (a secret there throws AADSTS700025),
// https callbacks like claude.ai sit on the web platform, which demands the secret at /token
function isLoopback(uri?: string): boolean {
  if (!uri) {
    return false
  }
  try {
    const host = new URL(uri).hostname
    return host === 'localhost' || host === '127.0.0.1'
  } catch {
    return false
  }
}

// entra has no dcr, proxy's clientsStore never persists locally, wrap it: adt for clientsStore, swap client_id to the pre-registered entra app on every upstream call
class ConduitOAuthProvider implements OAuthServerProvider {
  skipLocalPkceValidation = true

  constructor(
    private proxy: ProxyOAuthServerProvider,
    private clients: OAuthRegisteredClientsStore,
    private entraClientId: string,
    private getSecret?: () => Promise<string>,
  ) {}

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.clients
  }

  // dcr client_id stays local (redirect_uri/pkce bookkeeping), entra only ever sees the one pre-registered app
  private asEntraClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    // the dcr-minted secret is local bookkeeping, never forward it
    const { client_secret: _drop, ...rest } = client
    return { ...rest, client_id: this.entraClientId }
  }

  // loopback -> public pkce client, anything else -> confidential with the entra app secret
  private async entraClientFor(
    client: OAuthClientInformationFull,
    loopback: boolean,
  ): Promise<OAuthClientInformationFull> {
    const base = this.asEntraClient(client)
    if (loopback || !this.getSecret) {
      return base
    }
    return { ...base, client_secret: await this.getSecret() }
  }

  // entra enforces rfc 8707 at /token (AADSTS9010010, resource must match the scope audience), mcp
  // clients send the server url as resource, audience already rides the scope, never forward it upstream
  authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    return this.proxy.authorize(this.asEntraClient(client), { ...params, resource: undefined }, res)
  }

  challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    return this.proxy.challengeForAuthorizationCode(client, authorizationCode)
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    return this.proxy.exchangeAuthorizationCode(
      await this.entraClientFor(client, isLoopback(redirectUri)),
      authorizationCode,
      codeVerifier,
      redirectUri,
      undefined,
    )
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    // refresh carries no redirect_uri, infer the platform from the dcr client's registered uris
    const allLoopback = client.redirect_uris.length > 0 && client.redirect_uris.every((u) => isLoopback(u))
    // clients may omit scope on refresh (rfc 6749 defaults to the original grant), but entra 400s a
    // scope-less refresh when the client is the resource app (AADSTS90009, self-token needs an
    // explicit audience), restate the mcp scope + offline_access so the new grant keeps a refresh token
    const effectiveScopes = scopes?.length ? scopes : [`api://${this.entraClientId}/${MCP_SCOPE}`, 'offline_access']
    return this.proxy.exchangeRefreshToken(
      await this.entraClientFor(client, allLoopback),
      refreshToken,
      effectiveScopes,
      undefined,
    )
  }

  verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.proxy.verifyAccessToken(token)
  }
}

export function createConduitProvider(
  cfg: OAuthConfig,
  deps: { clients: OAuthRegisteredClientsStore; validator: EntraValidator; getClientSecret?: () => Promise<string> },
  endpoints?: { authorizationUrl?: string; tokenUrl?: string },
): OAuthServerProvider {
  const entra = `https://login.microsoftonline.com/${cfg.tenantId}`
  // proxyProvider discards upstream error bodies (bare `Token exchange failed: <status>`), capture the AADSTS detail here
  const loggingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init)
    if (!res.ok) {
      const url = input instanceof Request ? input.url : String(input)
      const body = await res
        .clone()
        .text()
        .catch(() => '<unreadable>')
      logEvent('oauth', 'upstream_error', { url, status: res.status, body: body.slice(0, 2000) })
    }
    return res
  }
  const proxy = new ProxyOAuthServerProvider({
    endpoints: {
      authorizationUrl: endpoints?.authorizationUrl ?? `${entra}/oauth2/v2.0/authorize`,
      tokenUrl: endpoints?.tokenUrl ?? `${entra}/oauth2/v2.0/token`,
    },
    fetch: loggingFetch,
    verifyAccessToken: async (token) => {
      await deps.validator.validate(token)
      return { token, clientId: cfg.clientId, scopes: [] }
    },
    getClient: async (clientId) => deps.clients.getClient(clientId),
  })
  return new ConduitOAuthProvider(proxy, deps.clients, cfg.clientId, deps.getClientSecret)
}

// entra api scope, mints an mcp-audience token (see infra/scripts/setup-entra-app.ps1 Set-ApiScope).
// portal.access is a separate scope minted by the portal's own msal sign-in, not requested here
const MCP_SCOPE = 'mcp.access'

export function createOAuthRouter(
  cfg: OAuthConfig,
  deps: { clients: OAuthRegisteredClientsStore; validator: EntraValidator; getClientSecret?: () => Promise<string> },
): Router {
  const provider = createConduitProvider(cfg, deps)
  return mcpAuthRouter({
    provider,
    issuerUrl: new URL(cfg.serverUrl),
    scopesSupported: ['openid', 'profile', 'email', 'offline_access', `api://${cfg.clientId}/${MCP_SCOPE}`],
    // dcr secrets are local proxy bookkeeping (real auth is entra's pkce exchange), 0 = never expire,
    // an expiring secret later rejects confidential clients at /token and kills their refresh
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }) as Router
}
