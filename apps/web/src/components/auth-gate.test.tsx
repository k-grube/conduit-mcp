import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './auth-gate'

// no test.globals in vitest.config.ts, so RTL's own afterEach(cleanup) never auto-registers
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const { getAuthConfig } = vi.hoisted(() => ({ getAuthConfig: vi.fn() }))
vi.mock('../lib/auth-config', () => ({ getAuthConfig }))

const { getMsal, portalScope } = vi.hoisted(() => ({
  getMsal: vi.fn(),
  portalScope: vi.fn(() => 'api://client/portal.access'),
}))
vi.mock('../lib/msal', () => ({ getMsal, portalScope }))

const { apiGet, clearLoginRedirectAttempt } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  clearLoginRedirectAttempt: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: { get: apiGet }, clearLoginRedirectAttempt }))

const account = { name: 'Ada Lovelace', username: 'ada@example.com', localAccountId: 'oid-ada' }

function fakePca(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getActiveAccount: vi.fn().mockReturnValue(account),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('AuthGate', () => {
  it('renders nothing and starts no auth flow inside an iframe', async () => {
    const originalSelf = Object.getOwnPropertyDescriptor(window, 'self')
    Object.defineProperty(window, 'self', { value: {}, configurable: true })
    try {
      const { container } = render(
        <AuthGate>
          <div>children</div>
        </AuthGate>,
      )
      await Promise.resolve()
      expect(container.innerHTML).toBe('')
      expect(getAuthConfig).not.toHaveBeenCalled()
    } finally {
      if (originalSelf) {
        Object.defineProperty(window, 'self', originalSelf)
      }
    }
  })

  it('renders the setup card when auth is not configured', async () => {
    getAuthConfig.mockResolvedValue({ configured: false })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ configured: false, oidLockActive: false, secretsWritable: true }),
      }),
    )

    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )

    expect(await screen.findByText('Set up authentication')).toBeTruthy()
  })

  it('renders children once configured, an account is active, and the probe succeeds', async () => {
    getAuthConfig.mockResolvedValue({
      configured: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
    getMsal.mockResolvedValue(fakePca())
    apiGet.mockResolvedValue({ status: 200, data: { items: [] } })

    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )

    expect(await screen.findByText('children')).toBeTruthy()
  })

  it('renders not-authorized when the activity probe returns 403', async () => {
    getAuthConfig.mockResolvedValue({
      configured: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
    getMsal.mockResolvedValue(fakePca())
    apiGet.mockRejectedValue({ response: { status: 403 } })

    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )

    expect(await screen.findByText('Not authorized')).toBeTruthy()
    expect(screen.getByText('Signed in as ada@example.com')).toBeTruthy()
  })

  it('renders the error card on a non-403 probe failure, then recovers on retry', async () => {
    getAuthConfig.mockResolvedValue({
      configured: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
    getMsal.mockResolvedValue(fakePca())
    apiGet.mockRejectedValueOnce({ response: { status: 500 } })
    apiGet.mockResolvedValueOnce({ status: 200, data: { items: [] } })

    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )

    expect(await screen.findByText('Something went wrong')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('children')).toBeTruthy()
  })

  it('recovers via retry after getAuthConfig rejects, then resolves', async () => {
    getAuthConfig.mockRejectedValueOnce(new Error('boom'))
    getAuthConfig.mockResolvedValueOnce({
      configured: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
    getMsal.mockResolvedValue(fakePca())
    apiGet.mockResolvedValue({ status: 200, data: { items: [] } })

    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )

    expect(await screen.findByText('Something went wrong')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('children')).toBeTruthy()
  })
})
