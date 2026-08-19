import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clientTools } from './clients.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listClients = clientTools.find((t) => t.name === 'halopsa_list_clients')!
const getClientTool = clientTools.find((t) => t.name === 'halopsa_get_client')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_clients', () => {
  it('delegates to the active-list sql path by default', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      const body = JSON.parse(String(init?.body))
      const sql = String(body[0].sql)
      if (sql.startsWith('SELECT COUNT')) {
        return jsonResponse({ report: { loaded: true, rows: [{ n: 1 }] } })
      }
      return jsonResponse({ report: { loaded: true, rows: [{ id: 1, name: 'Acme' }] } })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listClients.handler({ page_size: 25, page_no: 1, include_inactive: false }, ctx)) as {
      clients: unknown[]
    }

    expect(result.clients).toHaveLength(1)
  })
})

describe('halopsa_get_client', () => {
  it('strips html from note fields and adds a deep link url', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 501, name: 'Acme', notes: '<p>hello</p>' })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getClientTool.handler({ id: 501, includedetails: true }, ctx)) as Record<string, unknown>

    expect(result.notes).toBe('hello')
    expect(result.url).toContain('/customer?clientid=501')
  })
})
