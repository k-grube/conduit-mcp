import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Page from './page'
import { SnackbarProvider } from '../../../components/snackbar'

afterEach(() => {
  cleanup()
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=demo'),
  usePathname: () => '/plugins/settings/',
}))

const { usePlugin, usePluginConfig, usePluginSecrets, useUpdatePluginConfig, useUpdatePluginSecrets } = vi.hoisted(
  () => ({
    usePlugin: vi.fn(),
    usePluginConfig: vi.fn(),
    usePluginSecrets: vi.fn(),
    useUpdatePluginConfig: vi.fn(),
    useUpdatePluginSecrets: vi.fn(),
  }),
)

vi.mock('../../../lib/plugin-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/plugin-queries')>()
  return { ...actual, usePlugin, usePluginConfig, usePluginSecrets, useUpdatePluginConfig, useUpdatePluginSecrets }
})

vi.mock('../../../components/auth-gate', () => ({
  useAuth: () => ({ account: undefined, logout: vi.fn() }),
}))

function detailData(opts: {
  setupHelp?: string
  configured: boolean
}): import('../../../lib/plugin-queries').PluginDetail {
  return {
    record: {
      id: 'demo',
      source: 'local' as const,
      localPath: '/plugins/demo',
      enabled: true,
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
      ui: { settings: [], actions: [], statusCheck: false, setupHelp: opts.setupHelp },
    },
    configured: opts.configured,
    displayStatus: 'active' as const,
  }
}

function renderPage(data: ReturnType<typeof detailData>) {
  usePlugin.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() })
  usePluginConfig.mockReturnValue({ data: {}, isLoading: false, isError: false, refetch: vi.fn() })
  usePluginSecrets.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
  useUpdatePluginConfig.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  useUpdatePluginSecrets.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  return render(
    <SnackbarProvider>
      <Page />
    </SnackbarProvider>,
  )
}

const HELP_MD =
  'Create an application under [HaloPSA API](https://example.halopsa.com/config) and grant `read:tickets`.'

describe('plugin settings setup guide', () => {
  it('renders manifest setupHelp as markdown', () => {
    renderPage(detailData({ setupHelp: HELP_MD, configured: false }))

    expect(screen.getByText('Setup guide')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'HaloPSA API' })
    expect(link.getAttribute('href')).toBe('https://example.halopsa.com/config')
    expect(screen.getByText('read:tickets').tagName).toBe('CODE')
  })

  it('renders no setup guide when the manifest declares none', () => {
    renderPage(detailData({ configured: false }))

    expect(screen.queryByText('Setup guide')).toBeNull()
  })

  it('expands the guide while unconfigured', () => {
    renderPage(detailData({ setupHelp: HELP_MD, configured: false }))

    expect(screen.getByRole('button', { name: /setup guide/i }).getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses the guide once configured', () => {
    renderPage(detailData({ setupHelp: HELP_MD, configured: true }))

    expect(screen.getByRole('button', { name: /setup guide/i }).getAttribute('aria-expanded')).toBe('false')
  })
})
