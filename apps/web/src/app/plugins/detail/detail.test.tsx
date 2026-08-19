import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { SnackbarProvider } from '../../../components/snackbar'

afterEach(() => {
  cleanup()
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=demo'),
  usePathname: () => '/plugins/detail/',
}))

const { usePlugin, usePlugins, usePluginHealth, useEnablePlugin, useDisablePlugin } = vi.hoisted(() => ({
  usePlugin: vi.fn(),
  usePlugins: vi.fn(),
  usePluginHealth: vi.fn(),
  useEnablePlugin: vi.fn(),
  useDisablePlugin: vi.fn(),
}))

vi.mock('../../../lib/plugin-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/plugin-queries')>()
  return { ...actual, usePlugin, usePlugins, usePluginHealth, useEnablePlugin, useDisablePlugin }
})

vi.mock('../../../components/auth-gate', () => ({
  useAuth: () => ({ account: undefined, logout: vi.fn() }),
}))

function detailData(enabled: boolean): import('../../../lib/plugin-queries').PluginDetail {
  return {
    record: {
      id: 'demo',
      source: 'local' as const,
      localPath: '/plugins/demo',
      enabled,
      status: 'active' as const,
      loadedAt: '2026-01-01T00:00:00.000Z',
    },
    manifest: {
      id: 'demo',
      name: 'Demo',
      toolPrefix: 'demo_',
      entry: 'src/index.ts',
      sdkVersion: '^0.1',
      secrets: [],
      ui: { settings: [], actions: [], statusCheck: false },
    },
    configured: true,
    displayStatus: enabled ? ('active' as const) : ('disabled' as const),
  }
}

function renderPage(data: ReturnType<typeof detailData>) {
  usePlugin.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() })
  usePlugins.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  usePluginHealth.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, data: undefined })
  return render(
    <SnackbarProvider>
      <Page />
    </SnackbarProvider>,
  )
}

describe('plugin detail page', () => {
  it('toggling the enabled switch off calls the disable mutation', () => {
    const disableMutate = vi.fn()
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: disableMutate, isPending: false })

    renderPage(detailData(true))

    fireEvent.click(screen.getByRole('switch'))

    expect(disableMutate).toHaveBeenCalledWith('demo', expect.anything())
  })

  it('toggling the enabled switch on calls the enable mutation', () => {
    const enableMutate = vi.fn()
    useEnablePlugin.mockReturnValue({ mutate: enableMutate, isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })

    renderPage(detailData(false))

    fireEvent.click(screen.getByRole('switch'))

    expect(enableMutate).toHaveBeenCalledWith('demo', expect.anything())
  })

  it('missing manifest on a disabled plugin says disabled', () => {
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })

    renderPage({ ...detailData(false), manifest: undefined })

    expect(screen.getByText('Manifest unavailable (plugin disabled).')).toBeTruthy()
  })

  it('missing manifest on a quarantined plugin says quarantined', () => {
    useEnablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })
    useDisablePlugin.mockReturnValue({ mutate: vi.fn(), isPending: false })

    renderPage({ ...detailData(true), displayStatus: 'quarantined' as const, manifest: undefined })

    expect(screen.getByText('Manifest unavailable (plugin quarantined).')).toBeTruthy()
  })
})
