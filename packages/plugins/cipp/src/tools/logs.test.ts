import { describe, expect, it, vi } from 'vitest'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'
import { logTools } from './logs.js'

const tokenUrl = 'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token'

function tokenResponse(): Response {
  return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const searchTool = logTools.find((t) => t.name === 'cipp_search_audit_logs')!

// prime the module-level client cache with a mocked fetch, handlers pick it up via getClient(ctx)
async function primedCtx(fetchFn: typeof fetch) {
  resetClient()
  const ctx = fakeCtx()
  await getClient(ctx, fetchFn)
  return ctx
}

describe('cipp_search_audit_logs', () => {
  it('submits the async search and returns a searchId receipt, not entries', async () => {
    let captured: { method?: string; body?: Record<string, unknown> } = {}
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      expect(u.pathname).toBe('/api/ExecAuditLogSearch')
      captured = { method: init?.method, body: JSON.parse(String(init?.body)) }
      return jsonResponse({
        resultText: 'Created audit log search: CIPP Audit Search - 2026-08-13',
        state: 'success',
        details: { id: 'q-123', displayName: 'CIPP Audit Search - 2026-08-13', status: 'notStarted' },
      })
    })
    const ctx = await primedCtx(fetchFn)

    const result = (await searchTool.handler(
      { tenantFilter: 'contoso.com', startTime: '2026-08-12T00:00:00Z', endTime: '2026-08-13T00:00:00Z' },
      ctx,
    )) as Record<string, unknown>

    expect(captured.method).toBe('POST')
    expect(captured.body).toMatchObject({
      tenantFilter: 'contoso.com',
      StartTime: '2026-08-12T00:00:00Z',
      EndTime: '2026-08-13T00:00:00Z',
    })
    expect(result.searchId).toBe('q-123')
    expect(result.status).toBe('notStarted')
  })

  it('rejects a submit without both startTime and endTime (upstream 400s without them)', async () => {
    const ctx = await primedCtx(vi.fn(async () => tokenResponse()))

    await expect(searchTool.handler({ tenantFilter: 'contoso.com' }, ctx)).rejects.toThrow(/startTime and endTime/)
    await expect(
      searchTool.handler({ tenantFilter: 'contoso.com', startTime: '2026-08-12T00:00:00Z' }, ctx),
    ).rejects.toThrow(/startTime and endTime/)
  })

  it('fetches results via ListAuditLogSearches Type=SearchResults when searchId is given', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      const u = new URL(String(url))
      expect(u.pathname).toBe('/api/ListAuditLogSearches')
      expect(u.searchParams.get('Type')).toBe('SearchResults')
      expect(u.searchParams.get('SearchId')).toBe('q-123')
      expect(u.searchParams.get('tenantFilter')).toBe('contoso.com')
      return jsonResponse({
        Results: [
          {
            id: 'rec-1',
            createdDateTime: '2026-08-12T10:00:00Z',
            operation: 'FileAccessed',
            auditLogRecordType: 'sharePointFileOperation',
            service: 'SharePoint',
            userPrincipalName: 'jane@contoso.com',
            clientIp: '1.2.3.4',
            auditData: { ObjectId: 'doc.docx' },
            organizationId: 'org-guid',
          },
        ],
        Metadata: { SearchId: 'q-123', TenantFilter: 'contoso.com', TotalResults: 1 },
      })
    })
    const ctx = await primedCtx(fetchFn)

    const result = (await searchTool.handler({ tenantFilter: 'contoso.com', searchId: 'q-123' }, ctx)) as {
      returned: number
      items: Record<string, unknown>[]
    }

    expect(result.returned).toBe(1)
    expect(result.items[0]).toMatchObject({ operation: 'FileAccessed', userPrincipalName: 'jane@contoso.com' })
    expect(result.items[0]).not.toHaveProperty('organizationId')
  })

  it('passes the receipt through when no search id comes back (auditing disabled)', async () => {
    const body = {
      resultText: 'Unified auditing is disabled for this tenant. Enable auditing and retry the search.',
      state: 'warning',
      details: { id: null, status: 'AuditingDisabledTenant' },
    }
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === tokenUrl) {
        return tokenResponse()
      }
      return jsonResponse(body)
    })
    const ctx = await primedCtx(fetchFn)

    const result = await searchTool.handler(
      { tenantFilter: 'contoso.com', startTime: '2026-08-12T00:00:00Z', endTime: '2026-08-13T00:00:00Z' },
      ctx,
    )

    expect(result).toEqual(body)
  })
})
