import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SetupWizard } from './setup-wizard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body }
}

// interval callbacks kick off promise chains the test can't await directly, drain the microtask queue instead
async function flushPromises() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

const doneSteps = [
  { id: 'app', state: 'done' },
  { id: 'manifest', state: 'done' },
  { id: 'sp', state: 'done' },
  { id: 'consent', state: 'done' },
  { id: 'secret', state: 'done' },
  { id: 'store', state: 'done' },
  { id: 'admin', state: 'done' },
  { id: 'config', state: 'done' },
]

describe('SetupWizard', () => {
  it('renders the automated card and the manual card when unconfigured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })),
    )

    render(<SetupWizard />)

    expect(await screen.findByText('Set up authentication')).toBeTruthy()
    expect(screen.getByDisplayValue('conduit-mcp')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    expect(screen.getByText('Manual entry')).toBeTruthy()
  })

  it('start flow: click start shows the user code and devicelogin link', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/setup/status') {
        return jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })
      }
      if (url === '/api/setup/device-code') {
        return jsonResponse(200, {
          userCode: 'ABC-DEF',
          verificationUri: 'https://microsoft.com/devicelogin',
          expiresIn: 900,
          message: 'go log in',
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))

    expect(await screen.findByText('ABC-DEF')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://microsoft.com/devicelogin' })).toBeTruthy()
    expect(screen.getByText('Waiting for sign-in')).toBeTruthy()
  })

  it('after poll succeeds, shows signed-in-as and fires provision exactly once', async () => {
    let started = false
    const session: Record<string, unknown> = { authenticated: false, provisioning: false, steps: [] }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/setup/status') {
        return jsonResponse(
          200,
          started
            ? { configured: false, oidLockActive: false, secretsWritable: true, session }
            : { configured: false, oidLockActive: false, secretsWritable: true },
        )
      }
      if (url === '/api/setup/device-code' && method === 'POST') {
        started = true
        return jsonResponse(200, {
          userCode: 'ABC-DEF',
          verificationUri: 'https://microsoft.com/devicelogin',
          expiresIn: 900,
          message: 'go log in',
        })
      }
      if (url === '/api/setup/poll' && method === 'POST') {
        session.authenticated = true
        session.user = { name: 'Ada Lovelace' }
        return jsonResponse(200, { pending: false, user: { name: 'Ada Lovelace' } })
      }
      if (url === '/api/setup/provision' && method === 'POST') {
        // never resolves, freezes the UI at 'authenticated' so the transient state is assertable
        // (matches the never-resolving-fetch technique in the server's provision.test.ts)
        return new Promise(() => {})
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    // fake timers must be active before the poll interval is created, so no findBy*/waitFor below
    // (those rely on real setTimeout to retry) - drive everything through explicit flushes instead
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)
    await act(async () => {
      await flushPromises()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => {
      await flushPromises()
    })
    expect(screen.getByText('ABC-DEF')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flushPromises()
    })

    expect(screen.getByText('Signed in as Ada Lovelace')).toBeTruthy()
    const provisionCalls = fetchMock.mock.calls.filter(([u]) => u === '/api/setup/provision')
    expect(provisionCalls).toHaveLength(1)
  })

  it('provision POST failure surfaces the error message instead of hanging silently', async () => {
    let started = false
    const session: Record<string, unknown> = { authenticated: false, provisioning: false, steps: [] }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/setup/status') {
        return jsonResponse(
          200,
          started
            ? { configured: false, oidLockActive: false, secretsWritable: true, session }
            : { configured: false, oidLockActive: false, secretsWritable: true },
        )
      }
      if (url === '/api/setup/device-code' && method === 'POST') {
        started = true
        return jsonResponse(200, {
          userCode: 'ABC-DEF',
          verificationUri: 'https://microsoft.com/devicelogin',
          expiresIn: 900,
          message: 'go log in',
        })
      }
      if (url === '/api/setup/poll' && method === 'POST') {
        session.authenticated = true
        session.user = { name: 'Ada Lovelace' }
        return jsonResponse(200, { pending: false, user: { name: 'Ada Lovelace' } })
      }
      if (url === '/api/setup/provision' && method === 'POST') {
        return jsonResponse(409, { error: 'provisioning already in progress' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)
    await act(async () => {
      await flushPromises()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => {
      await flushPromises()
    })
    expect(screen.getByText('ABC-DEF')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flushPromises()
    })

    expect(screen.getByText('provisioning already in progress')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('renders step list states from the status payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          configured: false,
          oidLockActive: false,
          secretsWritable: true,
          session: {
            authenticated: true,
            provisioning: true,
            steps: [
              { id: 'app', state: 'active' },
              { id: 'manifest', state: 'pending' },
              { id: 'sp', state: 'pending' },
              { id: 'consent', state: 'pending' },
              { id: 'secret', state: 'pending' },
              { id: 'store', state: 'pending' },
              { id: 'admin', state: 'pending' },
              { id: 'config', state: 'pending' },
            ],
          },
        }),
      ),
    )

    render(<SetupWizard />)

    expect(await screen.findByText('Find or create app registration')).toBeTruthy()
    expect(screen.getAllByText('Pending')).toHaveLength(7)
    expect(screen.getAllByText('Active')).toHaveLength(1)
  })

  it("done + secretStored 'shown' shows the secret and does not auto-reload", async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          configured: false,
          oidLockActive: false,
          secretsWritable: false,
          session: {
            authenticated: true,
            provisioning: false,
            steps: doneSteps,
            result: {
              tenantId: 'tid-1',
              clientId: 'app-1',
              consentGranted: true,
              secretStored: 'shown',
              clientSecret: 's3cret123',
            },
          },
        }),
      ),
    )

    render(<SetupWizard />)

    expect(await screen.findByText('s3cret123')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })

  it('done + consentGranted false shows the consent command', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          configured: false,
          oidLockActive: false,
          secretsWritable: true,
          session: {
            authenticated: true,
            provisioning: false,
            steps: doneSteps,
            result: {
              tenantId: 'tid-1',
              clientId: 'app-1',
              consentGranted: false,
              consentCommand: 'az ad app permission admin-consent --id app-1',
              secretStored: 'keyvault',
            },
          },
        }),
      ),
    )

    render(<SetupWizard />)

    expect(await screen.findByText('Admin consent still required.')).toBeTruthy()
    expect(screen.getByText('az ad app permission admin-consent --id app-1')).toBeTruthy()
  })

  it('poll 403 shows the oid mismatch message and resets to idle', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/setup/status') {
        return jsonResponse(200, { configured: false, oidLockActive: true, secretsWritable: true })
      }
      if (url === '/api/setup/device-code' && method === 'POST') {
        return jsonResponse(200, {
          userCode: 'ABC-DEF',
          verificationUri: 'https://microsoft.com/devicelogin',
          expiresIn: 900,
          message: 'go log in',
        })
      }
      if (url === '/api/setup/poll' && method === 'POST') {
        return jsonResponse(403, { error: 'signed-in account does not match the bootstrap admin' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)
    await act(async () => {
      await flushPromises()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => {
      await flushPromises()
    })
    expect(screen.getByText('ABC-DEF')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flushPromises()
    })

    expect(screen.getByText('Signed-in account does not match BOOTSTRAP_ADMIN_OID.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
  })

  // regression: a dev-server restart wipes the in-memory setup session, poll then 401s.
  // the card must reset to idle with a message instead of polling the stale code forever
  it('poll 401 after session loss resets to idle with a message', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/setup/status') {
        return jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })
      }
      if (url === '/api/setup/device-code' && method === 'POST') {
        return jsonResponse(200, {
          userCode: 'ABC-DEF',
          verificationUri: 'https://microsoft.com/devicelogin',
          expiresIn: 900,
          message: 'go log in',
        })
      }
      if (url === '/api/setup/poll' && method === 'POST') {
        return jsonResponse(401, { error: 'not authenticated' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)
    await act(async () => {
      await flushPromises()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => {
      await flushPromises()
    })
    expect(screen.getByText('ABC-DEF')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(5000)
      await flushPromises()
    })

    expect(screen.getByText('Setup session lost. Start again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    // no spurious status refetch from the error body
    const statusCalls = fetchMock.mock.calls.filter(([u]) => u === '/api/setup/status')
    expect(statusCalls).toHaveLength(1)
  })
})

