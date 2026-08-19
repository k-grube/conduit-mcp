import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { Providers } from '../providers'

const { getAuthConfig } = vi.hoisted(() => ({ getAuthConfig: vi.fn() }))
vi.mock('../../lib/auth-config', () => ({ getAuthConfig }))

const { getMsal, portalScope } = vi.hoisted(() => ({
  getMsal: vi.fn(),
  portalScope: vi.fn(() => 'api://client/portal.access'),
}))
vi.mock('../../lib/msal', () => ({ getMsal, portalScope }))

const { apiGet, clearLoginRedirectAttempt } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  clearLoginRedirectAttempt: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: { get: apiGet }, clearLoginRedirectAttempt }))

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
}

describe('Connect page', () => {
  afterEach(cleanup)

  it('shows the mcp server url derived from the window origin', async () => {
    mockAuth()

    render(
      <Providers>
        <Page />
      </Providers>,
    )

    expect(await screen.findByDisplayValue('http://localhost:3000/mcp')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Connect' })).toBeTruthy()
  })

  it('copies the server url to the clipboard', async () => {
    mockAuth()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(
      <Providers>
        <Page />
      </Providers>,
    )

    // origin resolves in an effect, wait for the url before clicking
    await screen.findByDisplayValue('http://localhost:3000/mcp')
    fireEvent.click(screen.getByRole('button', { name: 'Copy server URL' }))

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/mcp')
  })

  it('shows the claude code command and links the api-key alternative to the keys page', async () => {
    mockAuth()

    render(
      <Providers>
        <Page />
      </Providers>,
    )

    expect(await screen.findByText('claude mcp add --transport http conduit http://localhost:3000/mcp')).toBeTruthy()
    expect(
      screen.getByText('claude mcp add --transport http conduit http://localhost:3000/mcp --header "x-api-key: <key>"'),
    ).toBeTruthy()
    // nav drawer has its own API Keys link, scope to the card paragraph
    const para = screen.getByText(/skip the sign-in/i)
    const link = within(para).getByRole('link', { name: /api keys/i })
    expect(link.getAttribute('href')).toBe('/keys')
  })
})
