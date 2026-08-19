import type { PluginContext, PluginDefinition } from '@conduit-mcp/plugin-sdk'
import { resetQboClient, stateKey, type QboEnvState } from './client.js'
import { exchangeCode, INTUIT_AUTHORIZE_URL, INTUIT_SCOPE, OAuthError } from './oauth.js'
import { secretNamesFor, type QboEnvironment } from './secret-names.js'
import { signState, verifyState, StateError } from './state.js'

// derives the express Router type from the sdk's own PluginDefinition, no local express dependency needed
type PluginRouter = Parameters<NonNullable<PluginDefinition['routes']>>[0]

const SETTINGS_URL = '/plugins/settings/?id=quickbooks'

async function currentEnvironment(ctx: PluginContext): Promise<QboEnvironment> {
  const cfg = await ctx.getConfig<{ environment?: string }>()
  return cfg.environment === 'production' ? 'production' : 'sandbox'
}

function redirectErr(reason: string): string {
  return `${SETTINGS_URL}&status=error&reason=${encodeURIComponent(reason)}`
}

function callbackUrl(req: { protocol: string; get(name: string): string | undefined; baseUrl: string }): string {
  return `${req.protocol}://${req.get('host')}${req.baseUrl}/callback`
}

export function registerRoutes(router: PluginRouter, ctx: PluginContext, fetchFn: typeof fetch = fetch): void {
  // authenticated action, the SPA does a top-level navigation to the returned url
  router.get('/authorize', async (req, res) => {
    const env = await currentEnvironment(ctx)
    const redirectUri = callbackUrl(req)
    try {
      // signState resolves QBO_STATE_JWT_SECRET if set, else derives one from the env's client
      // secret -- no bootstrap step needed here
      const state = await signState(ctx, { env, redirectUri })
      const clientId = await ctx.getSecret(secretNamesFor(env).clientId)
      const url = new URL(INTUIT_AUTHORIZE_URL)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', INTUIT_SCOPE)
      url.searchParams.set('state', state)
      res.json({ url: url.toString() })
    } catch (err) {
      res.status(500).json({
        error: {
          message: `missing_credentials: ${err instanceof Error ? err.message : 'unknown'}`,
          type: 'config_error',
        },
      })
    }
  })

  // public route, unauthenticated -- every failure redirects to the settings page with status=error
  // rather than a bare JSON response, since this is a top-level browser navigation from Intuit
  router.get('/callback', async (req, res) => {
    const { code, realmId, state } = req.query as Record<string, string | undefined>
    if (!code || !realmId || !state) {
      res.redirect(302, redirectErr('missing_params'))
      return
    }

    let claims: Awaited<ReturnType<typeof verifyState>>
    try {
      claims = await verifyState(ctx, state)
    } catch (err) {
      // fixed reason slug on the public redirect, real detail stays server-side in the log
      ctx.logger.warn('callback_invalid_state', { error: err instanceof StateError ? err.message : String(err) })
      res.redirect(302, redirectErr('invalid_state'))
      return
    }

    const names = secretNamesFor(claims.env)
    let token
    try {
      const [clientId, clientSecret] = await Promise.all([
        ctx.getSecret(names.clientId),
        ctx.getSecret(names.clientSecret),
      ])
      // must reuse the exact redirect_uri sent to Intuit at /authorize -- byte-exact match required
      token = await exchangeCode({ code, redirectUri: claims.redirectUri, clientId, clientSecret }, fetchFn)
    } catch (err) {
      ctx.logger.warn('callback_exchange_failed', {
        environment: claims.env,
        code: err instanceof OAuthError ? err.code : undefined,
        error: err instanceof Error ? err.message : String(err),
      })
      res.redirect(302, redirectErr('exchange_failed'))
      return
    }

    try {
      await ctx.setSecret(names.refreshToken, token.refreshToken)
    } catch (err) {
      ctx.logger.error('callback_kv_write_failed', {
        environment: claims.env,
        error: err instanceof Error ? err.message : String(err),
      })
      res.redirect(302, redirectErr('kv_write_failed'))
      return
    }

    // status bookkeeping (realmId/timestamps) -- the refresh token itself is already durably
    // persisted above, never fail the whole connect over a transient store write here; worst
    // case /status lags until the next successful callback or refresh
    try {
      const now = new Date().toISOString()
      const prev = (await ctx.store.get<QboEnvState>(stateKey(claims.env))) ?? {}
      await ctx.store.set(stateKey(claims.env), {
        ...prev,
        realmId,
        connectedAt: now,
        refreshTokenRotatedAt: now,
        refreshTokenExpiresAt: new Date(token.refreshTokenExpiresAt).toISOString(),
      })
    } catch (err) {
      ctx.logger.error('connect_bookkeeping_failed', {
        environment: claims.env,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    // evict the cached client so a stale in-memory access token doesn't outlive the (re)connect
    resetQboClient()
    res.redirect(302, `${SETTINGS_URL}&status=connected`)
  })

  router.get('/status', async (_req, res) => {
    const env = await currentEnvironment(ctx)
    const state = (await ctx.store.get<QboEnvState>(stateKey(env))) ?? {}
    res.json({
      environment: env,
      connected: Boolean(state.realmId),
      connectedAt: state.connectedAt ?? null,
      refreshTokenRotatedAt: state.refreshTokenRotatedAt ?? null,
    })
  })

  router.post('/disconnect', async (_req, res) => {
    const env = await currentEnvironment(ctx)
    await ctx.store.delete(stateKey(env))
    resetQboClient()
    res.json({ ok: true, environment: env })
  })
}
