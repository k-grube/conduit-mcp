import { describe, expect, it, vi, beforeEach } from 'vitest'
import { dashboardWriteTools } from './dashboard-writes.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const createDashboard = dashboardWriteTools.find((t) => t.name === 'halopsa_create_dashboard')!
const updateDashboard = dashboardWriteTools.find((t) => t.name === 'halopsa_update_dashboard')!
const addWidget = dashboardWriteTools.find((t) => t.name === 'halopsa_add_dashboard_widget')!
const updateWidget = dashboardWriteTools.find((t) => t.name === 'halopsa_update_dashboard_widget')!
const removeWidget = dashboardWriteTools.find((t) => t.name === 'halopsa_remove_dashboard_widget')!

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  resetClient()
})

describe('write gate', () => {
  it('returns a disabled error and makes no network calls when writesEnabled is off', async () => {
    const fetchFn = vi.fn()
    const ctx = fakeCtx({ config: { writesEnabled: false } })
    await getClient(ctx, fetchFn as never)

    const result = await createDashboard.handler({ name: 'Ops' }, ctx)

    expect(result).toEqual({ error: 'writes disabled, enable writesEnabled in halopsa plugin settings' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('halopsa_create_dashboard', () => {
  it('previews then commits with matching payload', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.endsWith('/DashboardLinks')) {
        return jsonResponse({ id: 9, name: 'Ops' })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const preview = (await createDashboard.handler({ name: 'Ops' }, ctx)) as { confirm_token: string; preview: unknown }
    expect(preview.preview).toMatchObject({ name: 'Ops', use: 0, in_app: true })

    const committed = (await createDashboard.handler(
      { name: 'Ops', confirm_token: preview.confirm_token },
      ctx,
    )) as Record<string, unknown>

    expect(committed.id).toBe(9)
    expect(committed.url).toContain('/dashboard?id=9')
  })
})

describe('halopsa_update_dashboard', () => {
  it('returns a friendly error instead of throwing on a 401 restricted dashboard', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ error: 'forbidden' }, 401)
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await updateDashboard.handler({ id: 9, name: 'New' }, ctx)) as { error: string }

    expect(result.error).toContain('lacks access to dashboard 9')
  })
})

describe('halopsa_add_dashboard_widget', () => {
  it('rejects an unknown widget type before touching the dashboard', async () => {
    const fetchFn = vi.fn()
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn as never)

    const result = (await addWidget.handler({ dashboard_id: 1, type: 'not_a_type' as never }, ctx)) as {
      error: string
    }

    expect(result.error).toContain("unknown widget type 'not_a_type'")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('auto-places at the bottom of the lg layout and commits with the same widget', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/DashboardLinks/9') && (!init || init.method === undefined)) {
        return jsonResponse({
          id: 9,
          name: 'Ops',
          widgets: [{ id: 1, i: '1', type: 6 }],
          layouts: JSON.stringify({ lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] }),
        })
      }
      if (u.endsWith('/DashboardLinks') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>
        return jsonResponse({ id: 9, widgets: [...(body[0].widgets as unknown[])] })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const preview = (await addWidget.handler({ dashboard_id: 9, type: 'ticket_list' }, ctx)) as {
      confirm_token: string
      preview: { widget: Record<string, unknown> }
    }
    expect(preview.preview.widget).toMatchObject({ x: 0, y: 3, w: 4, h: 3, type: 6 })

    const committed = (await addWidget.handler(
      { dashboard_id: 9, type: 'ticket_list', confirm_token: preview.confirm_token },
      ctx,
    )) as { dashboard_id: number; added: Record<string, unknown> }

    expect(committed.dashboard_id).toBe(9)
    expect(committed.added.type_name).toBe('ticket_list')
  })

  it('requires report_id for report-backed widget types', async () => {
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, vi.fn() as never)

    const result = (await addWidget.handler({ dashboard_id: 9, type: 'report_data' }, ctx)) as { error: string }

    expect(result.error).toContain('requires report_id')
  })
})

describe('halopsa_update_dashboard_widget', () => {
  it('diffs current vs new on preview and merges changes on commit', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/DashboardLinks/9') && (!init || init.method === undefined)) {
        return jsonResponse({ id: 9, name: 'Ops', widgets: [{ id: 1, i: '1', type: 6, title: 'Old' }], layouts: '' })
      }
      if (u.endsWith('/DashboardLinks') && init?.method === 'POST') {
        return jsonResponse({ id: 9 })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const preview = (await updateWidget.handler({ dashboard_id: 9, widget_id: 1, title: 'New' }, ctx)) as {
      confirm_token: string
      preview: { changes: Record<string, { current: unknown; new: unknown }> }
    }
    expect(preview.preview.changes.title).toEqual({ current: 'Old', new: 'New' })

    const committed = (await updateWidget.handler(
      { dashboard_id: 9, widget_id: 1, title: 'New', confirm_token: preview.confirm_token },
      ctx,
    )) as { updated: { id: number } }

    expect(committed.updated.id).toBe(1)
  })

  it('returns widgetNotFound when the widget id does not exist on the dashboard', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 9, name: 'Ops', widgets: [], layouts: '' })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const result = (await updateWidget.handler({ dashboard_id: 9, widget_id: 999 }, ctx)) as { error: string }

    expect(result.error).toContain('widget 999 not found')
  })
})

describe('halopsa_remove_dashboard_widget', () => {
  it('previews then commits, dropping the widget from the layout', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      if (u.includes('/DashboardLinks/9') && (!init || init.method === undefined)) {
        return jsonResponse({
          id: 9,
          name: 'Ops',
          widgets: [{ id: 1, i: '1', title: 'Tickets', type: 6 }],
          layouts: JSON.stringify({ lg: [{ i: '1', x: 0, y: 0, w: 4, h: 3, moved: false, static: false }] }),
        })
      }
      if (u.endsWith('/DashboardLinks') && init?.method === 'POST') {
        return jsonResponse({ id: 9 })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const preview = (await removeWidget.handler({ dashboard_id: 9, widget_id: 1 }, ctx)) as {
      confirm_token: string
      preview: { remaining_count: number }
    }
    expect(preview.preview.remaining_count).toBe(0)

    const committed = (await removeWidget.handler(
      { dashboard_id: 9, widget_id: 1, confirm_token: preview.confirm_token },
      ctx,
    )) as { remaining: number }

    expect(committed.remaining).toBe(0)
  })

  it('rejects commit when the confirm token payload no longer matches', async () => {
    // mock ignores the dashboard id in the path, always returns the same widget list, so
    // widget_id:1 is "found" under either dashboard_id below and the mismatch is isolated
    // to the guarded dashboard_id field itself
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/token')) {
        return tokenResponse()
      }
      return jsonResponse({ id: 9, name: 'Ops', widgets: [{ id: 1, i: '1', title: 'Tickets' }], layouts: '' })
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    await getClient(ctx, fetchFn)

    const preview = (await removeWidget.handler({ dashboard_id: 9, widget_id: 1 }, ctx)) as { confirm_token: string }

    await expect(
      removeWidget.handler({ dashboard_id: 999, widget_id: 1, confirm_token: preview.confirm_token }, ctx),
    ).rejects.toThrow(/mismatch/)
  })
})
