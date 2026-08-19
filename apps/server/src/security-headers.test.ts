import { describe, expect, it, vi } from 'vitest'
import { securityHeaders } from './security-headers.js'

function mockRes() {
  const headers: Record<string, string> = {}
  return {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v
    }),
    headers,
  }
}

describe('securityHeaders', () => {
  it('sets the expected response headers and calls next', () => {
    const res = mockRes()
    const next = vi.fn()
    securityHeaders()({} as never, res as never, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.headers['X-Frame-Options']).toBe('DENY')
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(res.headers['Strict-Transport-Security']).toContain('max-age=')
    expect(res.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })

  it('csp allows the entra host for msal and locks object/base', () => {
    const res = mockRes()
    securityHeaders()({} as never, res as never, vi.fn())
    const csp = res.headers['Content-Security-Policy']
    expect(csp).toContain('https://login.microsoftonline.com')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
  })
})
