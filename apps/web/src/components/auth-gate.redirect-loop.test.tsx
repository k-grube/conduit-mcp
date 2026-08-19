import type { AxiosAdapter } from 'axios'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './auth-gate'
import { api } from '../lib/api'

// exercises the real api.ts singleton (not mocked), so the 401 redirect guard actually runs
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.clearAllMocks()
})

const { getAuthConfig } = vi.hoisted(() => ({ getAuthConfig: vi.fn() }))
vi.mock('../lib/auth-config', () => ({ getAuthConfig }))

const { getMsal, portalScope } = vi.hoisted(() => ({
  getMsal: vi.fn(),
  portalScope: vi.fn(() => 'api://client/portal.access'),
}))
vi.mock('../lib/msal', () => ({ getMsal, portalScope }))

const account = { name: 'Ada Lovelace', username: 'ada@example.com', localAccountId: 'oid-ada' }

function fakePca(loginRedirect: ReturnType<typeof vi.fn>) {
  return {
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getActiveAccount: vi.fn().mockReturnValue(account),
    setActiveAccount: vi.fn(),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'tok123' }),
    loginRedirect,
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
  }
}

function unauthorizedAdapter(): AxiosAdapter {
  return async (config) => {
    throw Object.assign(new Error('unauthorized'), {
      isAxiosError: true,
      config,
      response: { data: { error: 'invalid token' }, status: 401, statusText: 'error', headers: {}, config },
      toJSON: () => ({}),
    })
  }
}

function okAdapter(): AxiosAdapter {
  return async (config) => ({ data: { items: [] }, status: 200, statusText: 'OK', headers: {}, config })
}

describe('AuthGate + api 401 redirect guard', () => {
  it('redirects once on a persistent 401, a second pass then shows the error card without redirecting again', async () => {
    const loginRedirect = vi.fn().mockResolvedValue(undefined)
    getAuthConfig.mockResolvedValue({
      configured: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
    getMsal.mockResolvedValue(fakePca(loginRedirect))
    api.defaults.adapter = unauthorizedAdapter()

    const first = render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    await waitFor(() => expect(loginRedirect).toHaveBeenCalledTimes(1))
    first.unmount()

    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    expect(loginRedirect).toHaveBeenCalledTimes(1)
  })

  it('clears the guard on a successful probe so a later persistent 401 can redirect again', async () => {
    const loginRedirect = vi.fn().mockResolvedValue(undefined)
    getAuthConfig.mockResolvedValue({
      configured: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      portalScope: 'api://client-1/portal.access',
    })
    getMsal.mockResolvedValue(fakePca(loginRedirect))
    sessionStorage.setItem('conduit.loginRedirectAttempted', '1')
    api.defaults.adapter = okAdapter()

    const first = render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )
    expect(await screen.findByText('children')).toBeTruthy()
    first.unmount()

    api.defaults.adapter = unauthorizedAdapter()
    render(
      <AuthGate>
        <div>children</div>
      </AuthGate>,
    )
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    await waitFor(() => expect(loginRedirect).toHaveBeenCalledTimes(1))
  })
})
