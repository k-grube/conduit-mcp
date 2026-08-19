import { describe, expect, it, vi } from 'vitest'
import { managedCompaniesTools } from './managed-companies.js'
import { getClient, resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const listManaged = managedCompaniesTools.find((t) => t.name === 'hudu_list_managed_companies')!

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('hudu_list_managed_companies', () => {
  it('falls back to all companies with a note when invokeTool throws (halopsa plugin absent)', async () => {
    resetClient()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        companies: [
          { id: 1, name: 'Acme' },
          { id: 2, name: 'Beta' },
        ],
      }),
    )
    const ctx = fakeCtx({
      invokeTool: async () => {
        throw new Error('unknown tool: halopsa_list_clients')
      },
    })
    getClient(ctx, fetchFn)

    const result = (await listManaged.handler({}, ctx)) as { companies: unknown[]; note: string }

    expect(result.note).toMatch(/halopsa plugin unavailable/)
    expect(result.companies).toHaveLength(2)
  })

  it('filters to companies linked to managed halopsa clients when invokeTool succeeds', async () => {
    resetClient()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        companies: [
          { id: 1, name: 'Managed Co', integrations: [{ sync_id: 501 }] },
          { id: 2, name: 'Unmanaged Co', integrations: [{ sync_id: 999 }] },
          { id: 3, name: 'No Link Co', integrations: [] },
        ],
      }),
    )
    const ctx = fakeCtx({
      invokeTool: async (name, args) => {
        expect(name).toBe('halopsa_list_clients')
        expect(args).toMatchObject({ page_size: 100, page_no: 1, include_inactive: true })
        return {
          page_no: 1,
          page_size: 100,
          returned: 2,
          total_in_system: 2,
          clients: [
            { id: 501, pritech: 7 },
            { id: 999, pritech: 0, accountmanagertech: 0 },
          ],
        }
      },
    })
    getClient(ctx, fetchFn)

    const result = (await listManaged.handler({}, ctx)) as {
      companies: Array<{ id: number; name: string; halo_id: number }>
      note?: string
    }

    expect(result.companies).toEqual([{ id: 1, name: 'Managed Co', halo_id: 501 }])
    expect(result.note).toBeUndefined()
  })

  it('loops through multiple pages of halopsa clients and stops on a short page', async () => {
    resetClient()
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        companies: [{ id: 1, name: 'Managed Co', integrations: [{ sync_id: 5150 }] }],
      }),
    )
    const pageNos: number[] = []
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, pritech: 0 }))
    const page2 = [{ id: 5150, pritech: 9 }]
    const ctx = fakeCtx({
      invokeTool: async (name, args) => {
        expect(name).toBe('halopsa_list_clients')
        const pageNo = (args as { page_no: number }).page_no
        pageNos.push(pageNo)
        expect(args).toMatchObject({ page_size: 100, include_inactive: true })
        if (pageNo === 1) {
          return { page_no: 1, page_size: 100, returned: 100, total_in_system: 101, clients: page1 }
        }
        return { page_no: 2, page_size: 100, returned: 1, total_in_system: 101, clients: page2 }
      },
    })
    getClient(ctx, fetchFn)

    const result = (await listManaged.handler({}, ctx)) as {
      companies: Array<{ id: number; name: string; halo_id: number }>
      note?: string
    }

    expect(pageNos).toEqual([1, 2])
    expect(result.companies).toEqual([{ id: 1, name: 'Managed Co', halo_id: 5150 }])
    expect(result.note).toBeUndefined()
  })

  it('caps at 10 pages and appends a truncation note when every page comes back full', async () => {
    resetClient()
    const fetchFn = vi.fn(async () => jsonResponse({ companies: [] }))
    const ctx = fakeCtx({
      invokeTool: async (_name, args) => {
        const pageNo = (args as { page_no: number }).page_no
        const clients = Array.from({ length: 100 }, (_, i) => ({ id: pageNo * 1000 + i, pritech: 0 }))
        return { page_no: pageNo, page_size: 100, returned: 100, total_in_system: 5000, clients }
      },
    })
    getClient(ctx, fetchFn)

    const result = (await listManaged.handler({}, ctx)) as { companies: unknown[]; note?: string }

    expect(result.note).toMatch(/capped at 1000 clients/)
    expect(result.companies).toEqual([])
  })
})
