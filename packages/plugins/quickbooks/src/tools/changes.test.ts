import { describe, expect, it, vi, beforeEach } from 'vitest'
import { changeTools } from './changes.js'
import { resetQboClient } from '../client.js'
import { fakeCtx, fakeStore, seedQboClient } from '../test-helpers.js'
import { INTUIT_TOKEN_URL } from '../oauth.js'

const listChanges = changeTools.find((t) => t.name === 'qbo_list_changes')!

const CONNECTED_SECRETS = {
  QBO_SANDBOX_CLIENT_ID: 'id',
  QBO_SANDBOX_CLIENT_SECRET: 'secret',
  QBO_SANDBOX_REFRESH_TOKEN: 'refresh',
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, refresh_token: 'r2' }), { status: 200 })
}

function connectedCtx(): ReturnType<typeof fakeCtx> {
  return fakeCtx({ secrets: CONNECTED_SECRETS, store: fakeStore({ 'state:sandbox': { realmId: '9' } }) })
}

beforeEach(() => {
  resetQboClient()
})

describe('qbo_list_changes validation', () => {
  it('rejects an empty entities array', async () => {
    const fetchFn = vi.fn()
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await listChanges.handler({ entities: [], changed_since: new Date().toISOString() }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_request' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rejects more than 10 entities', async () => {
    const ctx = connectedCtx()
    await seedQboClient(ctx, vi.fn())
    const entities = Array.from({ length: 11 }, (_, i) => `Entity${i}`)

    const result = await listChanges.handler({ entities, changed_since: new Date().toISOString() }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_request' })
  })

  it('rejects a changed_since more than 30 days in the past', async () => {
    const ctx = connectedCtx()
    await seedQboClient(ctx, vi.fn())
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()

    const result = await listChanges.handler({ entities: ['Customer'], changed_since: old }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'cdc_window_too_large' })
  })

  it('rejects a changed_since in the future', async () => {
    const ctx = connectedCtx()
    await seedQboClient(ctx, vi.fn())
    const future = new Date(Date.now() + 60_000).toISOString()

    const result = await listChanges.handler({ entities: ['Customer'], changed_since: future }, ctx)

    expect(result).toMatchObject({ error: 'qbo_api_error', code: 'invalid_request' })
  })
})

describe('qbo_list_changes success', () => {
  it('flattens the sparse CDCResponse array into an object keyed by entity name', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === INTUIT_TOKEN_URL) {
        return tokenResponse()
      }
      return new Response(
        JSON.stringify({
          time: '2026-01-01T00:00:00Z',
          CDCResponse: [
            {
              QueryResponse: [{ Customer: [{ Id: '1' }], startPosition: 1, maxResults: 1 }, { Invoice: [{ Id: '2' }] }],
            },
          ],
        }),
        { status: 200 },
      )
    })
    const ctx = connectedCtx()
    await seedQboClient(ctx, fetchFn)

    const result = await listChanges.handler(
      { entities: ['Customer', 'Invoice'], changed_since: new Date().toISOString() },
      ctx,
    )

    expect(result).toEqual({
      changes: { Customer: [{ Id: '1' }], Invoice: [{ Id: '2' }] },
      time: '2026-01-01T00:00:00Z',
      note: 'CDC: no user attribution, last 30 days only. Includes deletes.',
    })
  })
})
