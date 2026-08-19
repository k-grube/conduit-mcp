import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { SnackbarProvider } from '../../components/snackbar'

afterEach(() => {
  cleanup()
})

const { useConfigDomain, useUpdateConfigDomain, useUpdateStatus, useRestart } = vi.hoisted(() => ({
  useConfigDomain: vi.fn(),
  useUpdateConfigDomain: vi.fn(),
  useUpdateStatus: vi.fn(),
  useRestart: vi.fn(),
}))

vi.mock('../../lib/config-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/config-queries')>()
  return { ...actual, useConfigDomain, useUpdateConfigDomain }
})

vi.mock('../../lib/system-queries', () => ({ useUpdateStatus, useRestart }))

beforeEach(() => {
  useUpdateStatus.mockReturnValue({
    data: { runningSha: 'aaa1111ff', remoteSha: 'aaa1111ff', tag: 'latest', updateAvailable: false },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  useRestart.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

vi.mock('../../components/auth-gate', () => ({
  useAuth: () => ({ account: { name: 'Ada', username: 'ada@example.com', oid: 'oid-me' }, logout: vi.fn() }),
}))

function renderPage() {
  return render(
    <SnackbarProvider>
      <Page />
    </SnackbarProvider>,
  )
}

function mockDomains(byDomain: Record<string, unknown>) {
  useConfigDomain.mockImplementation((domain: string) => ({
    data: byDomain[domain],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }))
}

// cards mount in page order: auth, retention, updates
function authSaveButton() {
  return screen.getAllByRole('button', { name: 'Save' })[0]
}
function retentionSaveButton() {
  return screen.getAllByRole('button', { name: 'Save' })[1]
}

describe('settings page', () => {
  it('400 from the mocked mutation renders the error text', () => {
    mockDomains({ auth: {}, retention: {} })
    const authMutate = vi.fn((_patch, opts) => {
      opts.onError({ response: { status: 400, data: { error: 'tenant looks wrong' } } })
    })
    useUpdateConfigDomain.mockImplementation((domain: string) =>
      domain === 'auth' ? { mutate: authMutate, isPending: false } : { mutate: vi.fn(), isPending: false },
    )

    renderPage()

    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: 't' } })
    fireEvent.click(authSaveButton())

    expect(screen.getByText('tenant looks wrong')).toBeTruthy()
  })

  it('409 refetches and notifies instead of showing a field error', () => {
    const byDomain: Record<string, unknown> = { auth: {}, retention: {} }
    const refetch = vi.fn()
    const otherRefetch = vi.fn()
    // stable per-domain data refs, a fresh object literal per call would retrigger the [data, dirty] effect forever
    useConfigDomain.mockImplementation((domain: string) => ({
      data: byDomain[domain],
      isLoading: false,
      isError: false,
      refetch: domain === 'auth' ? refetch : otherRefetch,
    }))
    const authMutate = vi.fn((_patch, opts) => {
      opts.onError({ response: { status: 409 } })
    })
    useUpdateConfigDomain.mockImplementation((domain: string) =>
      domain === 'auth' ? { mutate: authMutate, isPending: false } : { mutate: vi.fn(), isPending: false },
    )

    renderPage()

    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: 't' } })
    fireEvent.click(authSaveButton())

    expect(screen.getByText('Config changed elsewhere, reloading.')).toBeTruthy()
    expect(refetch).toHaveBeenCalled()
  })

  it('redirectHosts rejects a dotless, non-localhost entry before adding a chip', () => {
    mockDomains({ auth: {}, retention: {} })
    useUpdateConfigDomain.mockImplementation(() => ({ mutate: vi.fn(), isPending: false }))

    renderPage()

    fireEvent.change(screen.getByLabelText('Add redirect host'), { target: { value: 'ai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('Must be fully qualified or "localhost".')).toBeTruthy()
    expect(screen.queryByText('ai')).toBeNull()
  })

  it('redirectHosts accepts a fully qualified host and localhost', () => {
    mockDomains({ auth: {}, retention: {} })
    useUpdateConfigDomain.mockImplementation(() => ({ mutate: vi.fn(), isPending: false }))

    renderPage()

    fireEvent.change(screen.getByLabelText('Add redirect host'), { target: { value: 'claude.ai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('Add redirect host'), { target: { value: 'localhost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('claude.ai')).toBeTruthy()
    expect(screen.getByText('localhost')).toBeTruthy()
  })

  it('auth partial save omits empty fields from the PUT body', () => {
    mockDomains({ auth: {}, retention: {} })
    const authMutate = vi.fn()
    useUpdateConfigDomain.mockImplementation((domain: string) =>
      domain === 'auth' ? { mutate: authMutate, isPending: false } : { mutate: vi.fn(), isPending: false },
    )

    renderPage()

    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: 'new-tenant' } })
    fireEvent.click(authSaveButton())

    // clientId, serverUrl, redirectHosts are all untouched/empty and must not be sent
    expect(authMutate).toHaveBeenCalledWith({ tenantId: 'new-tenant' }, expect.anything())
  })

  it('clearing every redirect host chip sends redirectHosts: [] instead of omitting it', () => {
    mockDomains({ auth: { redirectHosts: ['claude.ai'] }, retention: {} })
    const authMutate = vi.fn()
    useUpdateConfigDomain.mockImplementation((domain: string) =>
      domain === 'auth' ? { mutate: authMutate, isPending: false } : { mutate: vi.fn(), isPending: false },
    )

    const { container } = renderPage()

    expect(screen.getByText('claude.ai')).toBeTruthy()
    const deleteIcon = container.querySelector('.MuiChip-deleteIcon')
    expect(deleteIcon).toBeTruthy()
    fireEvent.click(deleteIcon as Element)

    fireEvent.click(authSaveButton())

    // touched-to-empty chip list must still be sent as `[]`, not omitted like an untouched field
    expect(authMutate).toHaveBeenCalledWith({ redirectHosts: [] }, expect.anything())
  })

  it('retention fields prefill the runtime default, and clearing one blocks save with an inline error', () => {
    mockDomains({ auth: {}, retention: {} })
    const retentionMutate = vi.fn()
    useUpdateConfigDomain.mockImplementation((domain: string) =>
      domain === 'retention' ? { mutate: retentionMutate, isPending: false } : { mutate: vi.fn(), isPending: false },
    )

    renderPage()

    const usageField = screen.getByLabelText('Usage logs (days)')
    expect((usageField as HTMLInputElement).value).toBe('90')

    fireEvent.change(usageField, { target: { value: '' } })
    fireEvent.click(retentionSaveButton())

    expect(retentionMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a value.')).toBeTruthy()
  })

  it('update card shows availability and restarts only after confirm', () => {
    mockDomains({ auth: {}, retention: {} })
    useUpdateConfigDomain.mockImplementation(() => ({ mutate: vi.fn(), isPending: false }))
    useUpdateStatus.mockReturnValue({
      data: { runningSha: 'aaa1111ff', remoteSha: 'bbb2222ff', tag: 'latest', updateAvailable: true },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
    const restartMutate = vi.fn((_arg, opts) => {
      opts.onSuccess()
    })
    useRestart.mockReturnValue({ mutate: restartMutate, isPending: false })

    renderPage()

    expect(screen.getByText('Update available')).toBeTruthy()
    expect(screen.getByText(/Running aaa1111, registry has bbb2222/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restart server' }))
    expect(restartMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(restartMutate).toHaveBeenCalled()
    expect(screen.getByText(/Restart initiated/)).toBeTruthy()
  })

  it('update card renders the unavailable reason without sha noise', () => {
    mockDomains({ auth: {}, retention: {} })
    useUpdateConfigDomain.mockImplementation(() => ({ mutate: vi.fn(), isPending: false }))
    useUpdateStatus.mockReturnValue({
      data: { unavailable: 'image identity not baked into this build' },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })

    renderPage()

    expect(screen.getByText(/image identity not baked/)).toBeTruthy()
    expect(screen.queryByText('Up to date')).toBeNull()
  })
})
