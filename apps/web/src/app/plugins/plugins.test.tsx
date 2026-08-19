import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { SnackbarProvider } from '../../components/snackbar'

afterEach(() => {
  cleanup()
})

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/plugins/' }))

const { usePlugins, useEnablePlugin, useDisablePlugin, useReloadPlugin, useDeletePlugin, useRegisterPlugin } =
  vi.hoisted(() => ({
    usePlugins: vi.fn(),
    useEnablePlugin: vi.fn(),
    useDisablePlugin: vi.fn(),
    useReloadPlugin: vi.fn(),
    useDeletePlugin: vi.fn(),
    useRegisterPlugin: vi.fn(),
  }))

vi.mock('../../lib/plugin-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plugin-queries')>()
  return {
    ...actual,
    usePlugins,
    useEnablePlugin,
    useDisablePlugin,
    useReloadPlugin,
    useDeletePlugin,
    useRegisterPlugin,
  }
})

vi.mock('../../components/auth-gate', () => ({
  useAuth: () => ({ account: undefined, logout: vi.fn() }),
}))

function renderPage() {
  return render(
    <SnackbarProvider>
      <Page />
    </SnackbarProvider>,
  )
}

const plugins = [
  {
    id: 'demo',
    source: 'git' as const,
    repoUrl: 'https://example.com/demo.git',
    ref: 'main',
    enabled: true,
    status: 'active' as const,
    loadedAt: '2026-01-01T00:00:00.000Z',
    toolCount: 3,
    configured: true,
    displayStatus: 'active' as const,
  },
  {
    id: 'broken',
    source: 'local' as const,
    localPath: '/plugins/broken',
    enabled: true,
    status: 'quarantined' as const,
    lastError: 'invalid manifest: toolPrefix required',
    toolCount: 0,
    configured: true,
    displayStatus: 'quarantined' as const,
  },
]

describe('plugins page', () => {
  it('shows the lastError for a quarantined row on hover', async () => {
    usePlugins.mockReturnValue({ data: plugins, isLoading: false, isError: false, refetch: vi.fn() })
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useReloadPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDeletePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useRegisterPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })

    renderPage()

    fireEvent.mouseOver(screen.getByText('Quarantined'))
    expect(await screen.findByText('invalid manifest: toolPrefix required')).toBeTruthy()
  })

  it('toggles the enabled switch and calls the disable mutation', () => {
    const disableMutate = vi.fn()
    usePlugins.mockReturnValue({ data: plugins, isLoading: false, isError: false, refetch: vi.fn() })
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: disableMutate, isPending: false })
    useReloadPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDeletePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useRegisterPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })

    renderPage()

    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])

    expect(disableMutate).toHaveBeenCalledWith('demo', expect.anything())
  })

  it('register dialog posts the git payload', () => {
    const registerMutate = vi.fn()
    usePlugins.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useReloadPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDeletePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useRegisterPlugin.mockReturnValue({ mutate: registerMutate, isPending: false })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Register plugin' }))
    fireEvent.change(screen.getByLabelText('ID'), { target: { value: 'my-plugin' } })
    fireEvent.change(screen.getByLabelText('Repo URL'), { target: { value: 'https://example.com/repo.git' } })
    fireEvent.change(screen.getByLabelText('Ref'), { target: { value: 'main' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))

    expect(registerMutate).toHaveBeenCalledWith(
      { id: 'my-plugin', source: 'git', repoUrl: 'https://example.com/repo.git', ref: 'main' },
      expect.anything(),
    )
  })

  it('maps derived statuses to chips', () => {
    usePlugins.mockReturnValue({
      data: [
        {
          id: 'fresh',
          source: 'local' as const,
          localPath: '/plugins/fresh',
          enabled: false,
          status: 'loading' as const,
          toolCount: 0,
          configured: false,
          displayStatus: 'disabled' as const,
        },
        {
          id: 'unconfigured',
          source: 'local' as const,
          localPath: '/plugins/unconfigured',
          enabled: true,
          status: 'active' as const,
          toolCount: 2,
          configured: false,
          displayStatus: 'needs_setup' as const,
        },
        {
          id: 'failing',
          source: 'local' as const,
          localPath: '/plugins/failing',
          enabled: true,
          status: 'active' as const,
          health: { ok: false, detail: 'auth failed', checkedAt: '2026-08-12T00:00:00.000Z' },
          toolCount: 2,
          configured: true,
          displayStatus: 'error' as const,
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useReloadPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDeletePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useRegisterPlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })

    renderPage()
    expect(screen.getByText('Disabled')).toBeDefined()
    expect(screen.getByText('Needs setup')).toBeDefined()
    expect(screen.getByText('Error')).toBeDefined()
  })
})
