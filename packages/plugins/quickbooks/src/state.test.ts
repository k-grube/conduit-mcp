import { describe, expect, it, vi } from 'vitest'
import { signState, verifyState } from './state.js'
import { fakeCtx } from './test-helpers.js'

const secrets = { QBO_STATE_JWT_SECRET: 'super-secret' }

describe('quickbooks oauth state', () => {
  it('round-trips env and redirectUri through sign/verify', async () => {
    const ctx = fakeCtx({ secrets })
    const token = await signState(ctx, { env: 'sandbox', redirectUri: 'https://example.test/callback' })

    const claims = await verifyState(ctx, token)

    expect(claims).toMatchObject({ env: 'sandbox', redirectUri: 'https://example.test/callback' })
    expect(claims.nonce).toEqual(expect.any(String))
  })

  it('rejects a state token whose nonce has already been consumed', async () => {
    const ctx = fakeCtx({ secrets })
    const token = await signState(ctx, { env: 'production', redirectUri: 'https://example.test/callback' })

    await verifyState(ctx, token)

    await expect(verifyState(ctx, token)).rejects.toThrow(/nonce already used/)
  })

  it('rejects a tampered payload', async () => {
    const ctx = fakeCtx({ secrets })
    const token = await signState(ctx, { env: 'sandbox', redirectUri: 'https://example.test/callback' })
    const [payload, sig] = token.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({ env: 'production', nonce: 'x', redirectUri: 'evil' }),
    ).toString('base64url')

    await expect(verifyState(ctx, `${tamperedPayload}.${sig}`)).rejects.toThrow(/invalid state signature/)
    void payload
  })

  it('rejects a token signed with a different secret', async () => {
    const ctx = fakeCtx({ secrets })
    const token = await signState(ctx, { env: 'sandbox', redirectUri: 'https://example.test/callback' })
    const otherCtx = fakeCtx({ secrets: { QBO_STATE_JWT_SECRET: 'different-secret' } })

    await expect(verifyState(otherCtx, token)).rejects.toThrow(/invalid state signature/)
  })

  it('rejects an expired token', async () => {
    const ctx = fakeCtx({ secrets })
    vi.useFakeTimers()
    try {
      const token = await signState(ctx, { env: 'sandbox', redirectUri: 'https://example.test/callback' })
      vi.advanceTimersByTime(601_000)
      await expect(verifyState(ctx, token)).rejects.toThrow(/state expired/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a malformed token', async () => {
    const ctx = fakeCtx({ secrets })
    await expect(verifyState(ctx, 'not-a-real-token')).rejects.toThrow(/malformed state token/)
  })
})

describe('quickbooks oauth state secret resolution', () => {
  it('derives the same secret across independent ctx instances when QBO_STATE_JWT_SECRET is unset', async () => {
    // two independently-constructed ctxs (own closures, own stores) stand in for two replicas
    // that never share process state -- only the client secret they both read is common
    const replicaA = fakeCtx({ secrets: { QBO_SANDBOX_CLIENT_SECRET: 'shared-client-secret' } })
    const replicaB = fakeCtx({ secrets: { QBO_SANDBOX_CLIENT_SECRET: 'shared-client-secret' } })

    const token = await signState(replicaA, { env: 'sandbox', redirectUri: 'https://example.test/callback' })
    // replicaB never saw the signing happen -- it can only verify if it derived the identical key
    const claims = await verifyState(replicaB, token)

    expect(claims).toMatchObject({ env: 'sandbox' })
  })

  it('uses the explicit QBO_STATE_JWT_SECRET override when set, ignoring the client secret', async () => {
    const signingCtx = fakeCtx({
      secrets: { QBO_STATE_JWT_SECRET: 'explicit-override', QBO_SANDBOX_CLIENT_SECRET: 'client-secret-a' },
    })
    // no client secret at all here -- if the override weren't honored, derivation would throw
    const verifyingCtx = fakeCtx({ secrets: { QBO_STATE_JWT_SECRET: 'explicit-override' } })

    const token = await signState(signingCtx, { env: 'sandbox', redirectUri: 'https://example.test/callback' })
    const claims = await verifyState(verifyingCtx, token)

    expect(claims).toMatchObject({ env: 'sandbox' })
  })

  it('rejects deriving a state secret when neither an override nor the client secret is configured', async () => {
    const ctx = fakeCtx({ secrets: {} })

    await expect(signState(ctx, { env: 'sandbox', redirectUri: 'https://example.test/callback' })).rejects.toThrow(
      /not_connected/,
    )
  })
})
