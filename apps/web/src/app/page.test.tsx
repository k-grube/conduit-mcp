import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { Providers } from './providers'

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

const { useUpdateStatus } = vi.hoisted(() => ({ useUpdateStatus: vi.fn() }))
vi.mock('../lib/system-queries', () => ({ useUpdateStatus }))

function mockAuth() {
  getAuthConfig.mockResolvedValue({
    configured: true,
    tenantId: 'tenant-1',
    clientId: 'client-1',
    portalScope: 'api://client-1/portal.access',
  })
  getMsal.mockResolvedValue({
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getActiveAccount: vi.fn().mockReturnValue({ name: 'Ada Lovelace', username: 'ada@example.com' }),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
  })
  apiGet.mockResolvedValue({
    status: 200,
    data: { items: [], totals: { calls: 0, errors: 0, avgMs: 0 }, tools: [], daily: [], principals: [] },
  })
}

describe('Page', () => {
  afterEach(cleanup)

  it('renders the conduit heading', async () => {
    mockAuth()
    useUpdateStatus.mockReturnValue({ data: undefined })

    render(
      <Providers>
        <Page />
      </Providers>,
    )

    expect(await screen.findByText('Conduit')).toBeTruthy()
  })

  it('shows an update banner linking to settings when an update is available', async () => {
    mockAuth()
    useUpdateStatus.mockReturnValue({
      data: { runningSha: 'aaa111222', remoteSha: 'bbb222333', tag: 'latest', updateAvailable: true },
    })

    render(
      <Providers>
        <Page />
      </Providers>,
    )

    expect(await screen.findByText(/update available/i)).toBeTruthy()
    const link = within(screen.getByRole('alert')).getByRole('link', { name: /settings/i })
    expect(link.getAttribute('href')).toBe('/settings')
    // dashboard rides the server cache, only settings asks for the live variant
    expect(useUpdateStatus).toHaveBeenCalledWith()
  })

  it('shows no banner when up to date', async () => {
    mockAuth()
    useUpdateStatus.mockReturnValue({
      data: { runningSha: 'aaa111222', remoteSha: 'aaa111222', tag: 'latest', updateAvailable: false },
    })

    render(
      <Providers>
        <Page />
      </Providers>,
    )

    expect(await screen.findByText('Conduit')).toBeTruthy()
    expect(screen.queryByText(/update available/i)).toBeNull()
  })
})
