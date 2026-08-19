import { describe, expect, it, vi } from 'vitest'
import { HuduClient } from './client.js'
import { fakeCtx } from './test-helpers.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('HuduClient auth', () => {
  it('sends the x-api-key header on every request, no oauth token dance', async () => {
    const calls: RequestInit[] = []
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return jsonResponse({ companies: [] })
    })
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    await client.getCompanies({ page: 1 })
    await client.getCompanyById(5)

    expect(calls).toHaveLength(2)
    for (const init of calls) {
      const headers = new Headers(init.headers)
      expect(headers.get('x-api-key')).toBe('test-key')
    }
  })
})

describe('HuduClient.getArticleBySlug', () => {
  it('finds a match mid-scan and stops paginating further', async () => {
    let calls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls++
      const u = new URL(String(url))
      if (u.pathname.endsWith('/articles') && u.searchParams.has('page')) {
        const page = Number(u.searchParams.get('page'))
        if (page === 1) {
          return jsonResponse({ articles: [{ id: 1, slug: 'nope' }] })
        }
        if (page === 2) {
          return jsonResponse({ articles: [{ id: 2, slug: 'found-me' }] })
        }
        return jsonResponse({ articles: [] })
      }
      // detail fetch for the matched article
      return jsonResponse({ id: 2, slug: 'found-me', content: 'hi' })
    })
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    const result = await client.getArticleBySlug('found-me')

    expect(result).toEqual({ id: 2, slug: 'found-me', content: 'hi' })
    // page 1 (miss) + page 2 (hit) + detail fetch = 3 calls, never reaches page 3+
    expect(calls).toBe(3)
  })

  it('terminates after an empty page without a match', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls++
      return jsonResponse({ articles: [] })
    })
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    const result = await client.getArticleBySlug('missing')

    expect(result).toBeNull()
    expect(calls).toBe(1)
  })

  it('gives up after 20 pages when every page is full but never matches', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls++
      return jsonResponse({ articles: [{ id: calls, slug: `slug-${calls}` }] })
    })
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    const result = await client.getArticleBySlug('never-there')

    expect(result).toBeNull()
    expect(calls).toBe(20)
  })
})

describe('HuduClient.findOrCreateDraftFolder', () => {
  it('caches the resolved folder id and skips a second network round-trip', async () => {
    let folderLookups = 0
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('/folders') && (!init || init.method === 'GET')) {
        folderLookups++
        return jsonResponse({ folders: [{ id: 42, company_id: 7 }] })
      }
      return jsonResponse({})
    })
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    const first = await client.findOrCreateDraftFolder(7, 'AI Drafts')
    const second = await client.findOrCreateDraftFolder(7, 'AI Drafts')

    expect(first).toBe(42)
    expect(second).toBe(42)
    expect(folderLookups).toBe(1)
  })

  it('creates a folder when none matches the lookup', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('/folders') && (!init || init.method === 'GET')) {
        return jsonResponse({ folders: [] })
      }
      if (u.pathname.endsWith('/folders') && init?.method === 'POST') {
        return jsonResponse({ folder: { id: 99 } })
      }
      return jsonResponse({})
    })
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    const id = await client.findOrCreateDraftFolder(null, 'AI Drafts')

    expect(id).toBe(99)
  })
})

describe('HuduClient error handling', () => {
  it('throws before any fetch when baseUrl is missing from config', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const client = new HuduClient({ ctx: fakeCtx({ config: { baseUrl: '' } }), fetchFn })

    await expect(client.getCompanyById(1)).rejects.toThrow(/missing required hudu setting: baseUrl/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws with status and body text on a non-ok response', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }))
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    await expect(client.getCompanyById(1)).rejects.toThrow(/404/)
  })

  it('truncates a long error body to 200 chars with newlines stripped', async () => {
    const longBody = `${'a'.repeat(50)}\n${'b'.repeat(250)}`
    const fetchFn = vi.fn(async () => new Response(longBody, { status: 500 }))
    const client = new HuduClient({ ctx: fakeCtx(), fetchFn })

    await expect(client.getCompanyById(1)).rejects.toThrow(
      `hudu request failed: 500 ${'a'.repeat(50)} ${'b'.repeat(149)}...`,
    )
  })
})
