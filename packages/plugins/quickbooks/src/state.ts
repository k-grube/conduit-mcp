// signed single-use oauth state, HMAC-SHA256 via node:crypto (plugins don't get jose)
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { PluginContext } from '@conduit-mcp/plugin-sdk'
import { secretNamesFor, type QboEnvironment } from './secret-names.js'

const STATE_TTL_SECONDS = 600
const NONCE_STORE_PREFIX = 'oauth-nonce:'
const DERIVE_LABEL = 'qbo-state-secret'

export interface StateClaims {
  env: QboEnvironment
  nonce: string
  // baked in so /callback reuses the exact redirect_uri /authorize sent to Intuit (byte-exact match required)
  redirectUri: string
}

interface SignedClaims extends StateClaims {
  exp: number
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export class StateError extends Error {}

function isQboEnvironment(value: unknown): value is QboEnvironment {
  return value === 'sandbox' || value === 'production'
}

// explicit QBO_STATE_JWT_SECRET always wins. otherwise derive deterministically from the env's
// own client secret (already required for the oauth flow to work at all) -- no setSecret, no
// persistence, so every replica computes the identical value with no bootstrap race
async function resolveStateSecret(ctx: PluginContext, env: QboEnvironment): Promise<string> {
  try {
    return await ctx.getSecret('QBO_STATE_JWT_SECRET')
  } catch {
    // no explicit override configured, fall through to derivation
  }
  let clientSecret: string
  try {
    clientSecret = await ctx.getSecret(secretNamesFor(env).clientSecret)
  } catch {
    throw new StateError(
      `not_connected: no QBO_STATE_JWT_SECRET override and no ${env} client secret configured to derive one`,
    )
  }
  return createHmac('sha256', clientSecret).update(DERIVE_LABEL).digest('hex')
}

export async function signState(
  ctx: PluginContext,
  input: { env: QboEnvironment; redirectUri: string },
): Promise<string> {
  const secret = await resolveStateSecret(ctx, input.env)
  const claims: SignedClaims = {
    env: input.env,
    nonce: randomUUID(),
    redirectUri: input.redirectUri,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

// single-use nonce tracked in ctx.store (durable, replica-coherent unlike an in-process Map).
// no purge job: entries just accumulate as small rows, oauth connects are rare
export async function verifyState(ctx: PluginContext, token: string): Promise<StateClaims> {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) {
    throw new StateError('malformed state token')
  }
  // decode (untrusted) first, only to learn which env's key to verify against -- every other
  // claim stays untrusted until the signature check below passes
  let claims: SignedClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedClaims
  } catch {
    throw new StateError('malformed state payload')
  }
  if (!isQboEnvironment(claims.env)) {
    throw new StateError('malformed state payload')
  }

  const secret = await resolveStateSecret(ctx, claims.env)
  const expected = Buffer.from(sign(payload, secret))
  const actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new StateError('invalid state signature')
  }
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) {
    throw new StateError('state expired')
  }
  // check-then-set race: PluginStore has no atomic compare-and-swap, so two concurrent callbacks
  // for the same nonce could both pass this check. accepted as debt -- Intuit's authorization
  // code is itself single-use, so a genuine replay still fails the token exchange downstream
  const nonceKey = NONCE_STORE_PREFIX + claims.nonce
  if (await ctx.store.get<boolean>(nonceKey)) {
    throw new StateError('state nonce already used')
  }
  await ctx.store.set(nonceKey, true)
  return { env: claims.env, nonce: claims.nonce, redirectUri: claims.redirectUri }
}
