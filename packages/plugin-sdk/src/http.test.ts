import { describe, expect, it, vi } from 'vitest'
import { OAuthCcClient, sanitizeUpstreamBody } from './http.js'

const tokenUrl = 'https://auth.example.com/token'

function tokenResponse(accessToken: string, expiresIn: number): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), { status: 200 })
}

describe('OAuthCcClient', () => {
  it('caches the token across multiple requests', async () => {
    let tokenCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (url === tokenUrl) {
        tokenCalls++
        return tokenResponse('tok-1', 3600)
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await client.request('https://api.example.com/a')
    await client.request('https://api.example.com/b')

    expect(tokenCalls).toBe(1)
  })

  it('refreshes the token once fewer than 60s remain before expiry', async () => {
    vi.useFakeTimers()
    try {
      let tokenCalls = 0
      const fetchFn = vi.fn(async (url: string | URL | Request) => {
        if (url === tokenUrl) {
          tokenCalls++
          return tokenResponse(`tok-${tokenCalls}`, 100)
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })
      const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

      await client.getToken()
      expect(tokenCalls).toBe(1)

      // 100s expiry - 60s skew = 40s valid window, 10s in is still cached
      vi.advanceTimersByTime(10_000)
      await client.getToken()
      expect(tokenCalls).toBe(1)

      // past the 40s window, must refresh
      vi.advanceTimersByTime(31_000)
      await client.getToken()
      expect(tokenCalls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes once and retries on 401, returning the retried result', async () => {
    let tokenCalls = 0
    let apiCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (url === tokenUrl) {
        tokenCalls++
        return tokenResponse(`tok-${tokenCalls}`, 3600)
      }
      apiCalls++
      if (apiCalls === 1) {
        return new Response('unauthorized', { status: 401 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    const result = await client.request('https://api.example.com/a')

    expect(result).toEqual({ ok: true })
    expect(tokenCalls).toBe(2)
    expect(apiCalls).toBe(2)
  })

  it('throws a normalized error when the retry after 401 also fails', async () => {
    let tokenCalls = 0
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (url === tokenUrl) {
        tokenCalls++
        return tokenResponse(`tok-${tokenCalls}`, 3600)
      }
      return new Response('still unauthorized', { status: 401 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await expect(client.request('https://api.example.com/a')).rejects.toThrow(/401/)
    expect(tokenCalls).toBe(2)
  })

  it('normalizes an error message even when the error body is not json', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (url === tokenUrl) {
        return tokenResponse('tok-1', 3600)
      }
      return new Response('<html>Internal Server Error</html>', { status: 500 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await expect(client.request('https://api.example.com/a')).rejects.toThrow(/500/)
  })

  it('includes extraParams in the token request body', async () => {
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === tokenUrl) {
        capturedBody = String(init?.body)
        return tokenResponse('tok-1', 3600)
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new OAuthCcClient({
      tokenUrl,
      clientId: 'id',
      clientSecret: 'secret',
      extraParams: { tenant: 'acme' },
      fetchFn,
    })

    await client.getToken()

    expect(capturedBody).toContain('tenant=acme')
  })

  it('preserves a plain-object headers init while adding authorization', async () => {
    let captured: Headers | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === tokenUrl) {
        return tokenResponse('tok-1', 3600)
      }
      captured = new Headers(init?.headers)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await client.request('https://api.example.com/a', { headers: { 'x-custom': 'yes' } })

    expect(captured?.get('x-custom')).toBe('yes')
    expect(captured?.get('authorization')).toBe('Bearer tok-1')
  })

  it('preserves a Headers instance init while adding authorization', async () => {
    let captured: Headers | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === tokenUrl) {
        return tokenResponse('tok-1', 3600)
      }
      captured = new Headers(init?.headers)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await client.request('https://api.example.com/a', { headers: new Headers({ 'x-custom': 'yes' }) })

    expect(captured?.get('x-custom')).toBe('yes')
    expect(captured?.get('authorization')).toBe('Bearer tok-1')
  })

  it('preserves a tuple-array headers init while adding authorization', async () => {
    let captured: Headers | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === tokenUrl) {
        return tokenResponse('tok-1', 3600)
      }
      captured = new Headers(init?.headers)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await client.request('https://api.example.com/a', { headers: [['x-custom', 'yes']] })

    expect(captured?.get('x-custom')).toBe('yes')
    expect(captured?.get('authorization')).toBe('Bearer tok-1')
  })

  it('truncates a long, multi-line error body to 200 chars with newlines stripped', async () => {
    const longBody = `${'a'.repeat(50)}\n${'b'.repeat(250)}`
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (url === tokenUrl) {
        return tokenResponse('tok-1', 3600)
      }
      return new Response(longBody, { status: 500 })
    })
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await expect(client.request('https://api.example.com/a')).rejects.toThrow(
      `request failed: 500 ${'a'.repeat(50)} ${'b'.repeat(149)}...`,
    )
  })

  it('truncates a long oauth token failure body the same way', async () => {
    const longBody = `${'x'.repeat(50)}\n${'y'.repeat(250)}`
    const fetchFn = vi.fn(async () => new Response(longBody, { status: 400 }))
    const client = new OAuthCcClient({ tokenUrl, clientId: 'id', clientSecret: 'secret', fetchFn })

    await expect(client.request('https://api.example.com/a')).rejects.toThrow(
      `oauth token request failed: 400 ${'x'.repeat(50)} ${'y'.repeat(149)}...`,
    )
  })
})

describe('sanitizeUpstreamBody', () => {
  it('passes short single-line bodies through unchanged', () => {
    expect(sanitizeUpstreamBody('plain error')).toBe('plain error')
  })

  it('flattens embedded newlines to spaces', () => {
    expect(sanitizeUpstreamBody('line one\nline two\r\nline three')).toBe('line one line two line three')
  })

  it('caps at 200 chars and appends an ellipsis', () => {
    const result = sanitizeUpstreamBody('z'.repeat(300))
    expect(result).toBe(`${'z'.repeat(200)}...`)
  })
})
