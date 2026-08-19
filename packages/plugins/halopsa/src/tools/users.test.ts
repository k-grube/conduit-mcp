import { describe, expect, it, vi, beforeEach } from 'vitest'
import { userTools } from './users.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listUsers = userTools.find((t) => t.name === 'halopsa_list_users')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_users', () => {
  it('delegates to executeListUsers and filters inactive/service accounts by default', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        record_count: 2,
        users: [
          { id: 1, name: 'Active', inactive: false, isserviceaccount: false },
          { id: 2, name: 'Inactive', inactive: true, isserviceaccount: false },
        ],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listUsers.handler({ page_size: 25, page_no: 1, include_inactive: false }, ctx)) as {
      users: unknown[]
    }

    expect(result.users).toHaveLength(1)
  })
})
