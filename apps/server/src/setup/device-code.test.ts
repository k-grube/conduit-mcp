import { describe, expect, it, vi } from 'vitest'
import { DeviceCodeExpiredError, decodeJwtPayload, pollDeviceCode, startDeviceCode } from './device-code.js'

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `h.${b64}.s`
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('startDeviceCode', () => {
  it('posts to the organizations devicecode endpoint and maps the response', async () => {
    const f = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        device_code: 'dc',
        user_code: 'ABC123',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
        message: 'go log in',
      }),
    )
    const r = await startDeviceCode('client-1', f as unknown as typeof fetch)
    expect(r).toEqual({
      deviceCode: 'dc',
      userCode: 'ABC123',
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      interval: 5,
      message: 'go log in',
    })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode')
    const body = String(init.body)
    expect(body).toContain('client_id=client-1')
    expect(body).toContain(encodeURIComponent('https://graph.microsoft.com/.default'))
    expect(body).toContain('offline_access')
  })

  it('throws on a failed devicecode request', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }))
    await expect(startDeviceCode('client-1', f as unknown as typeof fetch)).rejects.toThrow(/invalid_client/)
  })
})

describe('pollDeviceCode', () => {
  it('returns pending on authorization_pending and slow_down', async () => {
    for (const code of ['authorization_pending', 'slow_down']) {
      const f = vi.fn().mockResolvedValue(jsonResponse(400, { error: code }))
      expect(await pollDeviceCode('c', 'dc', f as unknown as typeof fetch)).toEqual({ pending: true })
    }
  })

  it('throws DeviceCodeExpiredError on expired_token', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'expired_token' }))
    await expect(pollDeviceCode('c', 'dc', f as unknown as typeof fetch)).rejects.toThrow(DeviceCodeExpiredError)
  })

  it('returns token and user claims on success', async () => {
    const token = jwtWith({ oid: 'oid-1', tid: 'tid-1', name: 'Ada', upn: 'ada@contoso.com' })
    const f = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: token }))
    const r = await pollDeviceCode('c', 'dc', f as unknown as typeof fetch)
    expect(r).toEqual({
      pending: false,
      accessToken: token,
      user: { oid: 'oid-1', tid: 'tid-1', name: 'Ada', upn: 'ada@contoso.com' },
    })
  })

  it('falls back to preferred_username when upn is absent', async () => {
    const token = jwtWith({ oid: 'oid-1', tid: 'tid-1', preferred_username: 'ada@contoso.com' })
    const f = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: token }))
    const r = await pollDeviceCode('c', 'dc', f as unknown as typeof fetch)
    if (r.pending) {
      throw new Error('expected token')
    }
    expect(r.user.upn).toBe('ada@contoso.com')
  })

  it('throws when the token payload has no oid or tid', async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: jwtWith({ sub: 'x' }) }))
    await expect(pollDeviceCode('c', 'dc', f as unknown as typeof fetch)).rejects.toThrow(/oid|tid/)
  })
})

describe('decodeJwtPayload', () => {
  it('decodes a base64url payload', () => {
    expect(decodeJwtPayload(jwtWith({ a: 1 }))).toEqual({ a: 1 })
  })
})
