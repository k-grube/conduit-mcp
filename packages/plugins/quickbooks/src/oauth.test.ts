import { describe, expect, it, vi } from 'vitest'
import { exchangeCode, refreshAccessToken, OAuthError, INTUIT_TOKEN_URL } from './oauth.js'

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      x_refresh_token_expires_in: 8_640_000,
    }),
    { status: 200 },
  )
}

describe('exchangeCode', () => {
  it('POSTs grant_type=authorization_code with Basic auth and the redirect_uri', async () => {
    let capturedUrl: string | undefined
    let capturedAuth: string | undefined
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedAuth = (init?.headers as Record<string, string>).authorization
      capturedBody = String(init?.body)
      return tokenResponse()
    })

    const result = await exchangeCode(
      { code: 'auth-code', redirectUri: 'https://x.test/cb', clientId: 'cid', clientSecret: 'csecret' },
      fetchFn,
    )

    expect(capturedUrl).toBe(INTUIT_TOKEN_URL)
    expect(capturedAuth).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`)
    expect(capturedBody).toContain('grant_type=authorization_code')
    expect(capturedBody).toContain('code=auth-code')
    expect(capturedBody).toContain('redirect_uri=https%3A%2F%2Fx.test%2Fcb')
    expect(result).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: expect.any(Number),
      refreshTokenExpiresAt: expect.any(Number),
    })
  })

  it('throws an OAuthError carrying the Intuit error code on a non-2xx response', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'bad code' }), { status: 400 }),
    )

    await expect(
      exchangeCode({ code: 'x', redirectUri: 'https://x.test/cb', clientId: 'a', clientSecret: 'b' }, fetchFn),
    ).rejects.toMatchObject({ code: 'invalid_grant', status: 400 })
  })
})

describe('refreshAccessToken', () => {
  it('POSTs grant_type=refresh_token with the refresh token', async () => {
    let capturedBody: string | undefined
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return tokenResponse()
    })

    await refreshAccessToken({ refreshToken: 'rt-1', clientId: 'cid', clientSecret: 'csecret' }, fetchFn)

    expect(capturedBody).toContain('grant_type=refresh_token')
    expect(capturedBody).toContain('refresh_token=rt-1')
  })

  it('raises invalid_response when the token payload is missing fields', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))

    await expect(
      refreshAccessToken({ refreshToken: 'rt-1', clientId: 'a', clientSecret: 'b' }, fetchFn),
    ).rejects.toBeInstanceOf(OAuthError)
  })
})
