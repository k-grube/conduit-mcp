import { describe, expect, it, vi, beforeEach } from 'vitest'
import { dashboardTools, WIDGET_TYPE_NAMES } from './dashboards.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listDashboards = dashboardTools.find((t) => t.name === 'halopsa_list_dashboards')!
const getDashboard = dashboardTools.find((t) => t.name === 'halopsa_get_dashboard')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  resetClient()
})

describe('halopsa_list_dashboards', () => {
  it('maps raw dashboard links to id/name/use/in_app/is_published with deep links', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse([{ id: 1, name: 'Ops', use: 'agent', in_app: true }])
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await listDashboards.handler({}, ctx)) as { dashboards: Array<Record<string, unknown>> }

    expect(result.dashboards[0]).toMatchObject({ id: 1, name: 'Ops', is_published: false })
    expect(result.dashboards[0].url).toContain('/dashboard?id=1')
  })
})

describe('halopsa_get_dashboard', () => {
  it('trims widgets and resolves type_name from WIDGET_TYPE_NAMES', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({
        id: 5,
        name: 'Ops',
        widgets: [{ id: 1, i: 'w1', type: 6, title: 'Tickets', x: 0, y: 0, w: 4, h: 4, secret_field: 'x' }],
      })
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getDashboard.handler({ id: 5 }, ctx)) as {
      widgets: Array<Record<string, unknown>>
      url: string
      config_url: string
    }

    expect(result.widgets[0].type_name).toBe(WIDGET_TYPE_NAMES[6])
    expect(result.widgets[0]).not.toHaveProperty('secret_field')
    expect(result.config_url).toContain('/config/reports/dashboards?id=5')
  })

  it('returns a friendly error instead of throwing on a 401 restricted dashboard', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ error: 'forbidden' }, 401)
    })
    const ctx = fakeCtx()
    await getClient(ctx, fetchFn)

    const result = (await getDashboard.handler({ id: 9 }, ctx)) as { error: string }

    expect(result.error).toContain('lacks access to dashboard 9')
  })
})