describe('SetupManualCard (rendered inside SetupWizard)', () => {
  it('hides the secret input and shows the .dev.env hint when secrets are not writable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: false })),
    )

    render(<SetupWizard />)

    expect(await screen.findByLabelText('Tenant ID')).toBeTruthy()
    expect(screen.queryByLabelText('Client secret')).toBeNull()
    expect(
      screen.getByText('Put the client secret in .dev.env as AZURE_CLIENT_SECRET before configuring.'),
    ).toBeTruthy()
  })

  it('shows the client secret input when secrets are writable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })),
    )

    render(<SetupWizard />)

    expect(await screen.findByLabelText('Client secret')).toBeTruthy()
  })

  it('disables submit with the sign-in hint when oid lock is active and no session is authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { configured: false, oidLockActive: true, secretsWritable: true })),
    )

    render(<SetupWizard />)

    expect(await screen.findByText('Sign in with the device code first (identity check).')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Configure' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits tenant/client/secret and reloads immediately on success without a warning', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/setup/status') {
        return jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })
      }
      if (url === '/api/setup/manual' && init?.method === 'POST') {
        return jsonResponse(200, { ok: true })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)

    fireEvent.change(await screen.findByLabelText('Tenant ID'), { target: { value: 'tid-1' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cid-1' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))

    await act(async () => {
      await flushPromises()
    })

    const manualCalls = fetchMock.mock.calls.filter(([u]) => u === '/api/setup/manual')
    expect(manualCalls).toHaveLength(1)
    const [, init] = manualCalls[0]
    expect(JSON.parse(init?.body as string)).toEqual({ tenantId: 'tid-1', clientId: 'cid-1', clientSecret: 's3cret' })
    expect(reload).toHaveBeenCalled()
  })

  it('shows the warning then reloads after 3s on success with a warning', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/setup/status') {
        return jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })
      }
      if (url === '/api/setup/manual' && init?.method === 'POST') {
        return jsonResponse(200, { ok: true, warning: 'secret stored but could not be verified against entra' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)
    await act(async () => {
      await flushPromises()
    })
    fireEvent.change(screen.getByLabelText('Tenant ID'), { target: { value: 'tid-1' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cid-1' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    await act(async () => {
      await flushPromises()
    })

    expect(screen.getByText('secret stored but could not be verified against entra')).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(3000)
      await flushPromises()
    })

    expect(reload).toHaveBeenCalled()
  })

  it('renders the error text on 400', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/setup/status') {
        return jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })
      }
      if (url === '/api/setup/manual' && init?.method === 'POST') {
        return jsonResponse(400, { error: 'tenant not found' })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SetupWizard />)

    fireEvent.change(await screen.findByLabelText('Tenant ID'), { target: { value: 'bad-tenant' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cid-1' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))

    expect(await screen.findByText('tenant not found')).toBeTruthy()
  })

  it('shows the app registration checklist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { configured: false, oidLockActive: false, secretsWritable: true })),
    )

    render(<SetupWizard />)

    expect(await screen.findByText('Manual app registration checklist')).toBeTruthy()
    expect(screen.getByText(/Token version 2/)).toBeTruthy()
  })
})
