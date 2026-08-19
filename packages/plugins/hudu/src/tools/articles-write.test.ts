import { describe, expect, it, vi } from 'vitest'
import { articleWriteTools } from './articles-write.js'
import { resetClient } from '../client.js'
import { fakeCtx } from '../test-helpers.js'

const createArticle = articleWriteTools.find((t) => t.name === 'hudu_create_article')!

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('hudu_create_article write gate', () => {
  it('returns a disabled error and makes no network calls when writesEnabled is off', async () => {
    resetClient()
    const fetchFn = vi.fn()
    const ctx = fakeCtx({ config: { writesEnabled: false } })
    // inject a spying client so we can assert it's never touched
    const { getClient } = await import('../client.js')
    getClient(ctx, fetchFn as never)

    const result = await createArticle.handler({ name: 'x', content: 'y' }, ctx)

    expect(result).toEqual({ error: 'writes disabled, enable writesEnabled in hudu plugin settings' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('issues a preview + confirm token when writesEnabled is on and no token supplied', async () => {
    resetClient()
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('/folders')) {
        return jsonResponse({ folders: [{ id: 10, company_id: 3 }] })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    const { getClient } = await import('../client.js')
    getClient(ctx, fetchFn)

    const result = (await createArticle.handler({ name: 'x', content: 'y', company_id: 3 }, ctx)) as {
      preview: unknown
      confirm_token: string
    }

    expect(result.confirm_token).toBeTypeOf('string')
    expect(result.preview).toMatchObject({ name: 'x', content: 'y', folder_id: 10, company_id: 3 })
  })

  it('commits and creates the article once the confirm token round-trips', async () => {
    resetClient()
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url))
      if (u.pathname.endsWith('/folders')) {
        return jsonResponse({ folders: [{ id: 10, company_id: 3 }] })
      }
      if (u.pathname.endsWith('/articles') && init?.method === 'POST') {
        return jsonResponse({ article: { id: 1, slug: 'new-article' } })
      }
      return jsonResponse({})
    })
    const ctx = fakeCtx({ config: { writesEnabled: true } })
    const { getClient } = await import('../client.js')
    getClient(ctx, fetchFn)

    const preview = (await createArticle.handler({ name: 'x', content: 'y', company_id: 3 }, ctx)) as {
      confirm_token: string
    }
    const committed = (await createArticle.handler(
      { name: 'x', content: 'y', company_id: 3, confirm_token: preview.confirm_token },
      ctx,
    )) as Record<string, unknown>

    expect(committed.id).toBe(1)
    expect(committed.url).toContain('new-article')
  })
})
